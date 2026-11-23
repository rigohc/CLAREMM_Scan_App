-- CLAREMM: control de registros enviados a SAZ.
-- Seguro e idempotente: no elimina, suma ni mezcla inventarios.

-- La tabla antigua contiene capturas de la app todavía no cargadas en SAZ.
alter table public.inventory_items
  add column if not exists saz_cargado boolean not null default false,
  add column if not exists saz_cargado_at timestamptz,
  add column if not exists origen text not null default 'supabase_legacy';

-- Solamente los registros creados después de esta migración usan este origen.
-- Los existentes conservan supabase_legacy y todos quedan pendientes de SAZ.
alter table public.inventory_items
  alter column origen set default 'app_capture';

create index if not exists inventory_items_user_saz_idx
  on public.inventory_items (user_id, saz_cargado);

-- Verificación: la primera consulta debe mostrar los registros antiguos como pendientes.
select origen, saz_cargado, count(*) as registros, sum(cantidad) as pares
from public.inventory_items
group by origen, saz_cargado
order by origen, saz_cargado;

-- Verificación independiente: SQLite/Excel siguen separados en el modelo relacional.
select p.source_system, count(*) as variantes, sum(l.quantity) as pares
from public.inventory_levels l
join public.product_variants v on v.id = l.variant_id
join public.products p on p.id = v.product_id
group by p.source_system
order by p.source_system;
