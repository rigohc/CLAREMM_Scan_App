-- Ejecuta este archivo una sola vez en Supabase > SQL Editor.
-- Es idempotente y puede volver a ejecutarse para reparar políticas.

create extension if not exists pgcrypto;

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  sucursal text not null default 'CLAREMM ZAPATERIA JUAREZ',
  item_key text not null,
  estilo text not null,
  marca text not null default '',
  color text not null,
  linea text not null default '',
  talla text not null,
  cantidad integer not null default 1 check (cantidad > 0),
  material text not null default '',
  precio text not null default '',
  notas text not null default '',
  saz_cargado boolean not null default false,
  saz_cargado_at timestamptz,
  origen text not null default 'app_capture',
  updated_at timestamptz not null default now(),
  unique (user_id, item_key)
);

-- Migración segura para proyectos que ya tenían la tabla creada.
alter table public.inventory_items
  add column if not exists marca text not null default '',
  add column if not exists sucursal text not null default 'CLAREMM ZAPATERIA JUAREZ',
  add column if not exists saz_cargado boolean not null default false,
  add column if not exists saz_cargado_at timestamptz,
  add column if not exists origen text not null default 'supabase_legacy';

alter table public.inventory_items
  alter column sucursal set default 'CLAREMM ZAPATERIA JUAREZ',
  alter column origen set default 'app_capture';

update public.inventory_items
set sucursal = 'CLAREMM ZAPATERIA JUAREZ'
where nullif(trim(sucursal), '') is null or upper(trim(sucursal)) = 'MATRIZ';

-- La clave incluye sucursal para que la misma talla pueda existir en varias tiendas.
update public.inventory_items
set item_key = upper(trim(sucursal)) || '|' || upper(trim(estilo)) || '|' || upper(trim(color)) || '|' || upper(trim(talla))
where item_key is distinct from upper(trim(sucursal)) || '|' || upper(trim(estilo)) || '|' || upper(trim(color)) || '|' || upper(trim(talla));

create index if not exists inventory_items_user_id_idx on public.inventory_items(user_id);
create index if not exists inventory_items_user_branch_idx on public.inventory_items(user_id, sucursal);
create index if not exists inventory_items_user_saz_idx on public.inventory_items(user_id, saz_cargado);
alter table public.inventory_items enable row level security;
revoke all on table public.inventory_items from anon, authenticated;
grant select, insert, update, delete on table public.inventory_items to authenticated;

drop policy if exists "inventory_select_own" on public.inventory_items;
drop policy if exists "inventory_insert_own" on public.inventory_items;
drop policy if exists "inventory_update_own" on public.inventory_items;
drop policy if exists "inventory_delete_own" on public.inventory_items;

create policy "inventory_select_own" on public.inventory_items
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "inventory_insert_own" on public.inventory_items
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "inventory_update_own" on public.inventory_items
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "inventory_delete_own" on public.inventory_items
  for delete to authenticated
  using ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', false, 102400, array['image/png'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "product_images_select_own" on storage.objects;
drop policy if exists "product_images_insert_own" on storage.objects;
drop policy if exists "product_images_update_own" on storage.objects;
drop policy if exists "product_images_delete_own" on storage.objects;

create policy "product_images_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "product_images_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "product_images_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "product_images_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
