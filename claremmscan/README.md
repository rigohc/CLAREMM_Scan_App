# CLAREMM Scan v17

Reglas, workflow y arquitectura (hexágono, eventos, POS): [AGENTS.md](../AGENTS.md), [docs/](../docs/).

Aplicación PWA para Vercel. Configura **Root Directory** en Vercel para que apunte a `claremmscan`. No requiere build; la función `api/ocr.js` procesa el reconocimiento por visión sin exponer la clave en el navegador.

## Funciones
- Cámara en vivo (HTTPS o localhost) y captura de múltiples fotografías.
- Carga de imágenes desde el dispositivo.
- Gemini en servidor para leer las etiquetas, OpenAI como respaldo opcional y OCR Tesseract.js como respaldo local.
- Captura manual y OCR con cola local de entradas. La existencia oficial, la consulta y XLSX/CSV/JSON salen de las tablas relacionales.
- Carga por sucursal con validación previa. El escáner no ofrece reemplazar el inventario.
- Limpia automáticamente la fotografía de etiqueta después de guardar para preparar el siguiente producto.
- Imagen opcional por estilo + color, convertida a PNG de máximo 100 KB y exportación conjunta en ZIP.
- Captura directa de la imagen del producto con la cámara trasera del teléfono, además de selección desde la galería.
- Un precio confirmado aplica a los colores del mismo estilo y corrida.
- Respaldo y sincronización con Supabase mediante correo/contraseña, RLS y Storage privado.
- Existencias separadas por sucursal; el stock actual se asigna a `CLAREMM ZAPATERIA JUAREZ`.
- Esquema relacional para catálogo SAZ, tallas, sucursales, existencias y movimientos históricos.
- Registro oficial de lotes SAZ y estados por ficha. Una ficha con faltantes en alguna talla sigue pendiente.
- Módulo independiente de carga por sucursal: búsqueda del catálogo, captura individual, importación masiva y descarga de productos desconocidos.
- Buscador relacional por estilo y color. Las variantes con tallas equivalentes se agrupan por sucursal.
- Las tarjetas del inventario relacional indican si el producto está registrado en SAZ y permiten tomar o elegir una imagen compartida por estilo + color, comprimida como PNG de máximo 100 KB.
- Las imágenes del catálogo se consultan desde Storage y pueden conservar una copia local.
- Interfaz oscura tipo estación de trabajo, adaptable a teléfonos de 320 px, tablets y escritorio.
- La tabla `inventory_items` y las copias locales anteriores se conservan como archivo histórico.

## Configurar Supabase

1. Crea un proyecto en Supabase.
2. En **SQL Editor**, ejecuta [supabase/relational-schema.sql](supabase/relational-schema.sql) para crear el catálogo e inventario por sucursal.
3. Ejecuta [supabase/saz-registered-schema.sql](supabase/saz-registered-schema.sql) para el registro de existencias SAZ y [supabase/relational-product-images.sql](supabase/relational-product-images.sql) para habilitar Storage.
4. Ejecuta [corridas-schema.sql](supabase/corridas-schema.sql) para crear el catálogo maestro de corridas, sus fuentes SAZ y las relaciones por estilo.
5. Ejecuta [relational-stock-increase.sql](supabase/relational-stock-increase.sql) después de esos esquemas.
6. En **Authentication → URL Configuration**, configura **Site URL** como `https://scamapp-phi.vercel.app/` y agrega esa misma dirección en **Redirect URLs**. Para una plantilla personalizada, usa `{{ .ConfirmationURL }}` o `{{ .RedirectTo }}` según corresponda.
7. Configura `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` en Vercel. Publica la PWA y verifica una captura y una exportación.
8. En una instalación con inventario anterior, revisa las capturas pendientes de los escáneres antes de actualizar. Después ejecuta [retire-legacy-inventory-access.sql](supabase/retire-legacy-inventory-access.sql) para retirar el acceso de la app al archivo histórico.

Si el enlace indica `otp_expired`, escribe el correo en la app y pulsa **Reenviar correo**. Abre únicamente el mensaje más reciente: los enlaces anteriores dejan de ser válidos.

La sincronización envía las capturas en cola de la cuenta del escáner. Una captura solo cuenta como existencia oficial después de que Supabase confirme el movimiento.

