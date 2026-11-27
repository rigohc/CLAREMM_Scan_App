-- Catálogo maestro de corridas CLAREMM.
-- Aplicar después de relational-schema.sql. No modifica existencias, precios ni imágenes.

create table if not exists public.corridas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  linea text not null,
  nombre text not null,
  talla_inicial numeric(5,1) not null,
  talla_final numeric(5,1) not null,
  incremento numeric(2,1) not null,
  activa boolean not null default true,
  fuente text not null default 'manual',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint corridas_linea_required check (btrim(linea) <> ''),
  constraint corridas_nombre_required check (btrim(nombre) <> ''),
  constraint corridas_range_valid check (talla_inicial > 0 and talla_final >= talla_inicial),
  constraint corridas_increment_valid check (incremento in (0.5, 1.0)),
  constraint corridas_grid_valid check (mod(talla_final - talla_inicial, incremento) = 0),
  constraint corridas_org_range_key unique (organization_id, linea, talla_inicial, talla_final, incremento)
);

create table if not exists public.corrida_fuentes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  corrida_id uuid not null references public.corridas(id) on delete cascade,
  sistema text not null,
  external_id text not null,
  etiqueta_original text not null default '',
  evidencia text not null default '',
  created_at timestamptz not null default now(),
  constraint corrida_fuentes_key unique (organization_id, sistema, external_id)
);

create table if not exists public.estilo_corridas (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  estilo_key text not null,
  corrida_id uuid not null references public.corridas(id) on delete restrict,
  orden smallint not null default 1 check (orden > 0),
  fuente text not null default 'manual',
  notas text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, estilo_key, corrida_id),
  constraint estilo_corridas_style_required check (btrim(estilo_key) <> '')
);

create table if not exists public.corrida_import_issues (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sistema text not null,
  external_id text not null,
  linea text not null default '',
  etiqueta_original text not null default '',
  motivo text not null,
  payload jsonb not null default '{}'::jsonb,
  resuelto boolean not null default false,
  created_at timestamptz not null default now(),
  constraint corrida_import_issues_key unique (organization_id, sistema, external_id)
);

create table if not exists public.corrida_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_type text not null check (event_type in ('SizeRunDefined', 'SizeRunUpdated', 'StyleSizeRunAssigned', 'StyleSizeRunUnassigned')),
  corrida_id uuid references public.corridas(id) on delete set null,
  estilo_key text not null default '',
  motivo text not null,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists corridas_org_line_idx on public.corridas (organization_id, linea, activa, talla_inicial, talla_final);
create index if not exists corrida_fuentes_corrida_idx on public.corrida_fuentes (corrida_id);
create index if not exists estilo_corridas_style_idx on public.estilo_corridas (organization_id, estilo_key, orden);
create index if not exists corrida_events_org_created_idx on public.corrida_events (organization_id, created_at desc);

drop trigger if exists corridas_touch_updated_at on public.corridas;
create trigger corridas_touch_updated_at before update on public.corridas
for each row execute function public.claremm_touch_updated_at();
drop trigger if exists estilo_corridas_touch_updated_at on public.estilo_corridas;
create trigger estilo_corridas_touch_updated_at before update on public.estilo_corridas
for each row execute function public.claremm_touch_updated_at();

alter table public.corridas enable row level security;
alter table public.corrida_fuentes enable row level security;
alter table public.estilo_corridas enable row level security;
alter table public.corrida_import_issues enable row level security;
alter table public.corrida_events enable row level security;

revoke all on public.corridas, public.corrida_fuentes, public.estilo_corridas,
  public.corrida_import_issues, public.corrida_events from anon, authenticated;
grant select, insert, update, delete on public.corridas, public.corrida_fuentes, public.estilo_corridas,
  public.corrida_import_issues, public.corrida_events to authenticated;

drop policy if exists corridas_select on public.corridas;
drop policy if exists corridas_write on public.corridas;
create policy corridas_select on public.corridas for select to authenticated
using (public.claremm_is_org_member(organization_id));
create policy corridas_write on public.corridas for all to authenticated
using (public.claremm_can_edit_org(organization_id))
with check (public.claremm_can_edit_org(organization_id));

drop policy if exists corrida_fuentes_select on public.corrida_fuentes;
drop policy if exists corrida_fuentes_write on public.corrida_fuentes;
create policy corrida_fuentes_select on public.corrida_fuentes for select to authenticated
using (public.claremm_is_org_member(organization_id));
create policy corrida_fuentes_write on public.corrida_fuentes for all to authenticated
using (public.claremm_can_edit_org(organization_id))
with check (public.claremm_can_edit_org(organization_id));

