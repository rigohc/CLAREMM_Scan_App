# Corridas CLAREMM

La fuente operativa es `public.corridas`; los ids originales se conservan en `public.corrida_fuentes` y la relación de negocio vive en `public.estilo_corridas`. El SQL inicial está en `claremmscan/supabase/corridas-schema.sql`.

## Criterio

- Preferir incremento `0.5`.
- Cubrir todas las tallas observadas sin convertir una talla aislada en una corrida inventada.
- Inicio y final son inclusivos. La media talla fronteriza puede quedar en ambos tramos.
- Relacionar corridas no duplica la ficha estilo+color ni cambia inventario.
- Un renglón que no cae en enteros o medios se conserva como incidencia.

## Relación inicial inferida

| Estilo | Orden | Línea | Corrida | Motivo |
|---|---:|---|---|---|
| `COS901` | 1 | NIÑAS | 15.0–17.5, inc. 0.5 | Cubre el tramo infantil bajo observado. |
| `COS901` | 2 | NIÑAS | 18.0–21.5, inc. 0.5 | Continúa sin huecos y conserva 21.5. |
| `COS901` | 3 | JOVEN | 21.5–27.0, inc. 0.5 | Cubre 22, 23.5, 26 y 26.5; comparte la frontera 21.5. |
| `435501` | 1 | NIÑOS | 18.0–21.5, inc. 0.5 | Coincide con la corrida histórica inferior. |
| `435501` | 2 | JOVEN | 21.5–27.0, inc. 0.5 | Coincide con la corrida histórica superior y conserva medias. |

Esta relación es una inferencia reproducible a partir de las tallas actuales y las capturas. Puede confirmarse o ajustarse por API sin reescribir existencias.

## Evidencia rechazada, no perdida

| SAZ id | Línea | Texto visible | Incidencia |
|---:|---|---|---|
| 96 | NIÑAS | 15.0–17.8, inc. 0.5 | 17.8 no cae en medios números. |
| 107 | NIÑAS | 108.0–21.5, inc. 0.5 | Rango invertido; probable error de captura. |
| 22 | NIÑOS | 15.0–17.7, inc. 0.5 | 17.7 no cae en medios números. |

Se guardan en `public.corrida_import_issues`, inactivas, hasta que el negocio confirme la corrección.
