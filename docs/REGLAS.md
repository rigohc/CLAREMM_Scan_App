# Catálogo de reglas CLAREMM

Cualquier agente, ingeniero o módulo POS debe cumplirlas. El código que las implementa hoy: `claremmscan/inventory-search.js`, `claremmscan/lib/branch-upload-core.js`, `claremmscan/lib/corridas-core.js`.

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

## Corridas

| ID | Regla |
|---|---|
| R-CO-01 | La corrida canónica pertenece a una línea y se define por talla inicial, talla final e incremento. Los ids de SAZ son fuentes/alias, no la identidad de la regla. |
| R-CO-02 | Se prefieren incrementos de `0.5`. Solo se admite `1.0` cuando el catálogo del negocio lo indique expresamente. Inicio, final y cada talla deben caer en la cuadrícula del incremento. |
| R-CO-03 | Un estilo puede relacionarse con dos o más corridas sin duplicar la identidad estilo+color. La relación no mueve ni modifica existencias. |
| R-CO-04 | Los extremos son inclusivos. Una frontera media como `21.5` puede pertenecer a dos corridas contiguas para no dejar ninguna talla fuera. |
| R-CO-05 | Una relación propuesta debe cubrir todas las tallas observadas. Datos inválidos como `17.8`, `17.7` o un rango invertido se guardan como incidencia, nunca como corrida activa. |
| R-CO-06 | Alta de corrida emite `SizeRunDefined`; relación estilo→corrida emite `StyleSizeRunAssigned`. Toda escritura por API exige motivo. |

## Existencias

| ID | Regla |
|---|---|
| R-ST-01 | JUÁREZ nunca baja. Ni SET, ni Excel, ni escáner, ni API. Solo suma o no toca. |
| R-ST-02 | Carga masiva `upload/preview` y `upload/apply` rechaza JUÁREZ (409). Corrección de tallas `POST /api/v1/branches/JUAREZ/sizes` sí aplica, sin bajar existencias. |
| R-ST-03 | Escáner y Excel en modo ADD no hacen SET hacia abajo en JUÁREZ. |
| R-ST-04 | `inventory_items` queda como archivo histórico. La PWA no lo lee ni escribe. Los registros y colas históricas tampoco se reproducen como entradas. |
| R-ST-05 | Idempotencia de lote: `batch_id` + `import_key` `api-v1:{batchId}:{productId}:{size}`. |
| R-ST-06 | Agrupar duplicados de la misma carga por estilo+color+talla antes de escribir. |
| R-ST-07 | API de catálogo: actualizar ficha (`PATCH`) o baja lógica (`DELETE` → `activo=false`). Tallas `set`/`sum` en JUÁREZ y NUEVO_LEON; en JUÁREZ nunca `next < previous`. |
| R-ST-08 | Conciliación SAZ: las fichas nuevas se crean como precargadas. Una precargada solo toma el Excel cuando su existencia total en JUÁREZ es cero. El estado cargado requiere que SAZ cubra cada talla del aplicativo. Los faltantes mantienen la ficha pendiente según su origen. |
| R-ST-09 | La conciliación SAZ bloquea el estilo+color completo si una fila tiene existencia negativa o si su total no cuadra. Nunca modifica precio ni imagen. |
| R-ST-10 | La auditoría del corte SAZ de JUÁREZ compara por estilo compacto + color + talla. Los faltantes se calculan por talla, sin compensarlos con excedentes de otras tallas. Si una ficha con pares faltantes estaba marcada como cargada, se corrige a `PENDIENTE EN SAZ` o `PRECARGADO SIN STOCK` según su origen. El reporte contiene el saldo por cargar. La corrección de estado no modifica existencias. |
| R-ST-11 | Consulta y exportación de existencia actual usan las mismas tablas relacionales. Las tallas equivalentes como `21` y `21.0` se suman dentro de la misma ficha y sucursal. Un reporte de carga SAZ identifica por separado la existencia y el saldo pendiente. |
| R-ST-12 | La captura manual y por cámara registra `StockIncreased` con identificador perdurable. La base confirma cantidad y movimiento juntos. Capturas pendientes quedan en el dispositivo y se excluyen de la existencia oficial hasta la confirmación. |

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
| R-SE-08 | `Faltantes SAZ` usa exclusivamente un snapshot verificado de catálogo, registro SAZ y existencia de Supabase. No mezcla `inventory_items` locales ni muestra fichas “solo local”. |

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
