-- Habilita imágenes compartidas para los productos del catálogo relacional.
-- Ejecutar en Supabase > SQL Editor después de relational-schema.sql.
-- Es idempotente y no modifica las imágenes históricas por usuario.

alter table public.products
  add column if not exists imagen text not null default '';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', false, 102400, array['image/png'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.claremm_image_path_organization(object_name text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  folder text;
begin
  folder := split_part(object_name, '/', 1);
  if folder !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return null;
  end if;
  return folder::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

revoke all on function public.claremm_image_path_organization(text) from public;
grant execute on function public.claremm_image_path_organization(text) to authenticated;

drop policy if exists "relational_product_images_select" on storage.objects;
drop policy if exists "relational_product_images_insert" on storage.objects;
drop policy if exists "relational_product_images_update" on storage.objects;
drop policy if exists "relational_product_images_delete" on storage.objects;

create policy "relational_product_images_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'product-images'
    and public.claremm_is_org_member(public.claremm_image_path_organization(name))
  );

create policy "relational_product_images_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and public.claremm_can_edit_org(public.claremm_image_path_organization(name))
  );

create policy "relational_product_images_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'product-images'
    and public.claremm_can_edit_org(public.claremm_image_path_organization(name))
  )
  with check (
    bucket_id = 'product-images'
    and public.claremm_can_edit_org(public.claremm_image_path_organization(name))
  );

create policy "relational_product_images_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'product-images'
    and public.claremm_can_edit_org(public.claremm_image_path_organization(name))
  );
