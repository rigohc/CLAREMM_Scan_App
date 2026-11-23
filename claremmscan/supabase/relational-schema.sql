-- CLAREMM: modelo relacional para catálogo, sucursales e inventario.
-- Ejecutar en Supabase > SQL Editor antes de importar SQLite/Excel.
-- No elimina ni modifica public.inventory_items; permite una transición segura.

create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'operator' check (role in ('admin', 'editor', 'operator', 'viewer')),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_system text not null,
  source_id text not null,
  match_key text not null,
  codigo_barras text not null default '',
  estilo text not null,
  color text not null,
  precio numeric(14, 2) not null default 0 check (precio >= 0),
  marca text not null default '',
  proveedor text not null default '',
  temporada text not null default '',
  sublinea text not null default '',
  departamento text not null default '',
  clasificacion text not null default '',
  linea text not null default '',
  corrida text not null default '',
  acabado text not null default '',
  suela text not null default '',
  plantilla text not null default '',
  tacon text not null default '',
  forro text not null default '',
  catalogo text not null default '',
  status integer not null default 1,
  observaciones text not null default '',
  costo numeric(14, 2) not null default 0 check (costo >= 0),
  descripcion text not null default '',
  estado text not null default '',
  fecha_alta text not null default '',
  comprador text not null default '',
  pagina integer not null default 0,
  activo boolean not null default true,
  imagen text not null default '',
  imagen_thumbnail text not null default '',
  ficha_imagen text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, source_system, source_id)
);

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  size text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, size)
);

