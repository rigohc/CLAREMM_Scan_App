# Catálogo de reglas CLAREMM

Cualquier agente, ingeniero o módulo POS debe cumplirlas. El código que las implementa hoy: `claremmscan/inventory-search.js`, `claremmscan/lib/branch-upload-core.js`.

## Identidad

| ID | Regla |
|---|---|
| R-ID-01 | La ficha se identifica por **estilo compacto + color**. |
| R-ID-02 | Ceros a la izquierda no cambian el estilo: `000034` = `034` = `34`. Claves de lookup: compacto y pads 3–6. |
| R-ID-03 | El color es exacto. El **orden importa**: NEGRO BLANCO ≠ BLANCO NEGRO. |
| R-ID-04 | Alias de color: `N/B`, `NB` → NEGRO BLANCO; `B/N`, `BN` → BLANCO NEGRO; `FUCSIA`/`FUCHSIA` → FIUSHA. Nada más. |
| R-ID-05 | Proveedor es campo abierto: se canónica si existe en catálogo SAZ; si no, se conserva. |
| R-ID-06 | Tipo por talla si no viene: &lt; 25 DAMA, ≥ 25 CABALLERO. No inferir si ya hay línea. |
| R-ID-07 | Material por defecto SINTETICO. No pisar acabado existente. PIEL vs SINTETICO → revisión. |

## Existencias

| ID | Regla |
|---|---|
| R-ST-01 | JUÁREZ nunca baja. Ni SET, ni Excel, ni escáner, ni API. Solo suma o no toca. |
| R-ST-02 | Carga masiva `upload/preview` y `upload/apply` rechaza JUÁREZ (409). Corrección de tallas `POST /api/v1/branches/JUAREZ/sizes` sí aplica, sin bajar existencias. |
| R-ST-03 | Escáner y Excel en modo ADD no hacen SET hacia abajo en JUÁREZ. |
| R-ST-04 | `inventory_items` (legado) no se borra ni se usa como destino de migraciones relacionales. |
| R-ST-05 | Idempotencia de lote: `batch_id` + `import_key` `api-v1:{batchId}:{productId}:{size}`. |
| R-ST-06 | Agrupar duplicados de la misma carga por estilo+color+talla antes de escribir. |
| R-ST-07 | API de catálogo: actualizar ficha (`PATCH`) o baja lógica (`DELETE` → `activo=false`). Tallas `set`/`sum` en JUÁREZ y NUEVO_LEON; en JUÁREZ nunca `next < previous`. |

## Precio e imagen

| ID | Regla |
|---|---|
| R-PR-01 | No sobrescribir `precio > 0` salvo confirmación explícita. |
| R-PR-02 | Precio de estilo se aplica a los colores de la **misma corrida**. |
| R-PR-03 | Herencia de precio: explícito Excel > heredado de la corrida > cero (revisión). |
| R-PR-04 | No sobrescribir imagen salvo confirmación. PNG ≤ 100 KB. Nombre `{estilo}-{color}.png`. |
| R-PR-05 | Ficha “nueva”: sin existencia, sin foto y sin precio. Va a revisión. |

## Búsqueda y UI

| ID | Regla |
|---|---|
| R-SE-01 | Toda consulta pasa por `ClaremmInventorySearch.plan`. |
| R-SE-02 | Estilo numérico: lookup exacto por `estiloKeys`. **Prohibido** `ilike '00%'` y cualquier prefijo numérico. |
| R-SE-03 | `0` / `00` / `000` no disparan red ni recorren el catálogo. Mensaje: seguir escribiendo. |
| R-SE-04 | Prefijo solo alfanumérico (`PI40`, `COM011`), mínimo 3 caracteres, tope 40 filas. |
| R-SE-05 | Índice local por estilo compacto. Rebuild al persistir. Objetivo: 50k+ fichas en &lt; 200 ms. |
| R-SE-06 | Abortar la búsqueda anterior al teclear. No `IndexedDB.getAll()` de blobs en cada tecla. |
| R-SE-07 | La UI no espera a 54k productos. Tope duro 40 fichas / 40 tarjetas. |

## Sync, git y operaciones

| ID | Regla |
|---|---|
| R-OP-01 | Offline-first: el mostrador escribe en local; el outbox sincroniza al haber red. |
| R-OP-02 | No ejecutar `CLAREMM_Importar_Supabase.sql`. |
| R-OP-03 | Secretos solo en `.env.local` / Vercel. Nunca en `deploy.js` ni commits. |
| R-OP-04 | Commit y push solo con petición explícita. |
| R-OP-05 | Caché PWA versionada (`sw.js`). Tras cambiar JS de cliente, subir versión. |

## POS (obligatorias cuando exista caja)

| ID | Regla |
|---|---|
| R-POS-01 | Una venta emite `SaleCompleted` y `StockDecreased` **por sucursal de la caja**, nunca contra JUÁREZ desde otra sucursal. |
| R-POS-02 | Devolución emite `ReturnAccepted` y suma stock en la sucursal que recibe. |
| R-POS-03 | Apartado reserva cantidad (`LayawayOpened`) sin vender; al cobrar, `LayawayCollected` + `SaleCompleted`. |
| R-POS-04 | Promoción se aplica en el caso de uso de cobro, no reescribiendo precios maestros. |
| R-POS-05 | Alta/baja de ficha es evento de catálogo, no un `DELETE` opaco. Baja lógica (`activo=false`) salvo petición explícita de borrado. |
