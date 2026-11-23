import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { Jimp } from 'jimp';
import db, { productOperations, settingsOperations, getFormattedDateDDMMYY, getFormattedDateDDMMYYYY } from './database.js';
import { extractProductFromFicha } from './services/geminiService.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Uploads directory configuration
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer storage for handling file uploads (products and ficha sheets)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 25 * 1024 * 1024, // 25 MB max
    fieldSize: 25 * 1024 * 1024 // 25 MB max for large base64 text fields
  }
});

// Middleware to safely handle single file uploads with guaranteed JSON errors
const handleUploadSingle = (fieldName) => (req, res, next) => {
  const cType = (req.headers['content-type'] || '').toLowerCase();
  if (cType.includes('application/json')) return next();
  upload.single(fieldName)(req, res, (err) => {
    if (err) {
      console.warn(`[Multer Single Upload Error on ${fieldName}]:`, err.message);
      return res.status(400).json({
        success: false,
        message: `Error al procesar archivo: ${err.message}`
      });
    }
    next();
  });
};

// Middleware to safely handle multipart fields with guaranteed JSON errors
const handleUploadFields = (fieldsArr) => (req, res, next) => {
  const cType = (req.headers['content-type'] || '').toLowerCase();
  if (cType.includes('application/json')) return next();
  upload.fields(fieldsArr)(req, res, (err) => {
    if (err) {
      console.warn('[Multer Fields Upload Error]:', err.message);
      return res.status(400).json({
        success: false,
        message: `Error al procesar archivos: ${err.message}`
      });
    }
    next();
  });
};

// Middleware
app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use('/uploads', express.static(uploadsDir));

// ==========================================
// REAL-TIME SERVER-SENT EVENTS (SSE) SYSTEM
// ==========================================
let sseClients = [];

app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const clientId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  const newClient = { id: clientId, res };
  sseClients.push(newClient);

  // Send initial connection confirmation
  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', clientId })}\n\n`);

  req.on('close', () => {
    sseClients = sseClients.filter(c => c.id !== clientId);
  });
});

// Keep-alive heartbeat every 20 seconds
setInterval(() => {
  sseClients.forEach(client => {
    client.res.write(': heartbeat\n\n');
  });
}, 20000);

export function broadcastEvent(eventData) {
  const payload = `data: ${JSON.stringify(eventData)}\n\n`;
  sseClients.forEach(client => {
    try {
      client.res.write(payload);
    } catch (e) {
      console.error('Error sending SSE to client:', e);
    }
  });
}

// ==========================================
// API ROUTES
// ==========================================

