# CLAREMM Scan v17

Aplicación PWA para Vercel. Configura **Root Directory** en Vercel para que apunte a `claremmscan`. No requiere build; la función `api/ocr.js` procesa el reconocimiento por visión sin exponer la clave en el navegador.

## Funciones
- Cámara en vivo (HTTPS o localhost) y captura de múltiples fotografías.
- Carga de imágenes desde el dispositivo.
- Gemini en servidor para leer las etiquetas, OpenAI como respaldo opcional y OCR Tesseract.js como respaldo local.
- Captura manual con marca, edición, suma de cantidades ante duplicados, exportación XLSX/CSV/JSON y restauración de JSON.
- Importación masiva desde JSON, CSV o Excel con validación previa y elección explícita entre reemplazar o sumar.
- Al reemplazar el inventario descarga automáticamente una copia JSON de seguridad de los datos anteriores.
- Limpia automáticamente la fotografía de etiqueta después de guardar para preparar el siguiente producto.
- Imagen opcional por estilo + color, convertida a PNG de máximo 100 KB y exportación conjunta en ZIP.
- Captura directa de la imagen del producto con la cámara trasera del teléfono, además de selección desde la galería.
- Al editar un precio, lo aplica a todas las tallas y colores del mismo estilo tanto en el inventario anterior como en el catálogo relacional.
- Respaldo y sincronización con Supabase mediante correo/contraseña, RLS y Storage privado.
- Existencias separadas por sucursal; el stock actual se asigna a `CLAREMM ZAPATERIA JUAREZ`.
- Esquema relacional para catálogo SAZ, tallas, sucursales, existencias y movimientos históricos.
- Control de envío a SAZ por registro: `Pendiente`/`Cargado`, fecha de carga y origen, sin mezclar la tabla histórica de Supabase con las fuentes SQLite/Excel.
- Registro oficial de lotes SAZ, búsqueda indexada por estilo + color e indicadores de pares registrados, pendientes y porcentaje de avance.
- Módulo independiente de carga por sucursal: búsqueda del catálogo, captura individual, importación masiva y descarga de productos desconocidos.
- El buscador del inventario consulta también el catálogo y las existencias relacionales de Supabase, y muestra esos resultados en una sección separada del inventario histórico.
- Las tarjetas del inventario relacional indican si el producto está registrado en SAZ y permiten tomar o elegir una imagen compartida por estilo + color, comprimida como PNG de máximo 100 KB.
- La imagen relacional es la referencia principal: también se copia al almacenamiento anterior, y **Exportar imágenes** reúne ambas fuentes sin duplicar nombres.
- Interfaz oscura tipo estación de trabajo, adaptable a teléfonos de 320 px, tablets y escritorio.
- Mantiene la clave `claremmscan-v1` de localStorage para preservar los registros del navegador existente.

## Configurar Supabase

1. Crea un proyecto en Supabase.
2. Abre **SQL Editor**, pega y ejecuta todo [supabase/schema.sql](supabase/schema.sql). Esto actualiza la tabla compatible, agrega `marca` y `sucursal`, crea el bucket privado y conserva los registros existentes.
3. Para el catálogo final SAZ y existencias por sucursal, ejecuta también [supabase/relational-schema.sql](supabase/relational-schema.sql) y sigue [la guía de migración relacional](supabase/RELATIONAL_MIGRATION.md). Este esquema no borra `inventory_items` durante la transición.
4. Si las tablas ya existían antes del control de SAZ, ejecuta [supabase/saz-status-migration.sql](supabase/saz-status-migration.sql). Todos los registros de `inventory_items` existentes quedan como `Pendiente de SAZ` y con origen `supabase_legacy`; no se copian a las tablas relacionales.
5. Para incorporar archivos confirmados como cargados en SAZ, ejecuta [supabase/saz-registered-schema.sql](supabase/saz-registered-schema.sql). Crea el registro oficial por estilo + color, existencias SAZ por sucursal, auditoría de archivos e índices de búsqueda.
6. Ejecuta [supabase/relational-product-images.sql](supabase/relational-product-images.sql) para permitir que los miembros autorizados de la organización consulten y actualicen las imágenes del catálogo relacional.
7. En **Authentication → URL Configuration**, configura **Site URL** como `https://scamapp-phi.vercel.app/` y agrega esa misma dirección en **Redirect URLs**. Si también registrarás cuentas desde previews de Vercel, agrega el patrón de preview que corresponda a tu proyecto.
8. Si personalizaste la plantilla **Confirm signup**, usa `{{ .ConfirmationURL }}` en el enlace. Si construiste el enlace manualmente, usa `{{ .RedirectTo }}` en lugar de `{{ .SiteURL }}` para respetar la URL enviada por la app.
9. En Vercel agrega `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` para Production, Preview y Development.
10. Vuelve a desplegar. Crea una cuenta desde la app, confirma el correo y pulsa **Sincronizar ahora**.

Si el enlace indica `otp_expired`, escribe el correo en la app y pulsa **Reenviar correo**. Abre únicamente el mensaje más reciente: los enlaces anteriores dejan de ser válidos.

La primera sincronización sube los registros e imágenes que ya existan localmente. Después, cada cambio queda en una cola local hasta que Supabase confirma que se guardó.

