-- CLAREMM Scan: auditoría de la API de carga por sucursal.
-- Opcional. La API ya persiste lotes en inventory_migration_runs
-- y la cola de revisión en products.descripcion (prefijo CLAREMM_REVIEW:).
-- Ejecutar en SQL Editor si se quiere una tabla dedicada más adelante.

create table if not exists public.branch_upload_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete restrict,
  batch_id text not null,
  mode text not null check (mode in ('set', 'sum')),
  actor text not null default 'agent',
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id, branch_id, batch_id)
);

alter table public.branch_upload_batches enable row level security;
revoke all on public.branch_upload_batches from anon, authenticated;
grant select, insert, update, delete on public.branch_upload_batches to authenticated;

drop policy if exists branch_upload_batches_select on public.branch_upload_batches;
drop policy if exists branch_upload_batches_write on public.branch_upload_batches;
create policy branch_upload_batches_select on public.branch_upload_batches for select to authenticated
using (public.claremm_is_org_member(organization_id));
create policy branch_upload_batches_write on public.branch_upload_batches for all to authenticated
using (public.claremm_can_edit_org(organization_id))
with check (public.claremm_can_edit_org(organization_id));
