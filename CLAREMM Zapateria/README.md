# 👞 CLAREMM Zapatería — Panel VIP de Control & Captura con Gemini AI

Sistema integral y responsive para captura, digitalización y administración de inventario de calzado con **Node.js, SQLite, Vite, React** e **Inteligencia Artificial Multimodal (Google Gemini)**.

---

## 🌟 Características Principales

### 1. Panel de Control VIP & Responsive
- **Diseño Luxury & VIP**: Paleta oscura medianoche con acabados en oro champán (*Champagne Gold*), efectos de cristal (*Glassmorphism*), tipografía ejecutiva y microinteracciones fluidas.
- **100% Adaptable / Responsive**: Vista en tabla ejecutiva para computadoras y laptops, y vista de tarjetas de lujo optimizada para smartphones y tablets.
- **Métricas KPI en Tiempo Real**: Total de estilos, marcas activas, líneas de calzado e indicador de estado de IA.

### 2. Captura Dual de Fotografías (Cámara / Subida)
Al pulsar el botón **"Capturar"**, el sistema permite obtener dos fotografías:
1. **Fotografía del Producto**: Imagen del calzado terminado (con visor de cámara en vivo / webcam, cambio de cámara frontal/trasera y selector de archivos).
2. **Fotografía de la Ficha Técnica**: Imagen de la ficha, etiqueta o caja del producto.

#### Imagen de referencia por estilo y color
- Al escribir el estilo y color en **Capturar Producto**, se busca una imagen con el nombre `ESTILO-COLOR` en la carpeta configurada.
- La coincidencia se muestra como vista previa y se copia al almacenamiento del producto al guardar. Una foto subida o tomada manualmente tiene prioridad.
- Por defecto se usa `C:\Users\klary\OneDrive\Imágenes\CLAREMM IMAGE`. Se puede cambiar con `PRODUCT_IMAGES_DIR` en `backend/.env`.
- Se admiten `.png`, `.jpg`, `.jpeg`, `.bmp`, `.gif` y `.webp`. Si hay varias imágenes para el mismo estilo y color, se solicita dejar solo una.

### 3. Extracción Inteligente con Gemini AI & Detección de Código de Barras
- Analiza la imagen de la ficha técnica usando modelos multimodales de Google Gemini (`gemini-2.5-flash`, `gemini-1.5-flash`, `gemini-2.0-flash`).
- **Detección y Alerta de Código de Barras Repetido**:
  - Tanto al capturar mediante Gemini AI como al teclear o escanear un código de barras en el formulario, el sistema verifica en tiempo real si el código ya existe en la base de datos.
  - Si se detecta un duplicado, muestra una **Alerta VIP inmediata**:
    `⚠️ ALERTA: CÓDIGO DE BARRAS REPETIDO: El código ya pertenece al producto [Estilo - Marca (ID #X)].`
  - En la importación masiva de Excel, reporta cualquier código de barras duplicado dentro del archivo o que ya exista en el inventario.
- **Los Datos Capturados**:
  0. `codigo_barras` (Código EAN-13, UPC o serie de barras)
  1. `estilo` (Estilo o modelo)
  2. `color`
  3. `acabado` (Piel Napa, Gamuza, Charol, Cuero Graso, etc.)
  4. `marca` (solo si está claramente impresa; la IA no asume CLAREMM como marca)
  5. `temporada` (Primavera/Verano, Otoño/Invierno, Atemporal)
  6. `proveedor` (Fábrica, taller o tenería)
  7. `sublinea` (Vestir Formal, Casual Confort, Alta Noche, etc.)
  8. `clasificacion` (Caballero, Dama, Niño, Niña, Unisex)
  9. `linea` (Formal, Casual, Mocasín, Bota, Sandalia, Tenis)
- La **Corrida de tallas** se captura en el formato `21.50-27.00`, se muestra en el catálogo y se incluye en la exportación Excel.
- **Existencias por talla**: al capturar un producto, puedes registrar pares en una cuadrícula táctil generada desde la corrida. Desde el botón **Existencias** también puedes localizar un producto por estilo o identificarlo desde una foto de su ficha, y luego sumar una entrada o reemplazar el conteo. El modo independiente **Escaneo rápido +1** lee estilo, color y talla individual de la etiqueta, valida la talla contra la corrida y suma exactamente un par; si hay más de un producto posible, pide elegirlo antes de modificar existencias. Las casillas vacías no cambian el inventario; el valor `0` sí permite dejar una talla en cero. El Excel **Existencias por talla** exporta una fila por producto y talla.
- **Campos obligatorios del catálogo**: todo producto debe tener Corrida, Catálogo y Línea. Las filas que no incluyan esos tres datos se omiten de las importaciones y se reportan; captura y edición también los exigen, y la base de datos bloquea inserciones o cambios que los dejen vacíos.
- En móvil, el formulario de captura usa la pantalla completa y, después de confirmar el guardado, regresa automáticamente al inicio para comenzar con las fotos del siguiente producto.
- Los campos categóricos (color, corrida, acabado, marca, proveedor, sublínea, clasificación, línea y especificaciones) permiten escribir para filtrar sugerencias o ingresar un valor nuevo. El archivo histórico `Document.xls` aporta listas sin duplicados de 842 colores, 291 acabados, 76 corridas válidas, 2,102 marcas, 110 sublíneas, 40 líneas, 14 clasificaciones, 26 temporadas y 2 catálogos; también incluye plantilla, comprador y status. Proveedor usa la lista dedicada compartida por el equipo y se exporta en su propia columna para el agente SAZ; Sublínea también se conserva separada de Marca. Solo Temporada y Observaciones se precargan en el formulario.
- **Notificación Inteligente de Datos Faltantes**:
  Si algún dato no aparece en la ficha técnica, el sistema emite una notificación visual detallando los campos faltantes para que el operador pueda **llenarlos manualmente** o **dejarlos vacíos**.
