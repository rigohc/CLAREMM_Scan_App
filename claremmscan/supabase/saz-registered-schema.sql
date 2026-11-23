-- CLAREMM: catálogo oficial e inventario confirmado en SAZ.
-- Requiere haber ejecutado relational-schema.sql.
-- Idempotente: no elimina ni suma cantidades existentes.

create extension if not exists pgcrypto;

-- Búsqueda rápida y precisa sin importar mayúsculas o espacios exteriores.
create index if not exists products_org_style_color_lookup_idx
  on public.products (organization_id, upper(btrim(estilo)), upper(btrim(color)));

create index if not exists inventory_items_user_style_color_size_idx
  on public.inventory_items (user_id, upper(btrim(estilo)), upper(btrim(color)), upper(btrim(talla)));

create table if not exists public.saz_registration_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete restrict,
  source_file text not null,
  registered_on date,
  product_count integer not null default 0 check (product_count >= 0),
  variant_count integer not null default 0 check (variant_count >= 0),
  pair_count integer not null default 0 check (pair_count >= 0),
  validation_notes jsonb not null default '[]'::jsonb,
  imported_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, branch_id, source_file)
);

-- Un estilo + color registrado oficialmente en SAZ apunta a una sola ficha maestra.
create table if not exists public.saz_product_registry (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  lookup_key text not null,
  estilo text not null,
  color text not null,
  source_files text[] not null default '{}'::text[],
  first_registered_at timestamptz not null default now(),
  last_registered_at timestamptz not null default now(),
  unique (organization_id, lookup_key)
);

-- Existencia que los archivos confirman como registrada en SAZ por sucursal y talla.
create table if not exists public.saz_registered_stock (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  registry_id uuid not null references public.saz_product_registry(id) on delete restrict,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  size text not null,
  quantity integer not null default 0 check (quantity >= 0),
  source_files text[] not null default '{}'::text[],
  registered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, registry_id, size)
);

create index if not exists saz_registry_org_lookup_idx
  on public.saz_product_registry (organization_id, lookup_key);
create index if not exists saz_registry_product_idx
  on public.saz_product_registry (product_id);
create index if not exists saz_stock_branch_registry_idx
  on public.saz_registered_stock (branch_id, registry_id, size);
create index if not exists saz_stock_variant_idx
  on public.saz_registered_stock (variant_id);

drop trigger if exists saz_batches_touch_updated_at on public.saz_registration_batches;
create trigger saz_batches_touch_updated_at before update on public.saz_registration_batches
for each row execute function public.claremm_touch_updated_at();
drop trigger if exists saz_stock_touch_updated_at on public.saz_registered_stock;
create trigger saz_stock_touch_updated_at before update on public.saz_registered_stock
for each row execute function public.claremm_touch_updated_at();

alter table public.saz_registration_batches enable row level security;
alter table public.saz_product_registry enable row level security;
alter table public.saz_registered_stock enable row level security;

revoke all on public.saz_registration_batches, public.saz_product_registry, public.saz_registered_stock from anon, authenticated;
grant select, insert, update, delete on public.saz_registration_batches, public.saz_product_registry, public.saz_registered_stock to authenticated;

drop policy if exists saz_batches_select on public.saz_registration_batches;
drop policy if exists saz_batches_write on public.saz_registration_batches;
create policy saz_batches_select on public.saz_registration_batches for select to authenticated
using (public.claremm_is_org_member(organization_id));
create policy saz_batches_write on public.saz_registration_batches for all to authenticated
using (public.claremm_can_edit_org(organization_id))
with check (public.claremm_can_edit_org(organization_id));

drop policy if exists saz_registry_select on public.saz_product_registry;
drop policy if exists saz_registry_write on public.saz_product_registry;
create policy saz_registry_select on public.saz_product_registry for select to authenticated
using (public.claremm_is_org_member(organization_id));
create policy saz_registry_write on public.saz_product_registry for all to authenticated
using (public.claremm_can_edit_org(organization_id))
with check (public.claremm_can_edit_org(organization_id));

drop policy if exists saz_stock_select on public.saz_registered_stock;
drop policy if exists saz_stock_write on public.saz_registered_stock;
create policy saz_stock_select on public.saz_registered_stock for select to authenticated
using (public.claremm_is_org_member(organization_id));
create policy saz_stock_write on public.saz_registered_stock for all to authenticated
using (public.claremm_can_edit_org(organization_id))
with check (public.claremm_can_edit_org(organization_id));

create or replace view public.saz_registration_summary
with (security_invoker = true)
as
select
  s.organization_id,
  s.branch_id,
  b.code as branch_code,
  b.name as branch_name,
  count(distinct s.registry_id)::integer as registered_products,
  count(*)::integer as registered_variants,
  coalesce(sum(s.quantity), 0)::integer as registered_pairs,
  max(s.registered_at) as last_registered_at
from public.saz_registered_stock s
join public.branches b on b.id = s.branch_id
group by s.organization_id, s.branch_id, b.code, b.name;

create or replace view public.saz_product_catalog
with (security_invoker = true)
as
select
  r.organization_id,
  r.lookup_key,
  r.product_id,
  r.estilo,
  r.color,
  p.marca,
  p.proveedor,
  p.linea,
  p.sublinea,
  p.corrida,
  p.acabado,
  p.precio,
  p.costo,
  r.source_files,
  r.last_registered_at
from public.saz_product_registry r
join public.products p on p.id = r.product_id;

grant select on public.saz_registration_summary, public.saz_product_catalog to authenticated;