drop policy if exists estilo_corridas_select on public.estilo_corridas;
drop policy if exists estilo_corridas_write on public.estilo_corridas;
create policy estilo_corridas_select on public.estilo_corridas for select to authenticated
using (public.claremm_is_org_member(organization_id));
create policy estilo_corridas_write on public.estilo_corridas for all to authenticated
using (public.claremm_can_edit_org(organization_id))
with check (public.claremm_can_edit_org(organization_id));

drop policy if exists corrida_import_issues_select on public.corrida_import_issues;
drop policy if exists corrida_import_issues_write on public.corrida_import_issues;
create policy corrida_import_issues_select on public.corrida_import_issues for select to authenticated
using (public.claremm_is_org_member(organization_id));
create policy corrida_import_issues_write on public.corrida_import_issues for all to authenticated
using (public.claremm_can_edit_org(organization_id))
with check (public.claremm_can_edit_org(organization_id));

drop policy if exists corrida_events_select on public.corrida_events;
drop policy if exists corrida_events_insert on public.corrida_events;
create policy corrida_events_select on public.corrida_events for select to authenticated
using (public.claremm_is_org_member(organization_id));
create policy corrida_events_insert on public.corrida_events for insert to authenticated
with check (public.claremm_can_edit_org(organization_id));

-- Corridas válidas visibles en las capturas del usuario. Los ids repetidos de SAZ
-- se guardan como fuentes; la regla canónica se guarda una sola vez.
with source_rows(saz_id, linea, inicial, final, incremento) as (values
  (12,'DAMA',22.0,27.0,0.5),(6,'DAMA',21.5,27.0,0.5),(44,'DAMA',21.5,25.0,0.5),(71,'DAMA',21.5,26.0,0.5),
  (64,'NIÑAS',18.5,21.0,0.5),(25,'NIÑAS',12.0,17.5,0.5),(95,'NIÑAS',15.0,17.0,0.5),
  (69,'NIÑAS',14.5,17.0,0.5),(49,'NIÑAS',11.0,13.0,0.5),(7,'NIÑAS',18.0,21.5,0.5),
  (50,'NIÑAS',10.0,12.5,0.5),(8,'NIÑAS',12.0,14.5,0.5),(52,'NIÑAS',14.0,17.5,0.5),
  (84,'NIÑAS',12.5,14.5,0.5),(18,'NIÑAS',10.0,12.0,0.5),(73,'NIÑAS',14.0,14.5,0.5),
  (81,'NIÑAS',18.0,21.0,1.0),(9,'NIÑAS',15.0,17.5,0.5),(74,'NIÑAS',17.0,21.0,0.5),
  (91,'NIÑAS',12.0,14.0,0.5),(46,'NIÑAS',13.0,18.0,0.5),(53,'NIÑAS',9.0,13.0,0.5),
  (70,'NIÑAS',17.5,21.0,0.5),(80,'NIÑAS',15.0,17.0,1.0),(119,'NIÑAS',11.0,21.0,0.5),
  (45,'NIÑAS',18.0,21.0,0.5),(10,'NIÑAS',9.0,11.5,0.5),(79,'NIÑAS',15.0,21.0,1.0),
  (98,'NIÑAS',13.0,17.0,0.5),(92,'NIÑAS',17.5,21.5,0.5),
  (122,'NIÑOS',12.0,21.0,1.0),(120,'NIÑOS',12.0,21.5,0.5),(43,'NIÑOS',17.0,21.0,0.5),
  (14,'NIÑOS',9.0,11.5,0.5),(68,'NIÑOS',14.5,17.0,0.5),(15,'NIÑOS',12.0,14.5,0.5),
  (24,'NIÑOS',18.0,21.0,0.5),(121,'NIÑOS',12.0,21.0,0.5),(125,'NIÑOS',9.0,13.0,0.5),
  (66,'NIÑOS',17.5,21.0,0.5),(17,'NIÑOS',18.0,21.5,0.5),(54,'NIÑOS',9.0,21.5,0.5),
  (55,'NIÑOS',9.0,10.5,0.5),(16,'NIÑOS',15.0,17.5,0.5),(23,'NIÑOS',13.0,18.0,0.5),
  (47,'NIÑOS',10.0,13.0,0.5),(93,'NIÑOS',12.0,14.0,0.5),(51,'NIÑOS',11.0,13.0,0.5),
  (19,'NIÑOS',10.0,12.0,0.5),(72,'NIÑOS',18.5,21.0,0.5),(94,'NIÑOS',14.5,17.5,0.5),
  (5,'JOVEN',21.5,24.5,0.5),(124,'JOVEN',21.5,27.0,0.5),(13,'JOVEN',22.0,24.5,0.5)
), canonical as (
  select distinct linea, inicial, final, incremento from source_rows
)
insert into public.corridas (organization_id, linea, nombre, talla_inicial, talla_final, incremento, fuente)
select o.id, c.linea,
  to_char(c.inicial, 'FM9990.0') || ' al ' || to_char(c.final, 'FM9990.0') || ' inc ' || to_char(c.incremento, 'FM9990.0'),
  c.inicial, c.final, c.incremento, 'capturas_saz_2026-11-27'
