# Migración relacional CLAREMM

Este modelo separa los datos que antes estaban mezclados:

- `organizations`: empresa propietaria de los datos.
- `organization_members`: usuarios y permisos.
- `branches`: sucursales.
- `products`: ficha maestra compatible con SAZ.
- `product_variants`: tallas de cada producto.
- `inventory_levels`: existencia por sucursal y talla.
- `inventory_movements_relational`: historial de cambios.

La tabla anterior `inventory_items` se conserva durante la transición. No se debe borrar hasta que se verifique el inventario relacional.

## Separación del inventario capturado en la app

`public.inventory_items` permanece como una tabla independiente. Sus registros no se copian ni se suman a `products`, `product_variants` o `inventory_levels`.

El archivo `saz-status-migration.sql` agrega a esa tabla el estado `saz_cargado`, la fecha y el origen. Los registros existentes quedan como `supabase_legacy` y `Pendiente de SAZ`. Los productos relacionales conservan su origen real en `products.source_system` (`sqlite` o `saz_excel`).

## Fuentes revisadas

- `CLAREMM_Inventario_Saz_Final.xlsx`: 810 productos, 2,848 pares y 66 columnas.
- `database.sqlite`: 326 productos, 482 pares y 388 movimientos.
- El Excel SAZ ya contiene todos los estilos/colores del respaldo unificado de la app. No se debe volver a sumar ese JSON porque duplicaría existencias.
- Hay productos repetidos que comparten estilo y color pero tienen marca, corrida u otros atributos diferentes. La migración conserva el identificador de origen y genera `match_key` solamente para revisión; no fusiona registros ambiguos.

## Preparar Supabase

1. Abre **Supabase → SQL Editor**.
2. Ejecuta completo `supabase/relational-schema.sql`.
3. No borres `inventory_items` ni el respaldo actual.

## Generar el paquete validado

Desde `claremmscan`:

```bash
node scripts/build-relational-import.mjs \
  --sqlite "../CLAREMM Zapateria/backend/data/database.sqlite" \
  --xlsx "/Users/laclavees12345/Downloads/CLAREMM_Inventario_Saz_Final.xlsx" \
  --organization "CLAREMM" \
  --branch-code "JUAREZ" \
  --branch-name "CLAREMM ZAPATERIA JUAREZ" \
  --output "/tmp/claremm-relational-import.json"
```

Todo el inventario actual se asigna a la sucursal con código interno `JUAREZ` y nombre visible `CLAREMM ZAPATERIA JUAREZ`. Cada futura sucursal deberá tener un código estable y único, por ejemplo `CENTRO`, `NORTE` o `BODEGA`.

## Regla de migración

- Excel SAZ y SQLite se incorporan como fuentes diferentes.
- La identidad técnica es `organization_id + source_system + source_id`.
- Las existencias quedan en `inventory_levels` mediante `branch_id + variant_id`.
- Volver a ejecutar una importación debe actualizar los mismos registros, no sumarlos otra vez.
- Las rutas de imágenes de SQLite se conservan como referencia, pero los archivos se deben migrar después al bucket privado.

## Validación obligatoria

Antes de retirar SQLite, confirma en Supabase:

```sql
select count(*) as productos from public.products;
select count(*) as tallas_con_existencia, sum(quantity) as pares from public.inventory_levels;
select count(*) as movimientos from public.inventory_movements_relational;
select branch_code, sum(total_quantity) as pares
from public.product_stock_by_branch
group by branch_code;
```

El paquete actual debe reportar inicialmente 1,136 registros de producto y 3,330 pares antes de cualquier depuración de duplicados. Los repetidos se revisan después con `match_key`; no se eliminan automáticamente.

## Importar el paquete

Primero ejecuta una simulación, que solamente valida y no escribe:

```bash
node scripts/import-relational-supabase.mjs \
  --input /tmp/claremm-relational-import.json
```

Para la carga real se necesita una cuenta confirmada que pertenecerá a CLAREMM. Define temporalmente las credenciales de esa cuenta como `SUPABASE_MIGRATION_EMAIL` y `SUPABASE_MIGRATION_PASSWORD`, y después ejecuta:

```bash
node scripts/import-relational-supabase.mjs \
  --input /tmp/claremm-relational-import.json \
  --apply
```

El importador usa `upsert`: si se interrumpe puede ejecutarse otra vez. Las cantidades se reemplazan con el valor del paquete y no se suman una segunda vez.

## Archivos ya registrados en SAZ

Ejecuta primero `supabase/saz-registered-schema.sql`. Después genera y valida el paquete oficial:

```bash
node scripts/analyze-saz-registered.mjs \
  "/ruta/CLAREMM2 15_11_26 CORREGIDO REGISTRADO CORRECTAMENTE.xlsx" \
  "/ruta/CLAREMM 15_11_26 REGISTRO terminado.xlsx" \
  "/ruta/CLAREMM COSHI 16_11_26 AGREGADO A SAZ COMPLETO.xlsx" \
  --output /tmp/claremm-saz-registered.json
```

La carga real es idempotente y reutiliza la ficha maestra cuando estilo + color y proveedor permiten identificarla sin ambigüedad:

```bash
node scripts/import-saz-registered-supabase.mjs \
  --input /tmp/claremm-saz-registered.json \
  --apply
```

Los casos ambiguos se crean como fuente `saz_registered`; nunca se fusionan por suposición. `saz_product_registry` mantiene un índice oficial único estilo + color para reutilizar el producto al capturar existencia de otra sucursal.

