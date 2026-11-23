# Arquitectura CLAREMM — escáner ahora, POS a escala

Documento para presentar a cliente, ingeniero o agente. El producto actual es el **escáner PWA + catálogo relacional**. El POS (ventas, devoluciones, apartado, promociones) se diseña contra los **mismos puertos**, no como un segundo monolito improvisado.

## Por qué esta forma

SAZ All-in-One truena porque mezcla captura, catálogo, existencias y caja en un solo flujo, y recorre datos de más en el cliente. CLAREMM no puede repetir eso.

Recomendación de llegada (industria retail, un mostrador que debe vender sin internet):

| Decisión | Qué | Por qué |
|---|---|---|
| **Hexagonal (puertos y adaptadores)** | El dominio no conoce React, Supabase ni SAZ | Se cambia de nube o de UI sin reescribir reglas |
| **Eventos de dominio + outbox** | Cada hecho de negocio es un evento | Auditoría, sync offline, POS y escáner escuchan lo mismo |
| **CQRS ligero** | Escritura local; lecturas (búsqueda, existencias) como proyección | 50k–millones de fichas se consultan por índice, no se barre la tabla |
| **Offline-first** | IndexedDB/SQLite es el write model del mostrador | Una sucursal sin red sigue cobrando y capturando |
| **Un solo proceso al inicio** | Módulos, no microservicios | Un equipo chico; se parte después por contexto si hace falta |

No recomendamos event sourcing completo el día uno (caro de operar). Sí **event-driven**: el agregado emite hechos; un bus in-process (y luego Realtime/outbox) actualiza proyecciones.

No recomendamos DDD ceremonial. Sí **bounded contexts** claros: Catálogo, Inventario, Caja, Sync.

## Hexágono

```
        PWA escáner     API /api/v1      Caja POS (futuro)     Excel/SAZ
                \            |                 |                /
                 \           |                 |               /
                  ▼          ▼                 ▼              ▼
                 puertos de aplicación (casos de uso)
                                  │
                                  ▼
                    dominio: Producto, Variante,
                    Existencia, Venta, Apartado, Promoción
                                  │
                                  ▼
                 puertos de persistencia / dispositivos
                /            |                 |              \
               ▼             ▼                 ▼               ▼
         IndexedDB      Supabase           Impresora        Pasarela
         / SQLite       (proyección)       ticket           de pago
```

**Núcleo (nunca importa HTTP ni UI)**

- `Product` (estilo compacto + color)
- `Variant` (talla)
- `InventoryLevel` (sucursal + variante + cantidad)
- `Money` / `Price` (no pisar &gt; 0 sin confirmación)
- Eventos: ver tabla abajo

**Casos de uso (aplicación)**

- `SearchCatalog` — usa `plan()`; nunca prefijo numérico
- `PreviewBranchUpload` / `ApplyBranchUpload`
- `ConfirmPrice` / `AttachImage`
- Futuro: `Checkout`, `AcceptReturn`, `OpenLayaway`, `CollectLayaway`, `ApplyPromotion`

**Adaptadores actuales**

- UI: `claremmscan/app.js`, `branch-stock.js`, `review-queue.js`
- Persistencia nube: `supabase-sync.js`, tablas relacionales
- Persistencia local: `localStorage` + IndexedDB imágenes (evoluciona a SQLite/OPFS)
- API agentes: `claremmscan/api/v1/[...path].js`

## Eventos de dominio

| Evento | Cuándo | Efecto |
|---|---|---|
| `CatalogProductUpserted` | Alta o ficha creada en carga | Proyección de catálogo |
| `StockIncreased` | Entrada / captura / devolución | Suma en sucursal |
| `StockSet` | Conteo autorizado | Solo sucursales no JUÁREZ |
| `StockDecreased` | Venta POS | Sucursal de la caja |
| `PriceConfirmed` | Usuario confirma precio | Corrida completa |
| `ImageAttached` | Foto de ficha | Storage + nombre canónico |
| `ReviewOpened` | Material/precio ambiguo | Cola encargado |
| `SaleCompleted` | Ticket cobrado | Stock + caja |
| `ReturnAccepted` | Devolución | Stock + caja |
| `LayawayOpened` | Apartado | Reserva, no venta |
| `LayawayCollected` | Liquidación de apartado | Luego `SaleCompleted` |
| `PromotionApplied` | Descuento en el ticket | No reescribe precio maestro |
| `SyncAcknowledged` | Nube aceptó el outbox | Se puede borrar el evento local |

Contrato de conflictos al sincronizar: [WORKFLOW.md](WORKFLOW.md) §5.

## Offline-first

```
Mostrador (sin red)
  captura / venta / apartado
        │
        ▼
  write model local (SQLite o IndexedDB)
        │
        ▼
  outbox de eventos (cola durable)
        │
        │  (cuando hay red)
        ▼
  sync adapter → Supabase (proyección + RLS)
        │
        ▼
  ack → se marca el evento
```

La búsqueda en el aparato usa el **índice local** (`createLocalIndex`). La nube es complemento, no requisito para teclear un estilo.

## Bounded contexts y roadmap

| Contexto | Ahora | Siguiente |
|---|---|---|
| Catálogo | PWA + relacional + revisión | Mismos agregados; UI de altas/bajas |
| Inventario | JUÁREZ protegido; NL por API | Movimientos por sucursal en POS |
| Búsqueda | `inventory-search.js` | Mismo puerto en caja |
| Caja | No existe | `Checkout` hexagonal, tickets, corte |
| Apartado | No existe | Reserva + vencimiento |
| Promociones | No existe | Motor en cobro, no en maestro |
| Sync | Queue v1 localStorage | Outbox SQLite + reintentos |

## Stack para presentar el proyecto

**Hoy (producción)**  
PWA estática en Vercel · `claremmscan/` · Supabase (Auth, RLS, Storage, Postgres) · API `X-API-Key` para agentes.

**Dominio a extraer (TypeScript)**  
Paquete `packages/domain` con identidad, plan de búsqueda, inventario, eventos. Los JS actuales se vuelven adaptadores. Tests de dominio sin navegador (ya empezado: `tests/inventory-search.js`, `tests/branch-upload-core.js`).

**POS**  
Misma PWA o app de mostrador; hexagonal; write model local (SQLite WASM / OPFS); outbox; proyección Supabase; impresión de ticket como puerto (no `window.print` pegado al caso de uso).

**No hacer**  
Un ERP en un solo `app.js`. Microservicios por módulo. Recorrer el catálogo en el hilo de UI. Event sourcing de todo el historial el primer trimestre.

## Escala

- Lookup por clave: O(k) con índice. 50k fichas locales &lt; 200 ms (probado 27 ms en índice).
- Prefijo numérico tipo `00%`: prohibido (7k+ filas, Chrome “página no responde”).
- Millones de movimientos: viven en `inventory_movements_*` y eventos, no en un `SELECT *` al abrir la caja.
- Caja cobra contra **existencias de esa sucursal**, no contra el catálogo completo.

## Cómo decirlo al cliente

CLAREMM no copia SAZ. Separa catálogo, existencias y caja. El mostrador trabaja sin internet. JUÁREZ no se vacía por un Excel. El escáner que ya usan es el primer adaptador de esa arquitectura; ventas, devoluciones, apartado y promociones se enchufan al mismo núcleo.
