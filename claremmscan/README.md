# CLAREMM Scan v2

Aplicación estática para Vercel. Coloca estos cuatro archivos en la raíz del proyecto publicado, o configura **Root Directory** en Vercel para apuntar a la carpeta que los contiene. No requiere build.

## Funciones
- Cámara en vivo (HTTPS o localhost) y captura de múltiples fotografías.
- Carga de imágenes desde el dispositivo.
- OCR Tesseract.js, reconocimiento heurístico de posibles etiquetas y revisión en tabla antes de guardar.
- Captura manual, edición, suma de cantidades ante duplicados, exportación XLSX/CSV/JSON y restauración de JSON.
- Imagen opcional por estilo + color, convertida a PNG de máximo 100 KB y exportación conjunta en ZIP.
- Mantiene la clave `claremmscan-v1` de localStorage para preservar los registros del navegador existente.

## Limitaciones importantes
El OCR **no detecta de forma confiable todas las etiquetas de una foto** ni garantiza asociación correcta de código, color y talla cuando hay varias cajas en columnas, etiquetas solapadas o texto inclinado. El parser genera candidatos y requiere revisión. No se deben guardar automáticamente como datos verificados. Para producción conviene detección por regiones (visión artificial) y pruebas con fotos reales.

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
No incluyas claves de API en JavaScript público. Los scripts Tesseract y XLSX se cargan desde CDN. Para un despliegue de producción, fija y audita dependencias. El OCR se ejecuta en el navegador.