create table if not exists public.inventory_levels (
  branch_id uuid not null references public.branches(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete cascade,
  quantity integer not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (branch_id, variant_id)
);

create table if not exists public.inventory_movements_relational (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete restrict,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  operation text not null check (operation in ('add', 'set', 'adjustment', 'sale', 'transfer_in', 'transfer_out', 'initial_import')),
  previous_quantity integer not null default 0,
  quantity integer not null,
  new_quantity integer not null check (new_quantity >= 0),
  reason text not null default '',
  import_key text unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_migration_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete restrict,
  source_summary jsonb not null default '{}'::jsonb,
  product_count integer not null default 0,
  variant_count integer not null default 0,
  pair_count integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists products_organization_match_idx on public.products (organization_id, match_key);
create index if not exists products_style_color_idx on public.products (organization_id, estilo, color);
create index if not exists variants_product_idx on public.product_variants (product_id);
create index if not exists inventory_levels_variant_idx on public.inventory_levels (variant_id);
create index if not exists movements_branch_created_idx on public.inventory_movements_relational (branch_id, created_at desc);
create index if not exists members_user_idx on public.organization_members (user_id);

create or replace function public.claremm_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists organizations_touch_updated_at on public.organizations;
create trigger organizations_touch_updated_at before update on public.organizations
for each row execute function public.claremm_touch_updated_at();
drop trigger if exists branches_touch_updated_at on public.branches;
create trigger branches_touch_updated_at before update on public.branches
for each row execute function public.claremm_touch_updated_at();
drop trigger if exists products_touch_updated_at on public.products;
create trigger products_touch_updated_at before update on public.products
for each row execute function public.claremm_touch_updated_at();
drop trigger if exists variants_touch_updated_at on public.product_variants;
create trigger variants_touch_updated_at before update on public.product_variants
for each row execute function public.claremm_touch_updated_at();

create or replace function public.claremm_is_org_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = target_org and user_id = auth.uid()
  );
$$;

create or replace function public.claremm_can_edit_org(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = target_org
      and user_id = auth.uid()
      and role in ('admin', 'editor', 'operator')
  );
$$;

grant execute on function public.claremm_is_org_member(uuid) to authenticated;
grant execute on function public.claremm_can_edit_org(uuid) to authenticated;

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.branches enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.inventory_levels enable row level security;
alter table public.inventory_movements_relational enable row level security;
alter table public.inventory_migration_runs enable row level security;

revoke all on public.organizations, public.organization_members, public.branches, public.products,
  public.product_variants, public.inventory_levels, public.inventory_movements_relational,
  public.inventory_migration_runs from anon, authenticated;
grant select, insert, update, delete on public.organizations, public.organization_members, public.branches,
  public.products, public.product_variants, public.inventory_levels, public.inventory_movements_relational,
  public.inventory_migration_runs to authenticated;

drop policy if exists organizations_select on public.organizations;
drop policy if exists organizations_insert on public.organizations;
drop policy if exists organizations_update on public.organizations;
drop policy if exists organizations_delete on public.organizations;
create policy organizations_select on public.organizations for select to authenticated
using (created_by = (select auth.uid()) or public.claremm_is_org_member(id));
create policy organizations_insert on public.organizations for insert to authenticated
with check (created_by = (select auth.uid()));
create policy organizations_update on public.organizations for update to authenticated
using (created_by = (select auth.uid()) or public.claremm_can_edit_org(id))
with check (created_by = (select auth.uid()) or public.claremm_can_edit_org(id));
create policy organizations_delete on public.organizations for delete to authenticated
using (created_by = (select auth.uid()));

drop policy if exists members_select on public.organization_members;
drop policy if exists members_insert on public.organization_members;
drop policy if exists members_update on public.organization_members;
drop policy if exists members_delete on public.organization_members;
create policy members_select on public.organization_members for select to authenticated
using (user_id = (select auth.uid()) or public.claremm_is_org_member(organization_id));
create policy members_insert on public.organization_members for insert to authenticated
with check (
  public.claremm_can_edit_org(organization_id)
  or (
    user_id = (select auth.uid())
    and exists (select 1 from public.organizations o where o.id = organization_id and o.created_by = (select auth.uid()))
  )
);
create policy members_update on public.organization_members for update to authenticated
using (public.claremm_can_edit_org(organization_id))
with check (public.claremm_can_edit_org(organization_id));
create policy members_delete on public.organization_members for delete to authenticated
using (public.claremm_can_edit_org(organization_id));

drop policy if exists branches_select on public.branches;
drop policy if exists branches_write on public.branches;
drop policy if exists branches_delete on public.branches;
create policy branches_select on public.branches for select to authenticated
using (public.claremm_is_org_member(organization_id));
create policy branches_write on public.branches for all to authenticated
using (public.claremm_can_edit_org(organization_id))
with check (public.claremm_can_edit_org(organization_id));

drop policy if exists products_select on public.products;
drop policy if exists products_write on public.products;
create policy products_select on public.products for select to authenticated
using (public.claremm_is_org_member(organization_id));
create policy products_write on public.products for all to authenticated
using (public.claremm_can_edit_org(organization_id))
with check (public.claremm_can_edit_org(organization_id));

drop policy if exists variants_select on public.product_variants;
drop policy if exists variants_write on public.product_variants;
create policy variants_select on public.product_variants for select to authenticated
using (exists (select 1 from public.products p where p.id = product_id and public.claremm_is_org_member(p.organization_id)));
create policy variants_write on public.product_variants for all to authenticated
using (exists (select 1 from public.products p where p.id = product_id and public.claremm_can_edit_org(p.organization_id)))
with check (exists (select 1 from public.products p where p.id = product_id and public.claremm_can_edit_org(p.organization_id)));

drop policy if exists levels_select on public.inventory_levels;
drop policy if exists levels_write on public.inventory_levels;
create policy levels_select on public.inventory_levels for select to authenticated
using (exists (select 1 from public.branches b where b.id = branch_id and public.claremm_is_org_member(b.organization_id)));
create policy levels_write on public.inventory_levels for all to authenticated
using (exists (select 1 from public.branches b where b.id = branch_id and public.claremm_can_edit_org(b.organization_id)))
with check (exists (select 1 from public.branches b where b.id = branch_id and public.claremm_can_edit_org(b.organization_id)));

drop policy if exists movements_select on public.inventory_movements_relational;
drop policy if exists movements_write on public.inventory_movements_relational;
create policy movements_select on public.inventory_movements_relational for select to authenticated
using (public.claremm_is_org_member(organization_id));
create policy movements_write on public.inventory_movements_relational for all to authenticated
using (public.claremm_can_edit_org(organization_id))
with check (public.claremm_can_edit_org(organization_id));

drop policy if exists migration_runs_select on public.inventory_migration_runs;
drop policy if exists migration_runs_write on public.inventory_migration_runs;
create policy migration_runs_select on public.inventory_migration_runs for select to authenticated
using (public.claremm_is_org_member(organization_id));
create policy migration_runs_write on public.inventory_migration_runs for all to authenticated
using (public.claremm_can_edit_org(organization_id))
with check (public.claremm_can_edit_org(organization_id));

create or replace view public.product_stock_by_branch
with (security_invoker = true)
as
select
  p.organization_id,
  b.id as branch_id,
  b.code as branch_code,
  b.name as branch_name,
  p.id as product_id,
  p.source_system,
  p.source_id,
  p.estilo,
  p.color,
  p.marca,
  p.proveedor,
  p.temporada,
  p.sublinea,
  p.departamento,
  p.clasificacion,
  p.linea,
  p.corrida,
  p.acabado,
  p.precio,
  p.costo,
  coalesce(jsonb_object_agg(v.size, l.quantity) filter (where l.variant_id is not null), '{}'::jsonb) as stock_by_size,
  coalesce(sum(l.quantity), 0)::integer as total_quantity
from public.products p
cross join public.branches b
left join public.product_variants v on v.product_id = p.id
left join public.inventory_levels l on l.variant_id = v.id and l.branch_id = b.id
where b.organization_id = p.organization_id
group by p.id, b.id;

grant select on public.product_stock_by_branch to authenticated;