## Configurar el reconocimiento por visión

1. Crea `claremmscan/.env.local` a partir de `.env.example` y agrega `GEMINI_API_KEY`. `.env.local` está excluido de Git.
2. Para ejecutar las cinco pruebas reales de `tests/prueba`, entra a `claremmscan` y ejecuta `node --env-file=.env.local scripts/test-vision.js`.
3. En Vercel agrega `GEMINI_API_KEY` en **Settings → Environment Variables** para Production, Preview y Development, y vuelve a desplegar.
4. `GEMINI_VISION_MODEL` es opcional; el valor predeterminado es `gemini-3.5-flash-lite`.
5. `OPENAI_API_KEY` es opcional y solo se usa como segundo proveedor si Gemini falla.

Nunca pongas la clave en `app.js`, `index.html`, una captura de pantalla o un commit.

## Limitaciones importantes

Aunque la visión mejora considerablemente fotos inclinadas o con poco contraste, cada lectura sigue requiriendo revisión. Si la función de visión no está configurada o falla, la app usa Tesseract local; ese respaldo no reconoce de forma confiable todas las etiquetas.

El inventario mantiene una copia local para trabajar sin conexión. Al iniciar sesión también se guarda en Supabase y puede recuperarse en otro dispositivo con la misma cuenta.

Las imágenes se guardan por separado en IndexedDB. El respaldo JSON no las incluye; usa **Exportar imágenes (.zip)** para respaldarlas.

## Uso
1. Abre la app desde HTTPS.
2. Pulsa Abrir cámara > Capturar foto (repite si quieres) o Cargar fotografías.
3. Pulsa Leer etiquetas.
4. Revisa y corrige los resultados, marca las filas y guarda.
5. Exporta a Excel o realiza respaldo JSON.

En celulares y tablets, cada tarjeta tiene un botón **Ocultar/Mostrar** para reducir el desplazamiento. La app recuerda qué secciones cerraste en ese dispositivo; las secciones de revisión y edición se abren automáticamente cuando el flujo las necesita.

## Importación masiva

Pulsa **Importar inventario** y selecciona un archivo `.json`, `.csv`, `.xlsx` o `.xls`. La app muestra registros, pares, valor, duplicados y filas inválidas antes de hacer cambios.

Las columnas compatibles son: `Sucursal`, `Estilo`, `Marca`, `Color`, `Tipo de línea`, `Talla`, `Cantidad`, `Material`, `Precio`, `Notas`, `Cargado en SAZ`, `Fecha carga SAZ` y `Origen`. En JSON también se aceptan las claves internas en minúsculas. Si un archivo anterior no contiene `Sucursal`, se asigna `CLAREMM ZAPATERIA JUAREZ`; cualquier valor provisional `MATRIZ` también se convierte automáticamente. Si no incluye estado SAZ, se importa como pendiente.

- **Reemplazar todo:** crea primero un respaldo JSON automático y sustituye el inventario.
- **Sumar al inventario:** agrega registros nuevos y acumula cantidades cuando coinciden sucursal, estilo, color y talla.

## Carga de existencias por sucursal

El botón **Carga por sucursal** abre un espacio separado del inventario principal. La tienda base `CLAREMM ZAPATERIA JUAREZ` queda excluida: el módulo solo se habilita cuando existe otra sucursal activa en la tabla relacional `branches`.

- **Captura individual:** busca el catálogo por estilo o color, selecciona la ficha, escribe talla y cantidad, y elige entre establecer la existencia o sumar una entrada.
- **Importación masiva:** acepta JSON, CSV y Excel con una fila por talla. Las columnas mínimas son `Estilo`, `Color`, `Talla` y `Cantidad`; la sucursal se selecciona una sola vez en la app.
- **Productos desconocidos:** se detienen y pueden descargarse en `CLAREMM_Productos_Desconocidos.xlsx`. Para reimportarlos, completa `Marca`, `Tipo de línea` y `Material`, cambia `Crear producto` a `SI` y activa la autorización dentro de la app.
- **Casos ambiguos:** si estilo + color apunta a más de una ficha y no existe una relación oficial, no se crea un duplicado; queda pendiente para revisión manual.
- **Establecer cantidades:** cambia solamente las variantes incluidas en el archivo y no elimina tallas ausentes.
- **Sumar entrada:** agrega la cantidad indicada a la existencia actual de cada talla.

Puedes descargar la plantilla directamente desde el módulo. Cada operación genera movimientos relacionales en Supabase para conservar el historial.

## Instalación como app
- Android (Chrome/Samsung Internet): abre la versión HTTPS y pulsa **Instalar app**.
- iPhone/iPad: abre la versión HTTPS, toca **Compartir** y elige **Agregar a pantalla de inicio**.
- La instalación no funciona abriendo `index.html` directamente con `file://`; usa Vercel o un servidor HTTPS.

## Seguridad

Las claves privadas de visión solo se leen en `api/ocr.js`. La clave publicable de Supabase puede llegar al navegador porque RLS protege cada fila; nunca uses `service_role` en la aplicación. En OpenAI las respuestas no se almacenan mediante `store: false`. Los scripts Supabase, Tesseract, XLSX y JSZip se cargan desde CDN; para producción, fija y audita dependencias.
