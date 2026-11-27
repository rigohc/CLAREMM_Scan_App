-- Apply after relational-schema.sql, before publishing the scanner.
-- Route equivalent spellings to the same variant when inserts use upsert.
-- Keep existing variants and movement references intact.
create or replace function public.claremm_reuse_shoe_size()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_input text := replace(btrim(new.size), ',', '.');
  v_number numeric;
  v_canonical text;
  v_existing text;
begin
  if v_input !~ '^[0-9]+([.][0-9]+)?$' then return new; end if;
  v_number := v_input::numeric;
  if v_number <= 0 or mod(v_number * 2, 1) <> 0 then return new; end if;
  v_canonical := round(v_number, 1)::text;
  select v.size into v_existing from public.product_variants v
  where v.product_id = new.product_id
    and case when replace(btrim(v.size), ',', '.') ~ '^[0-9]+([.][0-9]+)?$'
      then replace(btrim(v.size), ',', '.')::numeric = v_number else false end
  order by (v.size = v_canonical) desc, v.id limit 1;
  new.size := coalesce(v_existing, v_canonical);
  return new;
end;
$$;

drop trigger if exists claremm_reuse_shoe_size on public.product_variants;
create trigger claremm_reuse_shoe_size before insert on public.product_variants
for each row execute function public.claremm_reuse_shoe_size();

create or replace function public.claremm_protect_juarez_quantity()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.quantity < old.quantity and exists (
    select 1 from public.branches b where b.id = old.branch_id and b.code = 'JUAREZ'
  ) then
    raise exception 'JUÁREZ no baja existencias' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists claremm_protect_juarez_quantity on public.inventory_levels;
create trigger claremm_protect_juarez_quantity before update of quantity on public.inventory_levels
for each row execute function public.claremm_protect_juarez_quantity();

-- StockIncreased: commit the level and its idempotency receipt together.
create or replace function public.claremm_increase_stock(
  p_product uuid, p_branch uuid, p_size text, p_quantity integer, p_reason text, p_event_key text
) returns table (variant_id uuid, size text, quantity integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid;
  v_branch_code text;
  v_variant uuid;
  v_size text;
  v_next integer;
  v_key text;
  v_receipt public.inventory_movements_relational%rowtype;
begin
  if auth.uid() is null or p_quantity is null or p_quantity < 1
    or p_size is null or p_size !~ '^[0-9]+[.][05]$'
    or p_event_key is null or p_event_key !~ '^[0-9a-f-]{36}$' then
    raise exception 'Captura, talla o identificador inválido' using errcode = '22023';
  end if;
  if p_size::numeric <= 0 then
    raise exception 'Talla inválida' using errcode = '22023';
  end if;
  select p.organization_id, b.code into v_org, v_branch_code
  from public.products p join public.branches b on b.organization_id = p.organization_id
  where p.id = p_product and b.id = p_branch and p.activo and b.active
  for no key update of p;
  if v_org is null or not public.claremm_can_edit_org(v_org) then
    raise exception 'Ficha o sucursal fuera de la organización editable' using errcode = '42501';
  end if;
  v_key := 'StockIncreased:' || auth.uid()::text || ':' || p_event_key;
  perform pg_advisory_xact_lock(hashtextextended(v_key, 0));
  select m.* into v_receipt from public.inventory_movements_relational m where m.import_key = v_key;
  if found then
    select v.size into v_size from public.product_variants v
    where v.id = v_receipt.variant_id and v.product_id = p_product;
    if v_size is null or v_receipt.branch_id <> p_branch or v_receipt.quantity <> p_quantity
      or replace(btrim(v_size), ',', '.')::numeric <> p_size::numeric then
      raise exception 'El evento ya existe con otros datos' using errcode = '22023';
    end if;
    return query select v_receipt.variant_id, p_size, v_receipt.new_quantity;
    return;
  end if;
  -- Reuse historical spellings such as 21, 21.0 and 21.00.
  select v.id into v_variant from public.product_variants v
  where v.product_id = p_product
    and case when replace(btrim(v.size), ',', '.') ~ '^[0-9]+([.][0-9]+)?$'
      then replace(btrim(v.size), ',', '.')::numeric = p_size::numeric else false end
  order by (v.size = p_size) desc, v.id limit 1;
  if v_variant is null then
    insert into public.product_variants (product_id, size) values (p_product, p_size)
    on conflict on constraint product_variants_product_id_size_key do update set size = excluded.size
    returning id into v_variant;
  end if;
  insert into public.inventory_levels as l (branch_id, variant_id, quantity, updated_by)
  values (p_branch, v_variant, p_quantity, auth.uid())
  on conflict on constraint inventory_levels_pkey do update
    set quantity = l.quantity + excluded.quantity, updated_by = excluded.updated_by, updated_at = now()
  returning l.quantity into v_next;
  insert into public.inventory_movements_relational
    (organization_id, branch_id, variant_id, operation, previous_quantity, quantity, new_quantity, reason, import_key, created_by)
  values (v_org, p_branch, v_variant, 'add', v_next - p_quantity, p_quantity, v_next,
    coalesce(p_reason, 'Entrada de inventario'), v_key, auth.uid());
  if v_branch_code = 'JUAREZ' then
    update public.products p
    set estado = case when p.source_system = 'saz_precargado' or p.estado = 'YA PRECARGADO EN SAZ'
      then 'PRECARGADO SIN STOCK' else 'PENDIENTE EN SAZ' end
    where p.id = p_product and (p.estado in ('REGISTRADO EN SAZ', 'CARGADO EN SAZ', 'YA PRECARGADO EN SAZ')
      or (p.estado not in ('PENDIENTE EN SAZ', 'PENDIENTE DE SAZ', 'PRECARGADO SIN STOCK') and exists (
        select 1 from public.saz_product_registry r where r.product_id = p.id and r.organization_id = v_org
      )));
  end if;
  return query select v_variant, p_size, v_next;
end;
$$;

revoke all on function public.claremm_increase_stock(uuid, uuid, text, integer, text, text) from public, anon;
grant execute on function public.claremm_increase_stock(uuid, uuid, text, integer, text, text) to authenticated;