- **Botón Guardar Producto**:
  Guarda la ficha e imágenes en SQLite, lanza animación de confeti y sincroniza la tabla.

### 4. Sincronización en Tiempo Real (SSE)
- Conexión persistente mediante **Server-Sent Events (`/events`)**.
- Toda creación, edición, eliminación o importación desde Excel se refleja **instantáneamente en todas las pantallas y pestañas abiertas** sin necesidad de recargar la página.

### 5. Tabla con Paginación y Búsqueda
- Paginación dinámica (5, 10, 25, 50 registros por página).
- Búsqueda en tiempo real sobre los 9 campos.
- Filtros de fecha de registro desde/hasta, aplicados al catálogo completo antes de paginar; fechas opcionales y rango inclusivo.
- Filtros por Clasificación (Caballero, Dama, Niño, Niña, Unisex).
- **Lightbox / Visor en Alta Definición**: Clic en la miniatura para ver la foto del calzado o la ficha técnica en pantalla completa.
- **Acciones por Fila**:
  - ✏️ **Editar**: Modificar cualquiera de los 9 campos y cambiar la fotografía.
  - 🗑️ **Eliminar**: Diálogo de confirmación VIP para eliminar el registro.

### 6. Importación y Exportación en Formato Excel
- **Botón Importar Excel**: Carga masiva con vista previa de columnas y compatibilidad con `.xlsx` y `.xls`.
- **Importar lista desde Excel**: desde **Importar Excel**, elige esta opción para listas con `Estilo`, `Color` y `Precio` (acepta también `Estilo / Modelo` y `Precio de Venta`). Selecciona un producto base y marca cuáles de sus campos generales quieres heredar. También puedes incluir en el Excel columnas para Acabado, Descripción, Corrida, Estado, Fecha alta, Marca, Temporada, Proveedor, Sublínea, Clasificación, Línea, Departamento, Observaciones, Suela, Plantilla, Tacón, Forro, Catálogo, Comprador, Página y Status; en productos nuevos, los valores del Excel tienen prioridad sobre los heredados. El Costo se calcula al 70% del Precio. Si hay una sola coincidencia activa por Estilo+Color, solo actualiza Estilo, Color, Precio y Costo calculado; si hay varias coincidencias, las reporta sin modificarlas. Nunca copia código de barras, fotos ni existencias del producto base. La vista previa del importador completo muestra todos los encabezados y campos; en móvil se presentan por registro y la tabla se pagina para poder revisar todas las filas.
- **Descarga de Plantilla Oficial**: Genera un archivo `.xlsx` preformateado con la hoja `Importacion_AIO` y los encabezados que acepta el Agente SAZ.
- **Exportar a Excel**: Permite descargar todos los productos, solo zapatos o solo ropa, y filtrar por fecha de registro desde/hasta. Ambas fechas inician con el día actual. El archivo conserva la hoja `Importacion_AIO`, las columnas independientes para Marca, Proveedor y Sublínea, además de Suela, Departamento, Tacón y Forro, compatible con el Agente SAZ. Las corridas se conservan como rango, por ejemplo `21.50-27.00`.
- **Imágenes para SAZ**: El botón **"Imágenes para SAZ"** descarga un ZIP con las imágenes locales disponibles, nombradas `ESTILO-COLOR.ext`. Descomprímelo en la carpeta configurada para imágenes del agente; los productos sin una foto local se reportan en la notificación.
- **Agente SAZ**: el agente solo valida y captura Costo y Precio1 en altas; ignora Precio2 a Precio10, incluso si tienen texto, y los deja intactos en SAZ. Los productos duplicados se guardan en `precios_pendientes_saz.csv` con los datos para localizarlos. En el agente, abre **Listas de Precio** y pulsa **Actualizar Precio1 pendientes**: selecciona las referencias del producto, busca el estilo, confirma color/acabado/corrida y actualiza solo la columna **Precio** (Precio1). Solo marca la fila como actualizada si encuentra una coincidencia exacta única y verifica el nuevo valor después de Enter.