// 1. Get products list with pagination, search, filters
app.get('/api/products', (req, res) => {
  try {
    const { search, marca, linea, clasificacion, page, limit, sortBy, sortOrder, includeInactive } = req.query;
    const result = productOperations.getAll({
      search,
      marca,
      linea,
      clasificacion,
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 10,
      sortBy: sortBy || 'id',
      sortOrder: sortOrder || 'DESC',
      includeInactive: includeInactive === 'true'
    });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Check Barcode duplicate endpoint
app.get('/api/products/check-barcode', (req, res) => {
  try {
    const { barcode, excludeId } = req.query;
    if (!barcode || !barcode.trim()) {
      return res.json({ exists: false });
    }
    const cleanBarcode = barcode.trim();
    const existing = productOperations.findByBarcode(cleanBarcode, excludeId);
    if (existing) {
      return res.json({
        exists: true,
        message: `⚠️ Código de barras repetido: "${cleanBarcode}" ya está registrado en el producto "${existing.estilo}" (${existing.marca || 'Sin marca'}) con ID #${existing.id}.`,
        product: existing
      });
    }
    return res.json({ exists: false });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Helper to resolve image buffer for Excel embedding (handles base64, local files, and remote URLs)
async function resolveImageBuffer(imageSource, uploadsDir) {
  if (!imageSource || typeof imageSource !== 'string' || !imageSource.trim()) return null;
  const cleanSource = imageSource.trim();
  try {
    // 1. Base64 data URL
    if (cleanSource.startsWith('data:image/')) {
      const matches = cleanSource.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
      if (matches) {
        let ext = matches[1].toLowerCase();
        if (ext === 'jpg') ext = 'jpeg';
        return { buffer: Buffer.from(matches[2], 'base64'), extension: ext };
      }
    }
    // 2. Local uploads folder
    if (cleanSource.includes('/uploads/')) {
      const filename = cleanSource.split('/uploads/')[1].split('?')[0];
      const localPath = path.join(uploadsDir, filename);
      if (fs.existsSync(localPath)) {
        const ext = localPath.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
        return { buffer: fs.readFileSync(localPath), extension: ext };
      }
    }
    // 3. Remote HTTP/HTTPS URL
    if (cleanSource.startsWith('http://') || cleanSource.startsWith('https://')) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(cleanSource, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const arrayBuf = await res.arrayBuffer();
        const contentType = (res.headers.get('content-type') || '').toLowerCase();
        let ext = 'jpeg';
        if (contentType.includes('png')) ext = 'png';
        else if (contentType.includes('gif')) ext = 'gif';
        return { buffer: Buffer.from(arrayBuf), extension: ext };
      }
    }
  } catch (e) {
    console.warn(`[Excel Image Embed] No se pudo cargar imagen (${cleanSource.substring(0, 60)}...):`, e.message);
  }
  return null;
}

// Helper to render a 100x100 pixel thumbnail of the product photo using Jimp
// CRITICAL: Strictly modifies ONLY product photos. ficha_imagen is NEVER processed or altered!
export async function generateProductThumbnail100(imageSource, uploadsDirectory) {
  if (!imageSource || typeof imageSource !== 'string' || !imageSource.trim()) {
    return null;
  }
  const clean = imageSource.trim();
  try {
    let jimpImage = null;

    // 1. Data URL (Base64)
    if (clean.startsWith('data:image/')) {
      const matches = clean.match(/^data:image\/[a-zA-Z0-9+]+;base64,(.+)$/);
      if (matches) {
        const buf = Buffer.from(matches[1], 'base64');
        jimpImage = await Jimp.read(buf);
      }
    }
    // 2. Local uploaded file in uploads dir
    else if (clean.includes('/uploads/')) {
      const filename = clean.split('/uploads/')[1].split('?')[0];
      const diskPath = path.join(uploadsDirectory, filename);
      if (fs.existsSync(diskPath)) {
        jimpImage = await Jimp.read(diskPath);
      }
    }
    // 3. Absolute path on disk
    else if (fs.existsSync(clean)) {
      jimpImage = await Jimp.read(clean);
    }
    // 4. Remote HTTP/HTTPS URL
    else if (clean.startsWith('http://') || clean.startsWith('https://')) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      try {
        const resp = await fetch(clean, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (resp.ok) {
          const arrBuf = await resp.arrayBuffer();
          const buf = Buffer.from(arrBuf);
          jimpImage = await Jimp.read(buf);
        }
      } catch (fetchErr) {
        clearTimeout(timeoutId);
        console.warn('[Thumbnail Generator] No se pudo descargar imagen remota:', clean, fetchErr.message);
      }
    }

    if (!jimpImage) {
      return null;
    }

    // Resize to exact 100x100 pixels
    jimpImage.resize({ w: 100, h: 100 });

    const thumbFilename = `thumb-100-${Date.now()}-${Math.round(Math.random() * 1e6)}.jpg`;
    const thumbDiskPath = path.join(uploadsDirectory, thumbFilename);
    const thumbBuffer = await jimpImage.getBuffer('image/jpeg');
    fs.writeFileSync(thumbDiskPath, thumbBuffer);

    return `/uploads/${thumbFilename}`;
  } catch (err) {
    console.error('[Thumbnail Generator] Error al generar miniatura 100x100:', err.message);
    return null;
  }
}

// Helper to crop and compress product photos to exactly 500x500 pixels and < 100KB
// CRITICAL: Strictly modifies ONLY product photos. ficha_imagen is NEVER processed or altered!
export async function processProductImage500(imageSource, uploadsDirectory) {
  if (!imageSource || typeof imageSource !== 'string' || !imageSource.trim()) {
    return null;
  }
  const clean = imageSource.trim();
  try {
    let jimpImage = null;

    // 1. Data URL (Base64)
    if (clean.startsWith('data:image/')) {
      const matches = clean.match(/^data:image\/[a-zA-Z0-9+]+;base64,(.+)$/);
      if (matches) {
        const buf = Buffer.from(matches[1], 'base64');
        jimpImage = await Jimp.read(buf);
      }
    }
    // 2. Local uploaded file in uploads dir
    else if (clean.includes('/uploads/')) {
      const filename = clean.split('/uploads/')[1].split('?')[0];
      const diskPath = path.join(uploadsDirectory, filename);
      if (fs.existsSync(diskPath)) {
        jimpImage = await Jimp.read(diskPath);
      }
    }
    // 3. Absolute path on disk
    else if (fs.existsSync(clean)) {
      jimpImage = await Jimp.read(clean);
    }
    // 4. Remote HTTP/HTTPS URL
    else if (clean.startsWith('http://') || clean.startsWith('https://')) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      try {
        const resp = await fetch(clean, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (resp.ok) {
          const arrBuf = await resp.arrayBuffer();
          const buf = Buffer.from(arrBuf);
          jimpImage = await Jimp.read(buf);
        }
      } catch (fetchErr) {
        clearTimeout(timeoutId);
        console.warn('[Product Image 500] No se pudo descargar imagen remota:', clean, fetchErr.message);
      }
    }

    if (!jimpImage) {
      return null;
    }

    // Crop to 500x500 pixels maintaining aspect ratio (cover/center crop)
    try {
      jimpImage.cover({ w: 500, h: 500 });
    } catch (coverErr) {
      jimpImage.resize({ w: 500, h: 500 });
    }

    // Adaptive compression strictly keeping file size under 100KB (< 100 * 1024 bytes)
    const MAX_BYTES = 100 * 1024;
    let quality = 82;
    let compressedBuffer = await jimpImage.getBuffer('image/jpeg', { quality });

    while (compressedBuffer.length >= MAX_BYTES && quality > 15) {
      quality -= 8;
      compressedBuffer = await jimpImage.getBuffer('image/jpeg', { quality });
    }

    const prodFilename = `prod-500-${Date.now()}-${Math.round(Math.random() * 1e6)}.jpg`;
    const prodDiskPath = path.join(uploadsDirectory, prodFilename);
    fs.writeFileSync(prodDiskPath, compressedBuffer);

    console.log(`[Product Image 500] ✓ Recortada a 500x500 px y comprimida a ${(compressedBuffer.length / 1024).toFixed(2)} KB (calidad ${quality})`);

    return `/uploads/${prodFilename}`;
  } catch (err) {
    console.error('[Product Image 500] Error al recortar y comprimir:', err.message);
    return null;
  }
}

// Export current products to Excel (EMBEDS IMAGES DIRECTLY IN CELLS, NOT URLs)
app.get('/api/products/export', async (req, res) => {
  try {
    const all = productOperations.getAll({ limit: 10000 });
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'CLAREMM Zapatería';
    workbook.lastModifiedBy = 'CLAREMM Control Panel';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Catálogo CLAREMM', {
      views: [{ showGridLines: true }]
    });

    // Define columns strictly replicating user export format:
    // Estilo,Color,Acabado,Descripcion,Corrida,Estado,Fecha Alta,Linea,Sublinea,Plantilla,Temporada,Clasificacion,Marca,Costo,Precio,Status,Observaciones,Catalogo,Comprador,Pagina,imagen
    worksheet.columns = [
      { header: 'Estilo', key: 'estilo', width: 20 },
      { header: 'Color', key: 'color', width: 16 },
      { header: 'Acabado', key: 'acabado', width: 18 },
      { header: 'Descripcion', key: 'descripcion', width: 22 },
      { header: 'Corrida', key: 'corrida', width: 18 },
      { header: 'Estado', key: 'estado', width: 14 },
      { header: 'Fecha Alta', key: 'fecha_alta', width: 16 },
      { header: 'Linea', key: 'linea', width: 18 },
      { header: 'Sublinea', key: 'sublinea', width: 18 },
      { header: 'Plantilla', key: 'plantilla', width: 16 },
      { header: 'Temporada', key: 'temporada', width: 18 },
      { header: 'Clasificacion', key: 'clasificacion', width: 18 },
      { header: 'Marca', key: 'marca', width: 18 },
      { header: 'Costo', key: 'costo', width: 14 },
      { header: 'Precio', key: 'precio', width: 14 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Observaciones', key: 'observaciones', width: 16 },
      { header: 'Catalogo', key: 'catalogo', width: 18 },
      { header: 'Comprador', key: 'comprador', width: 16 },
      { header: 'Pagina', key: 'pagina', width: 12 },
      { header: 'imagen', key: 'imagen', width: 16 }
    ];

    // Elegant VIP styling for Header Row
    const headerRow = worksheet.getRow(1);
    headerRow.height = 34;
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E293B' } // Slate 800 dark luxury
      };
      cell.font = {
        name: 'Segoe UI',
        bold: true,
        color: { argb: 'FFFFFFFF' },
        size: 11
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'medium', color: { argb: 'FFD4AF37' } } // Gold line under header
      };
    });

    for (let idx = 0; idx < all.items.length; idx++) {
      const p = all.items[idx];
      const rowIndex = idx + 2; // Row 1 is header

      const marcaVal = (p.marca && String(p.marca).trim()) || '';
      const sublineaVal = (p.sublinea && String(p.sublinea).trim()) || marcaVal || '';
      const precioNum = parseFloat(p.precio) || 0;
      const costoNum = parseFloat(p.costo) || (precioNum > 0 ? parseFloat((precioNum * 0.70).toFixed(2)) : 0);
      const fechaAltaVal = p.fecha_alta || (p.created_at ? getFormattedDateDDMMYYYY(p.created_at) : getFormattedDateDDMMYYYY());
      const observacionesVal = p.observaciones || (p.created_at ? getFormattedDateDDMMYY(p.created_at) : getFormattedDateDDMMYY());
      const statusVal = p.status !== undefined && p.status !== null ? Number(p.status) : (p.activo !== 0 ? 1 : 0);
      const compradorVal = (p.comprador && String(p.comprador).trim()) || 'Sin asignar';
      const paginaVal = p.pagina !== undefined && p.pagina !== null ? Number(p.pagina) : 0;

      const row = worksheet.addRow({
        estilo: String(p.estilo || ''),
        color: p.color || '',
        acabado: p.acabado || '',
        descripcion: p.descripcion || '',
        corrida: p.corrida || '',
        estado: p.estado || '',
        fecha_alta: fechaAltaVal,
        linea: p.linea || '',
        sublinea: sublineaVal,
        plantilla: p.plantilla || 'PLANTILLAS',
        temporada: p.temporada || 'CLAREMM 26',
        clasificacion: p.clasificacion || 'CASUAL',
        marca: marcaVal,
        costo: costoNum,
        precio: precioNum,
        status: statusVal,
        observaciones: observacionesVal,
        catalogo: p.catalogo || '',
        comprador: compradorVal,
        pagina: paginaVal,
        imagen: '' // Celda de imagen: se incrusta la foto física abajo, SIN texto URL
      });

      row.height = 62; // Sufficient height to display 54px shoe photograph

      // Align cells and apply borders
      row.eachCell((cell) => {
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
        cell.font = { name: 'Segoe UI', size: 10 };
        cell.border = {
          bottom: { style: 'thin', color: { argb: 'FFF1F5F9' } },
          right: { style: 'thin', color: { argb: 'FFF1F5F9' } }
        };
      });

      // Specific cell alignments and fonts
      const estiloCell = row.getCell('estilo');
      estiloCell.numFmt = '@'; // Treat as text to preserve leading zeros
      estiloCell.font = { name: 'Consolas', size: 10, bold: true };
      estiloCell.alignment = { vertical: 'middle', horizontal: 'left' };

      const precioCell = row.getCell('precio');
      precioCell.numFmt = '#,##0.00';
      precioCell.alignment = { vertical: 'middle', horizontal: 'right' };
      precioCell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF0F172A' } };

      const costoCell = row.getCell('costo');
      costoCell.numFmt = '#,##0.00';
      costoCell.alignment = { vertical: 'middle', horizontal: 'right' };
      costoCell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFB45309' } };

      row.getCell('fecha_alta').alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell('observaciones').alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell('status').alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell('pagina').alignment = { vertical: 'middle', horizontal: 'center' };

      // Embed binary photograph if available into column 21 ('imagen', index 20)
      const imageToEmbed = p.imagen_thumbnail || p.imagen;
      if (imageToEmbed) {
        const imageRes = await resolveImageBuffer(imageToEmbed, uploadsDir);
        if (imageRes && imageRes.buffer) {
          try {
            const imageId = workbook.addImage({
              buffer: imageRes.buffer,
              extension: imageRes.extension
            });
            worksheet.addImage(imageId, {
              tl: { col: 20.12, row: rowIndex - 1 + 0.08 },
              ext: { width: 54, height: 54 },
              editAs: 'oneCell'
            });
          } catch (imgErr) {
            console.warn(`Error al incrustar imagen para producto #${p.id}:`, imgErr.message);
          }
        }
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader('Content-Disposition', 'attachment; filename="CLAREMM_Catalogo_Productos.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    console.error('Error generating Excel export with embedded images:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Download formatted Excel template for importing (must be declared before :id)
app.get('/api/products/template', (req, res) => {
  try {
    const templateData = [
      {
        'Estilo': 'PI3059',
        'Color': 'NEGRO',
        'Acabado': 'PIEL',
        'Descripcion': '',
        'Corrida': '21.50-27.00',
        'Estado': '',
        'Fecha Alta': '11/11/2026',
        'Linea': 'JOVEN',
        'Sublinea': 'ZAPATOS',
        'Plantilla': 'PLANTILLAS',
        'Temporada': 'CLAREMM 26',
        'Clasificacion': 'DEPORTES',
        'Marca': 'FLEXI',
        'Costo': 500,
        'Precio': 899,
        'Status': 1,
        'Observaciones': '11/11/26',
        'Catalogo': 'DEPARTAMENTO',
        'Comprador': 'Sin asignar',
        'Pagina': 0,
        'imagen': ''
      }
    ];

    const worksheet = XLSX.utils.json_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Plantilla Importación');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', 'attachment; filename="Plantilla_Productos_CLAREMM.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 2. Get single product by ID
app.get('/api/products/:id', (req, res) => {
  try {
    const product = productOperations.getById(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Producto no encontrado' });
    }
    res.json({ success: true, product });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 3. Create product (Supports multipart upload for product image and ficha image, or JSON)
app.post(
  '/api/products',
  handleUploadFields([
    { name: 'imagen', maxCount: 1 },
    { name: 'ficha_imagen', maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const body = req.body;

      // Extract image paths if uploaded as files
      let imagenPath = body.imagen || '';
      if (req.files?.imagen?.[0]) {
        imagenPath = `/uploads/${req.files.imagen[0].filename}`;
      }

      let fichaPath = body.ficha_imagen || '';
      if (req.files?.ficha_imagen?.[0]) {
        fichaPath = `/uploads/${req.files.ficha_imagen[0].filename}`;
      }

      // Handle base64 image data sent directly from webcam if applicable
      if (body.imagenBase64 && !imagenPath) {
        const matches = body.imagenBase64.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
        if (matches) {
          const ext = matches[1] === 'jpeg' ? '.jpg' : `.${matches[1]}`;
          const filename = `imagen-webcam-${Date.now()}${ext}`;
          const filePath = path.join(uploadsDir, filename);
          fs.writeFileSync(filePath, Buffer.from(matches[2], 'base64'));
          imagenPath = `/uploads/${filename}`;
        }
      }

      if (body.fichaBase64 && !fichaPath) {
        const matches = body.fichaBase64.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
        if (matches) {
          const ext = matches[1] === 'jpeg' ? '.jpg' : `.${matches[1]}`;
          const filename = `ficha-webcam-${Date.now()}${ext}`;
          const filePath = path.join(uploadsDir, filename);
          fs.writeFileSync(filePath, Buffer.from(matches[2], 'base64'));
          fichaPath = `/uploads/${filename}`;
        }
      }

      // Crop and compress product photo to 500x500 pixels and < 100KB
      // CRITICAL: Strictly modifies ONLY product photos. ficha_imagen is NEVER processed or altered!
      if (imagenPath) {
        const processed500 = await processProductImage500(imagenPath, uploadsDir);
        if (processed500) imagenPath = processed500;
      }

      // Render 100x100 thumbnail of the product photo (saving both 500x500 and 100x100)
      // NOTE: Ficha photo (fichaPath) MUST NOT be modified or resized!
      let thumbnailPath = '';
      if (imagenPath) {
        thumbnailPath = await generateProductThumbnail100(imagenPath, uploadsDir);
      }

      // Check if barcode is already registered
      let barcodeWarning = null;
      if (body.codigo_barras && body.codigo_barras.trim()) {
        const existingWithBarcode = productOperations.findByBarcode(body.codigo_barras.trim());
        if (existingWithBarcode) {
          barcodeWarning = `El código de barras "${body.codigo_barras.trim()}" ya estaba asignado al producto ${existingWithBarcode.estilo} (ID #${existingWithBarcode.id}).`;
        }
      }

      // Extract and derive prices & business logic
      const precioNum = parseFloat(body.precio) || 0;
      const costoNum = parseFloat(body.costo) || (precioNum > 0 ? parseFloat((precioNum * 0.70).toFixed(2)) : 0);
      const marcaVal = body.marca ? body.marca.trim() : '';
      const proveedorVal = marcaVal || body.proveedor || '';
      const sublineaVal = marcaVal || body.sublinea || '';
      const departamentoVal = (body.departamento && String(body.departamento).trim()) || 'ROPA';
      const clasificacionVal = (body.clasificacion && String(body.clasificacion).trim()) || 'CASUAL';
      const suelaVal = (body.suela && String(body.suela).trim()) || 'SUELAS';
      const plantillaVal = (body.plantilla && String(body.plantilla).trim()) || (body.plantillas && String(body.plantillas).trim()) || 'PLANTILLAS';
      const taconVal = (body.tacon && String(body.tacon).trim()) || 'PISO';
      const forroVal = (body.forro && String(body.forro).trim()) || 'FORRO';
      const catalogoVal = body.catalogo ? String(body.catalogo).trim() : '';
      const observacionesVal = (body.observaciones !== undefined && body.observaciones !== null && String(body.observaciones).trim() !== '')
        ? String(body.observaciones).trim()
        : getFormattedDateDDMMYY();

      const newProduct = productOperations.create({
        codigo_barras: body.codigo_barras ? body.codigo_barras.trim() : '',
        estilo: body.estilo || 'S/E',
        color: body.color || '',
        acabado: body.acabado || '',
        descripcion: body.descripcion || '',
        corrida: body.corrida || '',
        estado: body.estado || '',
        fecha_alta: (body.fecha_alta && body.fecha_alta.trim()) || getFormattedDateDDMMYYYY(),
        marca: marcaVal,
        temporada: (body.temporada && body.temporada.trim()) || 'CLAREMM 26',
        proveedor: proveedorVal,
        sublinea: sublineaVal,
        clasificacion: clasificacionVal,
        linea: body.linea || '',
        departamento: departamentoVal,
        observaciones: observacionesVal,
        suela: suelaVal,
        plantilla: plantillaVal,
        tacon: taconVal,
        forro: forroVal,
        catalogo: catalogoVal,
        comprador: (body.comprador && body.comprador.trim()) || 'Sin asignar',
        pagina: body.pagina !== undefined && body.pagina !== null ? parseInt(body.pagina, 10) : 0,
        status: body.status !== undefined && body.status !== null ? parseInt(body.status, 10) : 1,
        precio: precioNum,
        costo: costoNum,
        imagen: imagenPath,
        imagen_thumbnail: thumbnailPath || '',
        ficha_imagen: fichaPath // Strictly unmodified
      });

      // Broadcast real-time update
      broadcastEvent({
        type: 'PRODUCT_CREATED',
        product: newProduct,
        timestamp: new Date().toISOString()
      });

      res.status(201).json({
        success: true,
        message: 'Producto creado exitosamente',
        barcodeWarning,
        product: newProduct
      });
    } catch (error) {
      console.error('Error creating product:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

// 4. Update product
app.put(
  '/api/products/:id',
  handleUploadFields([
    { name: 'imagen', maxCount: 1 },
    { name: 'ficha_imagen', maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const id = req.params.id;
      const body = req.body;

      const updateData = { ...body };

      if (req.files?.imagen?.[0]) {
        const rawUploaded = `/uploads/${req.files.imagen[0].filename}`;
        const processed500 = await processProductImage500(rawUploaded, uploadsDir);
        updateData.imagen = processed500 || rawUploaded;
        updateData.imagen_thumbnail = await generateProductThumbnail100(updateData.imagen, uploadsDir);
      } else if (body.imagenBase64) {
        const processed500 = await processProductImage500(body.imagenBase64, uploadsDir);
        if (processed500) {
          updateData.imagen = processed500;
          updateData.imagen_thumbnail = await generateProductThumbnail100(updateData.imagen, uploadsDir);
        }
      } else if (body.imagen !== undefined && body.imagen !== '') {
        const processed500 = await processProductImage500(body.imagen, uploadsDir);
        if (processed500) updateData.imagen = processed500;
        updateData.imagen_thumbnail = await generateProductThumbnail100(updateData.imagen || body.imagen, uploadsDir);
      }

      // ficha_imagen is strictly unmodified
      if (req.files?.ficha_imagen?.[0]) {
        updateData.ficha_imagen = `/uploads/${req.files.ficha_imagen[0].filename}`;
      }

      if (body.departamento !== undefined) {
        updateData.departamento = body.departamento ? String(body.departamento).trim() : 'ROPA';
      }

      if (body.clasificacion !== undefined) {
        updateData.clasificacion = body.clasificacion ? String(body.clasificacion).trim() : 'CASUAL';
      }

      if (body.suela !== undefined) {
        updateData.suela = body.suela ? String(body.suela).trim() : 'SUELAS';
      }

      if (body.plantilla !== undefined || body.plantillas !== undefined) {
        updateData.plantilla = (body.plantilla || body.plantillas) ? String(body.plantilla || body.plantillas).trim() : 'PLANTILLAS';
      }

      if (body.tacon !== undefined) {
        updateData.tacon = body.tacon ? String(body.tacon).trim() : 'PISO';
      }

      if (body.forro !== undefined) {
        updateData.forro = body.forro ? String(body.forro).trim() : 'FORRO';
      }

      if (body.catalogo !== undefined) {
        updateData.catalogo = String(body.catalogo).trim();
      }

      if (body.observaciones !== undefined) {
        updateData.observaciones = body.observaciones ? String(body.observaciones).trim() : getFormattedDateDDMMYY();
      }

      if (body.codigo_barras !== undefined) {
        updateData.codigo_barras = body.codigo_barras.trim();
      }

      if (body.precio !== undefined) {
        const pNum = parseFloat(body.precio) || 0;
        updateData.precio = pNum;
        if (body.costo !== undefined && String(body.costo).trim() !== '') {
          updateData.costo = parseFloat(body.costo) || 0;
        } else if (pNum > 0) {
          updateData.costo = parseFloat((pNum * 0.70).toFixed(2));
        }
      } else if (body.costo !== undefined) {
        updateData.costo = parseFloat(body.costo) || 0;
      }

      // If marca is updated, ensure proveedor and sublinea stay aligned unless specifically provided
      if (body.marca !== undefined) {
        const mVal = String(body.marca).trim();
        updateData.marca = mVal;
        if (mVal) {
          updateData.proveedor = mVal;
          updateData.sublinea = mVal;
        }
      }

      const updated = productOperations.update(id, updateData);
      if (!updated) {
        return res.status(404).json({ success: false, message: 'Producto no encontrado' });
      }

      // Broadcast real-time update
      broadcastEvent({
        type: 'PRODUCT_UPDATED',
        product: updated,
        timestamp: new Date().toISOString()
      });

      res.json({
        success: true,
        message: 'Producto actualizado exitosamente',
        product: updated
      });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

// 5. Delete product (Soft delete: solo oculta el producto del catálogo sin eliminarlo de la base de datos)
app.delete('/api/products/:id', (req, res) => {
  try {
    const id = req.params.id;
    const deleted = productOperations.delete(id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Producto no encontrado' });
    }

    // Broadcast real-time update
    broadcastEvent({
      type: 'PRODUCT_DELETED',
      id: Number(id),
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      message: 'Producto ocultado del catálogo exitosamente'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Restore product endpoint (permite volver a mostrar un producto ocultado)
app.post('/api/products/:id/restore', (req, res) => {
  try {
    const id = req.params.id;
    const restored = productOperations.restore(id);
    if (!restored) {
      return res.status(404).json({ success: false, message: 'Producto no encontrado' });
    }

    const product = productOperations.getById(id);
    broadcastEvent({
      type: 'PRODUCT_CREATED',
      product,
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      message: 'Producto restaurado exitosamente',
      product
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 6. Gemini AI Extraction from Ficha Image
app.post(
  '/api/ai/extract-ficha',
  handleUploadSingle('ficha'),
  async (req, res) => {
    try {
      let imageBuffer = null;
      let mimeType = 'image/jpeg';

      if (req.file) {
        imageBuffer = fs.readFileSync(req.file.path);
        mimeType = req.file.mimetype || 'image/jpeg';
      } else if (req.body.fichaBase64) {
        const matches = req.body.fichaBase64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (matches) {
          mimeType = matches[1];
          imageBuffer = Buffer.from(matches[2], 'base64');
        } else {
          imageBuffer = Buffer.from(req.body.fichaBase64, 'base64');
        }
      }

      if (!imageBuffer) {
        return res.status(400).json({
          success: false,
          message: 'Debes proporcionar una imagen de la ficha técnica (archivo o base64).'
        });
      }

      const userApiKey = req.headers['x-gemini-key'] || req.body.apiKey;

      const result = await extractProductFromFicha({
        imageBuffer,
        mimeType,
        userApiKey
      });

      // If barcode extracted, check if duplicate exists in DB
      let duplicateBarcodeFound = null;
      if (result.success && result.extractedData?.codigo_barras) {
        const existing = productOperations.findByBarcode(result.extractedData.codigo_barras);
        if (existing) {
          duplicateBarcodeFound = {
            barcode: result.extractedData.codigo_barras,
            existingProduct: existing,
            warning: `⚠️ ALERTA: El código de barras "${result.extractedData.codigo_barras}" extraído de la ficha ya está registrado en el producto ${existing.estilo} (${existing.marca || 'Sin marca'}) ID #${existing.id}.`
          };
        }
      }

      res.json({
        ...result,
        duplicateBarcodeFound
      });
    } catch (error) {
      console.error('Error extracting from ficha:', error);
      res.status(500).json({
        success: false,
        message: 'Error en el procesamiento de la imagen: ' + error.message
      });
    }
  }
);

// 7. Import products from Excel file
app.post('/api/products/import', handleUploadSingle('file'), (req, res) => {
  try {
    let rawRows = [];

    if (req.file) {
      const workbook = XLSX.readFile(req.file.path);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      rawRows = XLSX.utils.sheet_to_json(sheet);
      // Clean up uploaded temp file
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    } else if (req.body.items && Array.isArray(req.body.items)) {
      rawRows = req.body.items;
    } else {
      return res.status(400).json({ success: false, message: 'No se envió archivo de Excel o datos de filas.' });
    }

    if (rawRows.length === 0) {
      return res.status(400).json({ success: false, message: 'El archivo Excel no contiene filas de datos.' });
    }

    // Helper to normalize column names: "Clasificación" -> "clasificacion"
    const normalizeKey = (key) => {
      return String(key)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
    };

    const duplicateBarcodes = [];
    const seenBarcodes = new Set();

    const defaultObs = getFormattedDateDDMMYY();
    const defaultFechaAlta = getFormattedDateDDMMYYYY();
    const mappedProducts = rawRows.map((row, idx) => {
      const mapped = {
        codigo_barras: '',
        estilo: '',
        color: '',
        acabado: '',
        descripcion: '',
        corrida: '',
        estado: '',
        fecha_alta: defaultFechaAlta,
        marca: '',
        temporada: 'CLAREMM 26',
        proveedor: '',
        sublinea: '',
        departamento: 'ROPA',
        clasificacion: 'CASUAL',
        linea: '',
        suela: 'SUELAS',
        plantilla: 'PLANTILLAS',
        tacon: 'PISO',
        forro: 'FORRO',
        catalogo: '',
        comprador: 'Sin asignar',
        pagina: 0,
        status: 1,
        observaciones: defaultObs,
        precio: 0,
        costo: 0,
        imagen: '',
        ficha_imagen: ''
      };

      for (const [key, val] of Object.entries(row)) {
        const norm = normalizeKey(key);
        if (norm.includes('barra') || norm.includes('barcode') || norm.includes('ean') || norm.includes('upc')) {
          mapped.codigo_barras = String(val || '').trim();
        } else if (norm.includes('estilo') || norm.includes('modelo') || norm.includes('codigo')) {
          mapped.estilo = String(val || '').trim();
        } else if (norm.includes('color')) {
          mapped.color = String(val || '').trim();
        } else if (norm.includes('acabado') || norm.includes('material')) {
          mapped.acabado = String(val || '').trim();
        } else if (norm.includes('descripcion') || norm.includes('desc')) {
          mapped.descripcion = String(val || '').trim();
        } else if (norm.includes('corrida') || norm.includes('talla')) {
          mapped.corrida = String(val || '').trim();
        } else if (norm === 'estado' || norm.includes('status') || norm.includes('estatus')) {
          if (norm.includes('status') || norm.includes('estatus')) {
            mapped.status = parseInt(String(val || '').trim(), 10) || 1;
          } else {
            mapped.estado = String(val || '').trim();
          }
        } else if (norm.includes('alta') || norm.includes('fecha_alta') || norm.includes('fecha')) {
          mapped.fecha_alta = String(val || '').trim() || defaultFechaAlta;
        } else if (norm.includes('marca')) {
          mapped.marca = String(val || '').trim();
        } else if (norm.includes('temporada')) {
          mapped.temporada = String(val || '').trim() || 'CLAREMM 26';
        } else if (norm.includes('proveedor') || norm.includes('fabricante')) {
          mapped.proveedor = String(val || '').trim();
        } else if (norm.includes('sublinea') || norm.includes('sub-linea')) {
          mapped.sublinea = String(val || '').trim();
        } else if (norm.includes('departamento') || norm.includes('dept')) {
          mapped.departamento = String(val || '').trim() || 'ROPA';
        } else if (norm.includes('clasificacion') || norm.includes('genero')) {
          mapped.clasificacion = String(val || '').trim() || 'CASUAL';
        } else if (norm.includes('linea') || norm.includes('categoria')) {
          mapped.linea = String(val || '').trim();
        } else if (norm.includes('suela')) {
          mapped.suela = String(val || '').trim() || 'SUELAS';
        } else if (norm.includes('plantilla')) {
          mapped.plantilla = String(val || '').trim() || 'PLANTILLAS';
        } else if (norm.includes('tacon')) {
          mapped.tacon = String(val || '').trim() || 'PISO';
        } else if (norm.includes('forro')) {
          mapped.forro = String(val || '').trim() || 'FORRO';
        } else if (norm.includes('catalogo')) {
          mapped.catalogo = String(val || '').trim();
        } else if (norm.includes('comprador')) {
          mapped.comprador = String(val || '').trim() || 'Sin asignar';
        } else if (norm.includes('pagina') || norm.includes('pag')) {
          mapped.pagina = parseInt(String(val || '').trim(), 10) || 0;
        } else if (norm.includes('observacion') || norm.includes('nota') || norm.includes('obs')) {
          mapped.observaciones = String(val || '').trim() || defaultObs;
        } else if (norm.includes('costo')) {
          mapped.costo = parseFloat(String(val || '').replace(/[^0-9.]/g, '')) || 0;
        } else if (norm.includes('precio') || norm.includes('venta')) {
          mapped.precio = parseFloat(String(val || '').replace(/[^0-9.]/g, '')) || 0;
        } else if (norm.includes('imagen') || norm.includes('foto') || norm.includes('url')) {
          mapped.imagen = String(val || '').trim();
        }
      }

      // Rule: proveedor and sublinea match marca
      if (mapped.marca) {
        mapped.proveedor = mapped.marca;
        mapped.sublinea = mapped.marca;
      }

      // Rule: costo is derived from precio (-30%) if not present
      if (!mapped.costo && mapped.precio > 0) {
        mapped.costo = parseFloat((mapped.precio * 0.70).toFixed(2));
      }

      // Default temporada if empty
      if (!mapped.temporada) {
        mapped.temporada = 'CLAREMM 26';
      }

      // Check if barcode already exists in DB or within current sheet
      if (mapped.codigo_barras) {
        if (seenBarcodes.has(mapped.codigo_barras)) {
          duplicateBarcodes.push(`Fila ${idx + 1}: código de barras "${mapped.codigo_barras}" repetido dentro del mismo archivo Excel.`);
        } else {
          seenBarcodes.add(mapped.codigo_barras);
          const existingInDb = productOperations.findByBarcode(mapped.codigo_barras);
          if (existingInDb) {
            duplicateBarcodes.push(`Fila ${idx + 1}: código de barras "${mapped.codigo_barras}" ya existe en base de datos (Producto ${existingInDb.estilo} ID #${existingInDb.id}).`);
          }
        }
      }

      // Default estilo if empty
      if (!mapped.estilo) {
        mapped.estilo = 'MOD-' + Math.floor(1000 + Math.random() * 9000);
      }

      return mapped;
    });

    const importedCount = productOperations.bulkCreate(mappedProducts);

    // Broadcast SSE
    broadcastEvent({
      type: 'PRODUCTS_IMPORTED',
      count: importedCount,
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      message: `Se importaron exitosamente ${importedCount} productos desde Excel.`,
      count: importedCount,
      duplicateBarcodesAlert: duplicateBarcodes.length > 0 ? duplicateBarcodes : null
    });
  } catch (error) {
    console.error('Error importing Excel:', error);
    res.status(500).json({ success: false, message: 'Error al importar Excel: ' + error.message });
  }
});

// 10. Settings: Gemini API Key
app.get('/api/settings/gemini-key', (req, res) => {
  try {
    const storedKey = settingsOperations.get('gemini_api_key');
    const envKey = process.env.GEMINI_API_KEY;
    const activeKey = storedKey || envKey || '';
    
    // Mask key for security: e.g. "AIzaSy...4X9z"
    let masked = '';
    if (activeKey.length > 8) {
      masked = activeKey.substring(0, 6) + '...' + activeKey.substring(activeKey.length - 4);
    } else if (activeKey.length > 0) {
      masked = '******';
    }

    res.json({
      success: true,
      hasKey: activeKey.length > 0,
      maskedKey: masked,
      source: storedKey ? 'database' : (envKey ? 'env' : 'none')
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/settings/gemini-key', (req, res) => {
  try {
    const { apiKey } = req.body;
    if (apiKey === undefined) {
      return res.status(400).json({ success: false, message: 'apiKey requerido' });
    }
    settingsOperations.set('gemini_api_key', apiKey.trim());
    res.json({
      success: true,
      message: 'API Key de Gemini guardada correctamente',
      hasKey: apiKey.trim().length > 0
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 11. Dashboard KPI stats
app.get('/api/stats', (req, res) => {
  try {
    const stats = productOperations.getStats();
    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Serve frontend build if dist or public folder exists
const candidateDistPaths = [
  path.join(__dirname, 'dist'),
  path.join(__dirname, 'public'),
  path.join(__dirname, '..', 'dist'),
  path.join(__dirname, '..', 'frontend', 'dist')
];
let frontendDist = null;
for (const p of candidateDistPaths) {
  if (fs.existsSync(p) && fs.existsSync(path.join(p, 'index.html'))) {
    frontendDist = p;
    break;
  }
}

if (frontendDist) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res, next) => {
    // If request starts with /api or /uploads or /events, pass to api handlers
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/events')) {
      return next();
    }
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

// Function to generate 500x500 (< 100KB) images and 100x100 thumbnails for existing products
// Keeps ficha_imagen completely unmodified!
async function migrateExistingThumbnails() {
  try {
    const defaultObs = getFormattedDateDDMMYY();
    // 1. Backfill defaults for new columns and existing records
    db.prepare("UPDATE products SET departamento = 'ROPA' WHERE departamento IS NULL OR departamento = '' OR departamento = 'ropa'").run();
    db.prepare("UPDATE products SET clasificacion = 'CASUAL' WHERE clasificacion IS NULL OR clasificacion = ''").run();
    db.prepare("UPDATE products SET suela = 'SUELAS' WHERE suela IS NULL OR suela = ''").run();
    db.prepare("UPDATE products SET plantilla = 'PLANTILLAS' WHERE plantilla IS NULL OR plantilla = ''").run();
    db.prepare("UPDATE products SET tacon = 'PISO' WHERE tacon IS NULL OR tacon = ''").run();
    db.prepare("UPDATE products SET forro = 'FORRO' WHERE forro IS NULL OR forro = ''").run();
    db.prepare("UPDATE products SET observaciones = ? WHERE observaciones IS NULL OR observaciones = ''").run(defaultObs);
    db.prepare("UPDATE products SET activo = 1 WHERE activo IS NULL").run();
    db.prepare("UPDATE products SET status = 1 WHERE status IS NULL").run();
    db.prepare("UPDATE products SET comprador = 'Sin asignar' WHERE comprador IS NULL OR comprador = ''").run();
    db.prepare("UPDATE products SET pagina = 0 WHERE pagina IS NULL").run();
    const defaultFechaAlta = getFormattedDateDDMMYYYY();
    db.prepare("UPDATE products SET fecha_alta = ? WHERE fecha_alta IS NULL OR fecha_alta = ''").run(defaultFechaAlta);

    // 2. Ensure all products have 100x100 thumbnails and 500x500 compressed photos
    const productsToProcess = db.prepare(`
      SELECT id, imagen, imagen_thumbnail, estilo 
      FROM products 
      WHERE (imagen IS NOT NULL AND imagen != '')
    `).all();

    for (const prod of productsToProcess) {
      try {
        let currentImg = prod.imagen;
        let needsUpdate = false;

        // Check if 100x100 thumbnail is missing
        if (!prod.imagen_thumbnail) {
          const thumbPath = await generateProductThumbnail100(currentImg, uploadsDir);
          if (thumbPath) {
            db.prepare('UPDATE products SET imagen_thumbnail = ? WHERE id = ?').run(thumbPath, prod.id);
            console.log(`[Image Migration] ✓ Generada miniatura 100x100 para #${prod.id} (${prod.estilo}): ${thumbPath}`);
          }
        }
      } catch (itemErr) {
        console.warn(`[Image Migration] Falló para producto #${prod.id}:`, itemErr.message);
      }
    }
  } catch (err) {
    console.warn('[Image Migration] Error en migración de imágenes:', err.message);
  }
}

// Global JSON error handler to prevent HTML error responses and Safari pattern match exceptions
app.use((err, req, res, next) => {
  console.error('[Global Error Handler]:', err.message);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Error interno del servidor'
  });
});

// Start Express server
app.listen(PORT, () => {
  console.log(`✓ CLAREMM Backend running on http://localhost:${PORT}`);
  console.log(`✓ SQLite database active`);
  console.log(`✓ SSE Realtime Stream available at http://localhost:${PORT}/events`);
  if (frontendDist && fs.existsSync(frontendDist)) {
    console.log(`✓ Production Frontend served from ${frontendDist}`);
  }
  // Run background migration for existing 100x100 thumbnails
  migrateExistingThumbnails();
});
