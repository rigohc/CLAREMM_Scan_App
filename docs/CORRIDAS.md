# Corridas CLAREMM

La fuente operativa es `public.corridas`; los ids originales se conservan en `public.corrida_fuentes` y la relación de negocio vive en `public.estilo_corridas`. El SQL inicial está en `claremmscan/supabase/corridas-schema.sql`.

## Criterio

- Preferir incremento `0.5`.
- Cubrir todas las tallas observadas sin convertir una talla aislada en una corrida inventada.
- Inicio y final son inclusivos. La media talla fronteriza puede quedar en ambos tramos.
- Relacionar corridas no duplica la ficha estilo+color ni cambia inventario.
- Un renglón que no cae en enteros o medios se conserva como incidencia.

## Corridas por estilo

| Estilo | Orden | Línea | Corrida | Motivo |
|---|---:|---|---|---|
| `COS901` | 1 | NIÑAS | 12.0–17.5, inc. 0.5 | Confirmada por CLAREMM en SAZ para COÑAC, MELLE y NEGRO. |
| `COS901` | 2 | NIÑAS | 18.0–21.5, inc. 0.5 | Confirmada por CLAREMM para los tres colores. |
| `COS901` | 3 | NIÑAS | 21.5–27.0, inc. 0.5 | Confirmada por CLAREMM para los tres colores. Comparte la talla 21.5. |
| `435501` | 1 | NIÑOS | 18.0–21.5, inc. 0.5 | Coincide con la corrida histórica inferior. |
| `435501` | 2 | JOVEN | 21.5–27.0, inc. 0.5 | Coincide con la corrida histórica superior y conserva medias. |

Las relaciones de `435501` se infirieron a partir del catálogo histórico. Para `COS901`, la confirmación del 27 de noviembre de 2026 determina las corridas vigentes. El archivo COSHI del 16 de noviembre clasifica el tramo de 21.5 a 27.0 como DAMA y sirve como antecedente para revisar otros estilos.

## Altas y existencias en SAZ

El catálogo exportado de SAZ aporta las corridas registradas por estilo y color. El corte de JUÁREZ aporta cantidades por talla. El script `claremmscan/scripts/plan-saz-catalog-coverage.mjs` cruza ambos usando el comparativo de `audit-saz-stock.mjs`. Genera las hojas de solo existencia, altas y revisión. Cada saldo aparece en una sola hoja de detalle. Las tallas de frontera, las presentaciones ambiguas y las diferencias entre fuentes requieren confirmar el destino.

Para `059601` NEGRO se conserva la corrida existente de NIÑAS `18.0–21.5` y se programa el alta de JOVEN `21.5–27.5`, incremento `0.5`. El segundo rango se usa completo, incluso cuando la existencia por cargar solo incluye tallas entre 23 y 26.

## Evidencia rechazada, no perdida

| SAZ id | Línea | Texto visible | Incidencia |
|---:|---|---|---|
| 96 | NIÑAS | 15.0–17.8, inc. 0.5 | 17.8 no cae en medios números. |
| 107 | NIÑAS | 108.0–21.5, inc. 0.5 | Rango invertido; probable error de captura. |
| 22 | NIÑOS | 15.0–17.7, inc. 0.5 | 17.7 no cae en medios números. |

Se guardan en `public.corrida_import_issues`, inactivas, hasta que el negocio confirme la corrección.
