# AGENTS.md — CLAREMM

Eres un agente o ingeniero en el inventario y futuro POS de Zapatería CLAREMM. Lee esto antes de tocar código.

## Dónde está la verdad

| Qué | Dónde |
|---|---|
| Reglas de negocio | [docs/REGLAS.md](docs/REGLAS.md) |
| Arquitectura (hexágono, eventos, POS) | [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) |
| Workflow de trabajo | [docs/WORKFLOW.md](docs/WORKFLOW.md) |
| Búsqueda (plan + índice) | `claremmscan/inventory-search.js` |
| Carga por sucursal | `claremmscan/lib/branch-upload-core.js`, `claremmscan/api/v1/[...path].js` |
| Corridas (reglas + tabla + API) | `claremmscan/lib/corridas-core.js`, `claremmscan/supabase/corridas-schema.sql`, `claremmscan/api/v1.js` |
| Reglas Cursor | `.cursor/rules/*.mdc` |

## Innegociable

1. Identidad = estilo compacto + color (orden del color importa).
2. JUÁREZ no baja existencias. Nuevo León sí puede set/sum.
3. No pisar precio > 0 ni imagen sin confirmación.
4. No barrer el catálogo por prefijo numérico. No congelar la UI.
5. No ejecutar `CLAREMM_Importar_Supabase.sql`. No borrar `inventory_items`.
6. Commit/push solo si te lo piden. Cero secretos en git.

## Antes de implementar

1. Clasifica el cambio: catálogo, existencias, búsqueda, sync, o POS.
2. Si toca stock o precio, nombra el **evento de dominio** (no un `UPDATE` suelto).
3. Si toca búsqueda, pasa por `ClaremmInventorySearch.plan`.
4. Prueba el camino de 50k+ fichas y el de `000034` / `00`.
5. Verifica en el cliente si cambia UI.
6. Si toca corridas, conserva medios números, valida contra `corridas` y no cambies existencias al relacionar un estilo.

El escáner PWA (`claremmscan/`) es el producto actual. El POS se diseña contra los mismos puertos; no se mezcla en `app.js`.