## Configurar el reconocimiento por visión

1. Crea `claremmscan/.env.local` a partir de `.env.example` y agrega `GEMINI_API_KEY`. `.env.local` está excluido de Git.
2. Para ejecutar las cinco pruebas reales de `tests/prueba`, entra a `claremmscan` y ejecuta `node --env-file=.env.local scripts/test-vision.js`.
3. En Vercel agrega `GEMINI_API_KEY` en **Settings → Environment Variables** para Production, Preview y Development, y vuelve a desplegar.
4. `GEMINI_VISION_MODEL` es opcional; el valor predeterminado es `gemini-3.5-flash-lite`.
5. `OPENAI_API_KEY` es opcional y solo se usa como segundo proveedor si Gemini falla.

Nunca pongas la clave en `app.js`, `index.html`, una captura de pantalla o un commit.

## Limitaciones importantes

Aunque la visión mejora considerablemente fotos inclinadas o con poco contraste, cada lectura sigue requiriendo revisión. Si la función de visión no está configurada o falla, la app usa Tesseract local; ese respaldo no reconoce de forma confiable todas las etiquetas.

Después de iniciar sesión por primera vez, el escáner puede guardar capturas sin red. La consulta y las exportaciones de existencia actual requieren acceso a Supabase.

Las imágenes se guardan por separado en IndexedDB. El respaldo JSON no las incluye; usa **Exportar imágenes (.zip)** para respaldarlas.

## Uso
1. Abre la app desde HTTPS.
2. Pulsa Abrir cámara > Capturar foto (repite si quieres) o Cargar fotografías.
3. Pulsa Leer etiquetas.
4. Revisa y corrige los resultados, marca las filas y guarda.
5. Exporta a Excel o realiza respaldo JSON.

En celulares y tablets, cada tarjeta tiene un botón **Ocultar/Mostrar** para reducir el desplazamiento. La app recuerda qué secciones cerraste en ese dispositivo; las secciones de revisión y edición se abren automáticamente cuando el flujo las necesita.

## Exportaciones

**Excel existencia actual** muestra el stock de cada sucursal. **Excel fichas por preparar** usa fichas de JUÁREZ pendientes de precio o imagen. El informe **Por cargar** de la auditoría SAZ reporta el saldo contra un corte de SAZ, con columnas separadas para la existencia del aplicativo y la de SAZ.

### Conciliación diaria de existencias SAZ

En **Inventario**, pulsa **Conciliar existencias SAZ** y selecciona el Excel de existencias exportado por SAZ. La vista previa indica productos válidos, pares, fichas nuevas e incidencias antes de escribir en Supabase.

- Los productos originados en el escáner quedan como `REGISTRADO EN SAZ` cuando el corte cubre todas las tallas. Si falta algún par quedan como `PENDIENTE EN SAZ`.
- Los productos que no existen en Supabase se crean como `YA PRECARGADO EN SAZ`.
- Una ficha ya precargada solo recibe la existencia del archivo cuando todavía no tiene existencia en JUÁREZ.
- JUÁREZ puede aumentar o agregar tallas, pero nunca disminuirlas.
- El conciliador no modifica precio ni imagen.
- Una fila con cantidades negativas o cuyo total no cuadre bloquea ese estilo + color completo y se muestra como incidencia para corregirlo en el Excel.

## Carga de existencias por sucursal

El botón **Carga por sucursal** abre un espacio para trabajar con sucursales activas de `branches`. JUÁREZ admite altas y aumentos individuales. La carga masiva por sucursal corresponde a sucursales distintas de JUÁREZ.

- **Captura individual:** busca el catálogo por estilo o color, selecciona la ficha, escribe talla y cantidad, y elige entre establecer la existencia o sumar una entrada.
- **Importación masiva:** acepta JSON, CSV y Excel con una fila por talla. Las columnas mínimas son `Estilo`, `Color`, `Talla` y `Cantidad`; la sucursal se selecciona una sola vez en la app.
- **Productos desconocidos:** se detienen y pueden descargarse en `CLAREMM_Productos_Desconocidos.xlsx`. Para reimportarlos, completa `Marca`, `Tipo de línea` y `Material`, cambia `Crear producto` a `SI` y activa la autorización dentro de la app.
- **Casos ambiguos:** si estilo + color apunta a más de una ficha y no existe una relación oficial, no se crea un duplicado; queda pendiente para revisión manual.
- **Establecer cantidades:** cambia solamente las variantes incluidas en el archivo y no elimina tallas ausentes.
- **Sumar entrada:** agrega la cantidad indicada a la existencia actual de cada talla.