from public.organizations o cross join canonical c
where upper(o.name) = 'CLAREMM'
on conflict (organization_id, linea, talla_inicial, talla_final, incremento) do nothing;

with source_rows(saz_id, linea, inicial, final, incremento) as (values
  (12,'DAMA',22.0,27.0,0.5),(6,'DAMA',21.5,27.0,0.5),(44,'DAMA',21.5,25.0,0.5),(71,'DAMA',21.5,26.0,0.5),
  (64,'NIÑAS',18.5,21.0,0.5),(25,'NIÑAS',12.0,17.5,0.5),(95,'NIÑAS',15.0,17.0,0.5),(69,'NIÑAS',14.5,17.0,0.5),
  (49,'NIÑAS',11.0,13.0,0.5),(7,'NIÑAS',18.0,21.5,0.5),(50,'NIÑAS',10.0,12.5,0.5),(8,'NIÑAS',12.0,14.5,0.5),
  (52,'NIÑAS',14.0,17.5,0.5),(84,'NIÑAS',12.5,14.5,0.5),(18,'NIÑAS',10.0,12.0,0.5),(73,'NIÑAS',14.0,14.5,0.5),
  (81,'NIÑAS',18.0,21.0,1.0),(9,'NIÑAS',15.0,17.5,0.5),(74,'NIÑAS',17.0,21.0,0.5),(91,'NIÑAS',12.0,14.0,0.5),
  (46,'NIÑAS',13.0,18.0,0.5),(53,'NIÑAS',9.0,13.0,0.5),(70,'NIÑAS',17.5,21.0,0.5),(80,'NIÑAS',15.0,17.0,1.0),
  (119,'NIÑAS',11.0,21.0,0.5),(45,'NIÑAS',18.0,21.0,0.5),(10,'NIÑAS',9.0,11.5,0.5),(79,'NIÑAS',15.0,21.0,1.0),
  (98,'NIÑAS',13.0,17.0,0.5),(92,'NIÑAS',17.5,21.5,0.5),
  (122,'NIÑOS',12.0,21.0,1.0),(120,'NIÑOS',12.0,21.5,0.5),(43,'NIÑOS',17.0,21.0,0.5),(14,'NIÑOS',9.0,11.5,0.5),
  (68,'NIÑOS',14.5,17.0,0.5),(15,'NIÑOS',12.0,14.5,0.5),(24,'NIÑOS',18.0,21.0,0.5),(121,'NIÑOS',12.0,21.0,0.5),
  (125,'NIÑOS',9.0,13.0,0.5),(66,'NIÑOS',17.5,21.0,0.5),(17,'NIÑOS',18.0,21.5,0.5),(54,'NIÑOS',9.0,21.5,0.5),
  (55,'NIÑOS',9.0,10.5,0.5),(16,'NIÑOS',15.0,17.5,0.5),(23,'NIÑOS',13.0,18.0,0.5),(47,'NIÑOS',10.0,13.0,0.5),
  (93,'NIÑOS',12.0,14.0,0.5),(51,'NIÑOS',11.0,13.0,0.5),(19,'NIÑOS',10.0,12.0,0.5),(72,'NIÑOS',18.5,21.0,0.5),
  (94,'NIÑOS',14.5,17.5,0.5),(5,'JOVEN',21.5,24.5,0.5),(124,'JOVEN',21.5,27.0,0.5),(13,'JOVEN',22.0,24.5,0.5)
)
insert into public.corrida_fuentes (organization_id, corrida_id, sistema, external_id, etiqueta_original, evidencia)
select o.id, c.id, 'SAZ', s.saz_id::text,
  to_char(s.inicial, 'FM9990.0') || ' al ' || to_char(s.final, 'FM9990.0') || ' inc ' || to_char(s.incremento, 'FM9990.0'),
  'Captura Control de Líneas y sus Corridas, 2026-11-27'
from public.organizations o join source_rows s on true
join public.corridas c on c.organization_id = o.id and c.linea = s.linea
  and c.talla_inicial = s.inicial and c.talla_final = s.final and c.incremento = s.incremento
