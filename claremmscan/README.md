# CLAREMM Scan — prototipo funcional

Aplicación web instalable (PWA) para fotografiar etiquetas de calzado, revisar los campos detectados, guardar registros y exportar Excel.

## Iniciar

En la carpeta del proyecto:

```bash
npx serve . -l 5174
```

Abre `http://localhost:5174` en tu PC. Para usar la cámara e instalarla en Android, publícala en un dominio HTTPS (por ejemplo Vercel) y abre esa URL en Chrome > menú > Agregar a pantalla principal.

En Vercel: importa el repositorio con estos archivos, Framework Preset: Other, sin build, Output Directory: `.`.

## Importante

- Los registros se guardan en el almacenamiento local del navegador, **no en una base de datos compartida**. No se sincronizan entre dispositivos y se perderán si borras los datos del navegador. Exporta respaldos periódicamente.
- OCR mediante Tesseract.js, descargado desde CDN; requiere internet para cargar el motor y puede fallar con etiquetas borrosas. Revisa siempre antes de guardar.
- El reconocimiento del código es heurístico y se orienta a estilos LAP, UN, ANG, SP y UNGOLD; puedes editar cualquier campo manualmente.
- Para sincronización multiusuario y almacenamiento confiable se necesita backend/API, base de datos y autenticación.