### 7. Configuración de API Key de Gemini
- Se puede configurar directamente desde la interfaz web haciendo clic en el botón de la barra superior (**"Gemini AI"** / **"Configurar Key"**), sin necesidad de reiniciar el servidor.
- También es configurable mediante la variable de entorno `GEMINI_API_KEY` en el archivo `backend/.env`.

---

## 🚀 Puesta en Marcha Rápida

### Opción 1: Con el Acceso Directo (Recomendado en Windows)
Simplemente haz doble clic en el archivo:
```bash
iniciar_sistema.bat
```
Esto iniciará el backend y el frontend automáticamente y abrirá tu navegador en `http://localhost:5173`.

---

### Opción 2: Modo Desarrollo (Terminal)

#### 1. Iniciar Backend (Puerto 3001)
```bash
cd backend
node server.js
```

#### 2. Iniciar Frontend (Puerto 5173)
En otra terminal:
```bash
cd frontend
npm run dev
```
Abre tu navegador en: [http://localhost:5173](http://localhost:5173)

---

### Acceso QA en la red local

- Ejecuta `iniciar_qa_lan.bat`. El lanzador crea/actualiza un certificado HTTPS local y usa una regla de Firewall limitada al puerto 5174 y a dispositivos de la subred local.
- Comparte con los QA la dirección `https://IP-DE-ESTA-PC:5174` que muestra el lanzador. Solo funcionará desde la misma red Wi-Fi/LAN; no es una publicación en Internet.
- Esta instancia comparte la base `backend\data\database.sqlite`, las imágenes subidas y la carpeta de imágenes de la app local; las altas, cambios y eliminaciones de QA afectan directamente esos datos. Usa la llave Gemini guardada en esa base o, si no existe, la de `backend/.env`; la llave solo se utiliza en el servidor y las llamadas consumen su cuota.
- Antes de abrir QA, cada dispositivo debe importar `CLAREMM-QA-Root.cer` en las autoridades raíz de confianza de su usuario. El certificado público se encuentra en `%LOCALAPPDATA%\CLAREMM-QA\certs`; comparte ese `.cer` con los QA por un medio confiable. No compartas la llave privada `qa-server.pfx`.
- La aplicación no tiene autenticación. No publiques esta instancia mediante un túnel público sin añadir antes un control de acceso real; compartir la URL solo con ciertas personas no impide que otros la usen.
- Al terminar, cierra las dos ventanas QA y ejecuta `detener_qa_lan.bat` para quitar la regla del Firewall. Los datos de prueba permanecen guardados.

---

### Opción 3: Modo Servidor Unificado (Producción)
```bash
npm run build
npm start
```
Abre tu navegador en: [http://localhost:3001](http://localhost:3001)

---

## 📁 Estructura del Proyecto

```
CLAREMM Zapateria/
├── backend/
│   ├── data/
│   │   └── database.sqlite      # Base de datos SQLite persistente
│   ├── services/
│   │   └── geminiService.js     # Extracción multimodal con Gemini Vision
│   ├── uploads/                 # Almacenamiento local de fotos capturadas
│   ├── database.js              # Operaciones SQLite (WAL mode, CRUD, Stats)
│   ├── inventory.js             # Generación de tallas y validación de existencias
│   ├── server.js                # Servidor Express, SSE en tiempo real y API
│   ├── package.json
│   └── .env
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Navbar.jsx              # Barra superior VIP con indicadores de estado
│   │   │   ├── StatsCards.jsx          # Tarjetas de métricas KPI
│   │   │   ├── ProductTable.jsx        # Tabla con paginación, filtros y acciones
│   │   │   ├── CaptureModal.jsx        # Captura dual, visor de cámara y Gemini AI
│   │   │   ├── WebcamViewfinder.jsx    # Visor de cámara en vivo para fotos
│   │   │   ├── EditModal.jsx           # Modal de edición por fila
│   │   │   ├── DeleteDialog.jsx        # Diálogo de eliminación confirmada
│   │   │   ├── ExcelImportModal.jsx    # Importador masivo de Excel con vista previa
│   │   │   ├── ApiKeyModal.jsx         # Gestor de Gemini API Key en UI
│   │   │   └── ImageViewerModal.jsx    # Lightbox para fotos y fichas
│   │   ├── App.jsx                     # Componente principal y cliente SSE
│   │   ├── index.css                   # Estilos VIP (oro champán, glassmorphism)
│   │   └── main.jsx
│   ├── package.json
│   └── vite.config.js
├── iniciar_sistema.bat          # Lanzador automático para Windows
└── package.json
```

---

## 🔑 Obtención de API Key de Gemini
Puedes obtener una API Key gratuita en [Google AI Studio](https://aistudio.google.com/app/apikey).
Una vez que la tengas, pulsa el botón **"Configurar Key"** en la barra superior del panel e ingrésala. ¡Quedará guardada y lista para digitalizar tus fichas de calzado!