where upper(o.name) = 'CLAREMM'
on conflict (organization_id, sistema, external_id) do update set
  corrida_id = excluded.corrida_id,
  etiqueta_original = excluded.etiqueta_original,
  evidencia = excluded.evidencia;

insert into public.corrida_import_issues
  (organization_id, sistema, external_id, linea, etiqueta_original, motivo, payload)
select o.id, 'SAZ', issue.external_id, issue.linea, issue.etiqueta, issue.motivo, issue.payload
from public.organizations o cross join (values
  ('96','NIÑAS','15.0 al 17.8 inc 0.5','17.8 no cae en medios números','{"inicial":15,"final":17.8,"incremento":0.5}'::jsonb),
  ('107','NIÑAS','108.0 al 21.5 inc 0.5','El inicio es mayor que el final; probable error de captura','{"inicial":108,"final":21.5,"incremento":0.5}'::jsonb),
  ('22','NIÑOS','15.0 al 17.7 inc 0.5','17.7 no cae en medios números','{"inicial":15,"final":17.7,"incremento":0.5}'::jsonb)
) as issue(external_id, linea, etiqueta, motivo, payload)
where upper(o.name) = 'CLAREMM'
on conflict (organization_id, sistema, external_id) do update set
  etiqueta_original = excluded.etiqueta_original,
  motivo = excluded.motivo,
  payload = excluded.payload;

-- Tramo confirmado por el negocio para NIÑAS. Su id numérico de SAZ está pendiente.
insert into public.corridas (organization_id, linea, nombre, talla_inicial, talla_final, incremento, fuente)
select id, 'NIÑAS', '21.5 al 27.0 inc 0.5', 21.5, 27.0, 0.5, 'confirmado_negocio_2026-11-27'
from public.organizations
where upper(name) = 'CLAREMM'
on conflict (organization_id, linea, talla_inicial, talla_final, incremento) do nothing;

-- La media talla 21.5 pertenece a ambos tramos. La relación conserva una sola ficha por color.
with requested(estilo_key, linea, inicial, final, incremento, orden, fuente, notas) as (values
  ('COS901','NIÑAS',12.0,17.5,0.5,1,'confirmado_negocio_2026-11-27','Corridas y presencia de COS901 confirmadas en SAZ por CLAREMM el 27/11/2026. Colores: COÑAC, MELLE, NEGRO.'),
  ('COS901','NIÑAS',18.0,21.5,0.5,2,'confirmado_negocio_2026-11-27','Corridas y presencia de COS901 confirmadas en SAZ por CLAREMM el 27/11/2026. Colores: COÑAC, MELLE, NEGRO.'),
  ('COS901','NIÑAS',21.5,27.0,0.5,3,'confirmado_negocio_2026-11-27','Corridas y presencia de COS901 confirmadas en SAZ por CLAREMM el 27/11/2026. Colores: COÑAC, MELLE, NEGRO.'),
  ('435501','NIÑOS',18.0,21.5,0.5,1,'inferencia_por_tallas_2026-11-27','Corrida infantil observada en el catálogo histórico.'),
  ('435501','JOVEN',21.5,27.0,0.5,2,'inferencia_por_tallas_2026-11-27','Corrida joven observada en el catálogo histórico; frontera inclusiva.')
)
insert into public.estilo_corridas (organization_id, estilo_key, corrida_id, orden, fuente, notas)
select o.id, r.estilo_key, c.id, r.orden, r.fuente, r.notas
from public.organizations o join requested r on true
join public.corridas c on c.organization_id = o.id and c.linea = r.linea
  and c.talla_inicial = r.inicial and c.talla_final = r.final and c.incremento = r.incremento
where upper(o.name) = 'CLAREMM'
on conflict (organization_id, estilo_key, corrida_id) do update set
  orden = excluded.orden,
  fuente = excluded.fuente,
  notas = excluded.notas;

-- Reemplaza únicamente los dos vínculos inferidos de la primera versión.
delete from public.estilo_corridas as link
using public.corridas as old_run, public.organizations as org
where link.organization_id = org.id and upper(org.name) = 'CLAREMM'
  and link.corrida_id = old_run.id and old_run.organization_id = org.id
  and link.estilo_key = 'COS901' and link.fuente = 'inferencia_por_tallas_2026-11-27'
  and old_run.incremento = 0.5
  and ((old_run.linea = 'NIÑAS' and old_run.talla_inicial = 15.0 and old_run.talla_final = 17.5)
    or (old_run.linea = 'JOVEN' and old_run.talla_inicial = 21.5 and old_run.talla_final = 27.0));
