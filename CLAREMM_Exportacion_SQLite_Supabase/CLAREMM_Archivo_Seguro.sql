-- Archivo local de SQLite. NO toca el catálogo relacional.
-- Nunca ejecutar CLAREMM_Importar_Supabase.sql contra este proyecto:
-- ese script crea public.products con bigint y choca con las fichas UUID actuales.
--
-- Estas tablas son un respaldo consultable. No alimentan tarjetas, precios ni JUAREZ.
-- Las fichas/imágenes se omiten a propósito.

create table if not exists public.sqlite_local_products (
  sqlite_id bigint primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  estilo text not null default '',
  color text not null default '',
  acabado text not null default '',
  marca text not null default '',
  temporada text not null default '',
  proveedor text not null default '',
  sublinea text not null default '',
  clasificacion text not null default '',
  linea text not null default '',
  codigo_barras text not null default '',
  precio numeric(14, 2) not null default 0,
  costo numeric(14, 2) not null default 0,
  departamento text not null default '',
  observaciones text not null default '',
  suela text not null default '',
  plantilla text not null default '',
  tacon text not null default '',
  forro text not null default '',
  catalogo text not null default '',
  activo integer not null default 1,
  descripcion text not null default '',
  corrida text not null default '',
  estado text not null default '',
  fecha_alta text not null default '',
  comprador text not null default '',
  pagina integer not null default 0,
  status integer not null default 1,
  imagen_sqlite_path text not null default '',
  sqlite_created_at text not null default '',
  sqlite_updated_at text not null default '',
  archived_at timestamptz not null default now()
);

create table if not exists public.sqlite_local_size_inventory (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sqlite_product_id bigint not null references public.sqlite_local_products(sqlite_id) on delete cascade,
  size text not null,
  quantity integer not null default 0 check (quantity >= 0),
  sqlite_updated_at text not null default '',
  archived_at timestamptz not null default now(),
  primary key (sqlite_product_id, size)
);

create table if not exists public.sqlite_local_movements (
  sqlite_id bigint primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sqlite_product_id bigint not null references public.sqlite_local_products(sqlite_id) on delete cascade,
  size text not null,
  operation text not null,
  previous_quantity integer not null default 0,
  quantity integer not null default 0,
  new_quantity integer not null default 0,
  sqlite_created_at text not null default '',
  archived_at timestamptz not null default now()
);

create index if not exists sqlite_local_products_org_style_idx
  on public.sqlite_local_products (organization_id, estilo, color);
create index if not exists sqlite_local_inventory_org_idx
  on public.sqlite_local_size_inventory (organization_id, sqlite_product_id);
create index if not exists sqlite_local_movements_org_idx
  on public.sqlite_local_movements (organization_id, sqlite_product_id);

alter table public.sqlite_local_products enable row level security;
alter table public.sqlite_local_size_inventory enable row level security;
alter table public.sqlite_local_movements enable row level security;

revoke all on public.sqlite_local_products, public.sqlite_local_size_inventory, public.sqlite_local_movements
  from anon, authenticated;
grant select, insert, update, delete on public.sqlite_local_products, public.sqlite_local_size_inventory,
  public.sqlite_local_movements to authenticated;

drop policy if exists sqlite_local_products_member on public.sqlite_local_products;
create policy sqlite_local_products_member on public.sqlite_local_products
  for all to authenticated
  using (public.claremm_is_org_member(organization_id))
  with check (public.claremm_can_edit_org(organization_id));

drop policy if exists sqlite_local_inventory_member on public.sqlite_local_size_inventory;
create policy sqlite_local_inventory_member on public.sqlite_local_size_inventory
  for all to authenticated
  using (public.claremm_is_org_member(organization_id))
  with check (public.claremm_can_edit_org(organization_id));

drop policy if exists sqlite_local_movements_member on public.sqlite_local_movements;
create policy sqlite_local_movements_member on public.sqlite_local_movements
  for all to authenticated
  using (public.claremm_is_org_member(organization_id))
  with check (public.claremm_can_edit_org(organization_id));