Puedes descargar la plantilla directamente desde el módulo. Cada operación genera movimientos relacionales en Supabase para conservar el historial.

## API de carga por sucursal (`/api/v1`)

Pensada para un agente externo. Autenticación: header `X-API-Key` (variable `CLAREMM_AGENT_API_KEY` en Vercel). Alcance: catálogo e inventario relacional; no toca usuarios ni facturación.

- `GET /api/v1/branches`
- `GET /api/v1/catalog/products?estilo=&color=&marca=`
- `GET /api/v1/catalog/products/{ficha_id}`
- `GET /api/v1/catalog/corridas?linea=&estilo=` — lista reglas canónicas y sus ids fuente de SAZ
- `POST /api/v1/catalog/corridas` — agrega una regla validada (`linea`, `inicial`, `final`, `incremento`, `motivo`; `saz_id` opcional)
- `GET /api/v1/catalog/styles/{estilo}/corridas`
- `POST /api/v1/catalog/styles/{estilo}/corridas` — relaciona `corrida_id`, `orden` y `motivo`; no toca existencias
- `GET /api/v1/branches/{JUAREZ|NUEVO_LEON}/inventory?estilo=&color=&talla=`
- `POST /api/v1/branches/{branch}/upload/preview` — nunca escribe
- `POST /api/v1/branches/{branch}/upload/apply` — `mode` obligatorio (`set` o `sum`), `batch_id` único, `create_unknowns` para altas
- `POST /api/v1/branches/{JUAREZ\|NUEVO_LEON}/sizes` — agrega o actualiza tallas (`mode`: `set` o `sum`, `motivo` obligatorio). En JUÁREZ solo suma o deja; nunca baja.
- `PATCH /api/v1/catalog/products/{ficha_id}` — corrige estilo, color, corrida, marca, tipo, material, precio (`confirmar_precio` si el precio actual es &gt; 0). `motivo` obligatorio
- `DELETE /api/v1/catalog/products/{ficha_id}` — baja lógica (`activo=false`); no borra existencias de JUÁREZ
- `GET /api/v1/branches/{branch}/history?batch_id=`
- `GET /api/v1/review/pending?branch=&estado=`

Reglas: color exacto (N/B sí es alias de NEGRO BLANCO; NEGRO BLANCO no es BLANCO NEGRO); ceros a la izquierda se igualan; no se pisa imagen ni precio &gt; 0 sin `confirmar_precio`; `set`/`sum` solo en la sucursal indicada; **carga masiva `upload` no toca JUÁREZ**; **tallas en JUÁREZ sí**, sin bajar pares. Reaplicar el mismo `batch_id` no duplica pares. La baja de ficha es `CatalogProductDeactivated`, no un `DELETE` físico.

Nombre canónico de la sucursal base: código `JUAREZ`, nombre visible `CLAREMM ZAPATERIA JUAREZ`.

En la app, **Revisión pendiente** muestra fichas nuevas, precios heredados o en $0, desajustes PIEL vs SINTETICO, y permite corregir y exportar Excel.

## Instalación como app
- Android (Chrome/Samsung Internet): abre la versión HTTPS y pulsa **Instalar app**.
- iPhone/iPad: abre la versión HTTPS, toca **Compartir** y elige **Agregar a pantalla de inicio**.
- La instalación no funciona abriendo `index.html` directamente con `file://`; usa Vercel o un servidor HTTPS.

## Seguridad

Las claves privadas de visión solo se leen en `api/ocr.js`. La clave publicable de Supabase puede llegar al navegador porque RLS protege cada fila; nunca uses `service_role` en la aplicación. En OpenAI las respuestas no se almacenan mediante `store: false`. Los scripts Supabase, Tesseract, XLSX y JSZip se cargan desde CDN; para producción, fija y audita dependencias.
