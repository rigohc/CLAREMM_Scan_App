# CLAREMM Scan v17

Aplicación PWA para Vercel. Configura **Root Directory** en Vercel para que apunte a `claremmscan`. No requiere build; la función `api/ocr.js` procesa el reconocimiento por visión sin exponer la clave en el navegador.

## Funciones
- Cámara en vivo (HTTPS o localhost) y captura de múltiples fotografías.
- Carga de imágenes desde el dispositivo.
- Gemini en servidor para leer las etiquetas, OpenAI como respaldo opcional y OCR Tesseract.js como respaldo local.
- Captura manual con marca, edición, suma de cantidades ante duplicados, exportación XLSX/CSV/JSON y restauración de JSON.
- Limpia automáticamente la fotografía de etiqueta después de guardar para preparar el siguiente producto.
- Imagen opcional por estilo + color, convertida a PNG de máximo 100 KB y exportación conjunta en ZIP.
- Respaldo y sincronización con Supabase mediante correo/contraseña, RLS y Storage privado.
- Interfaz oscura tipo estación de trabajo, adaptable a teléfonos de 320 px, tablets y escritorio.
- Mantiene la clave `claremmscan-v1` de localStorage para preservar los registros del navegador existente.

## Configurar Supabase

1. Crea un proyecto en Supabase.
2. Abre **SQL Editor**, pega y ejecuta todo [supabase/schema.sql](supabase/schema.sql). Esto crea la tabla, el bucket privado y las políticas RLS. Si ya habías creado la tabla, vuelve a ejecutar el archivo para agregar `marca`; la migración usa `add column if not exists` y no borra tus registros.
3. En **Authentication → URL Configuration**, configura **Site URL** como `https://scamapp-phi.vercel.app/` y agrega esa misma dirección en **Redirect URLs**. Si también registrarás cuentas desde previews de Vercel, agrega el patrón de preview que corresponda a tu proyecto.
4. Si personalizaste la plantilla **Confirm signup**, usa `{{ .ConfirmationURL }}` en el enlace. Si construiste el enlace manualmente, usa `{{ .RedirectTo }}` en lugar de `{{ .SiteURL }}` para respetar la URL enviada por la app.
5. En Vercel agrega `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` para Production, Preview y Development.
6. Vuelve a desplegar. Crea una cuenta desde la app, confirma el correo y pulsa **Sincronizar ahora**.

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

## Instalación como app
- Android (Chrome/Samsung Internet): abre la versión HTTPS y pulsa **Instalar app**.
- iPhone/iPad: abre la versión HTTPS, toca **Compartir** y elige **Agregar a pantalla de inicio**.
- La instalación no funciona abriendo `index.html` directamente con `file://`; usa Vercel o un servidor HTTPS.

## Seguridad

Las claves privadas de visión solo se leen en `api/ocr.js`. La clave publicable de Supabase puede llegar al navegador porque RLS protege cada fila; nunca uses `service_role` en la aplicación. En OpenAI las respuestas no se almacenan mediante `store: false`. Los scripts Supabase, Tesseract, XLSX y JSZip se cargan desde CDN; para producción, fija y audita dependencias.
