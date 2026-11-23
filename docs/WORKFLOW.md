# Workflow — agentes e ingenieros

## 1. Entrada

1. Leer [AGENTS.md](../AGENTS.md) y [REGLAS.md](REGLAS.md).
2. Clasificar el pedido: **catálogo · existencias · búsqueda · sync · POS · git**.
3. Si hay duda de stock o precio, no “arreglarlo con un UPDATE”. Nombrar el evento.

## 2. Cambio de código

```
Pedido del usuario
        │
        ▼
  ¿Toca dominio? ──sí──► puerto (interface) + caso de uso + evento
        │ no
        ▼
  ¿Toca búsqueda? ──sí──► ClaremmInventorySearch.plan + test inventory-search
        │ no
        ▼
  ¿Toca UI? ──sí──► verificar en el cliente (flujo real, no solo screenshot)
        │
        ▼
  Tests del módulo  →  git solo si lo piden
```

## 3. Búsqueda (escáner)

1. `plan(query)` primero.
2. Si `wait`: no red.
3. Si `exact-estilo`: `.in('estilo', keys).limit(40)`.
4. Prefijo solo si `allowPrefix`.
5. Abortar la in-flight.
6. Probar `00` (no debe colgar) y `000034` (debe hallar `034`).

## 4. Carga por sucursal

1. Preview antes de apply.
2. Si sucursal es JUÁREZ → 409, cero escrituras.
3. Agrupar estilo+color+talla.
4. Desconocidos: `create_unknowns` / `crear:true` o cola de revisión.
5. Material/precio según R-ID-07 y R-PR-*.
6. Idempotencia por `batch_id`.

## 5. Conflicto al sincronizar (offline → nube)

| Campo | Gana |
|---|---|
| Existencia JUÁREZ | Nunca el valor más bajo. Suma o se ignora la bajada. |
| Precio | El `> 0` existente, salvo confirmación. |
| Imagen | La existente, salvo confirmación. |
| Color/estilo | Identidad compacta; no duplicar ficha. |
| Outbox | Reintento; no borrar el evento local hasta ack. |

## 6. DoD (definición de hecho)

- [ ] Regla de [REGLAS.md](REGLAS.md) citada o añadida si es nueva.
- [ ] Ningún barrido de catálogo en el hilo de UI.
- [ ] Tests del módulo en verde (`claremmscan/tests/`).
- [ ] UI verificada si cambió captura, búsqueda o existencias.
- [ ] Sin secretos. Sin SQL de importación masiva de SQLite.

## 7. Qué no hacer

- No mezclar caja POS en `app.js`.
- No introducir microservicios para un mostrador.
- No “optimizar” con `ilike` numérico.
- No bajar JUÁREZ “porque el Excel trae 0”.
- No commitear porque el árbol está sucio: esperar la orden.
