# CLAREMM Scan v14

Aplicación PWA para Vercel. Configura **Root Directory** en Vercel para que apunte a `claremmscan`. No requiere build; la función `api/ocr.js` procesa el reconocimiento por visión sin exponer la clave en el navegador.

## Funciones
- Cámara en vivo (HTTPS o localhost) y captura de múltiples fotografías.
- Carga de imágenes desde el dispositivo.
- Visión en servidor para leer las etiquetas y OCR Tesseract.js como respaldo local.
- Captura manual, edición, suma de cantidades ante duplicados, exportación XLSX/CSV/JSON y restauración de JSON.
- Imagen opcional por estilo + color, convertida a PNG de máximo 100 KB y exportación conjunta en ZIP.
- Mantiene la clave `claremmscan-v1` de localStorage para preservar los registros del navegador existente.

## Configurar el reconocimiento por visión

1. Crea `claremmscan/.env.local` a partir de `.env.example` y agrega tu clave real. `.env.local` está excluido de Git.
2. Para ejecutar las cinco pruebas reales de `tests/prueba`, entra a `claremmscan` y ejecuta `node --env-file=.env.local scripts/test-vision.js`.
3. En Vercel agrega `OPENAI_API_KEY` en **Settings → Environment Variables** para Production, Preview y Development, y vuelve a desplegar.
4. `OPENAI_VISION_MODEL` es opcional; el valor predeterminado es `gpt-6-luna`.

Nunca pongas la clave en `app.js`, `index.html`, una captura de pantalla o un commit.

## Limitaciones importantes

Aunque la visión mejora considerablemente fotos inclinadas o con poco contraste, cada lectura sigue requiriendo revisión. Si la función de visión no está configurada o falla, la app usa Tesseract local; ese respaldo no reconoce de forma confiable todas las etiquetas.

El inventario se guarda **solo en el navegador/dispositivo**. Vercel no sincroniza los datos entre usuarios. Para inventario compartido agrega un backend con base de datos y autenticación.

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

La clave solo se lee en la función de servidor `api/ocr.js`; el navegador nunca la recibe. Las respuestas no se almacenan mediante la opción `store: false`. Los scripts Tesseract, XLSX y JSZip se cargan desde CDN; para un despliegue de producción, fija y audita dependencias.
