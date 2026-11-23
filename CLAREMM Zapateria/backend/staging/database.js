import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbDir = path.join(__dirname, 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'database.sqlite');
const db = new DatabaseSync(dbPath);

export function getFormattedDateDDMMYY(dateInput = null) {
  const d = dateInput ? new Date(dateInput) : new Date();
  const validDate = isNaN(d.getTime()) ? new Date() : d;
  const dd = String(validDate.getDate()).padStart(2, '0');
  const mm = String(validDate.getMonth() + 1).padStart(2, '0');
  const yy = String(validDate.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

export function getFormattedDateDDMMYYYY(dateInput = null) {
  const d = dateInput ? new Date(dateInput) : new Date();
  const validDate = isNaN(d.getTime()) ? new Date() : d;
  const dd = String(validDate.getDate()).padStart(2, '0');
  const mm = String(validDate.getMonth() + 1).padStart(2, '0');
  const yyyy = String(validDate.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

// Enable WAL mode for high performance concurrency
db.exec('PRAGMA journal_mode = WAL;');

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo_barras TEXT,
    estilo TEXT NOT NULL,
    color TEXT,
    acabado TEXT,
    descripcion TEXT,
    corrida TEXT,
    estado TEXT,
    fecha_alta TEXT,
    marca TEXT,
    temporada TEXT,
    proveedor TEXT,
    sublinea TEXT,
    clasificacion TEXT DEFAULT 'CASUAL',
    linea TEXT,
    departamento TEXT DEFAULT 'ROPA',
    observaciones TEXT,
    suela TEXT DEFAULT 'SUELAS',
    plantilla TEXT DEFAULT 'PLANTILLAS',
    tacon TEXT DEFAULT 'PISO',
    forro TEXT DEFAULT 'FORRO',
    catalogo TEXT,
    comprador TEXT DEFAULT 'Sin asignar',
    pagina INTEGER DEFAULT 0,
    precio REAL DEFAULT 0,
    costo REAL DEFAULT 0,
    status INTEGER DEFAULT 1,
    imagen TEXT,
    imagen_thumbnail TEXT,
    ficha_imagen TEXT,
    activo INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migrations: ensure columns exist for existing databases
try { db.exec('ALTER TABLE products ADD COLUMN codigo_barras TEXT;'); } catch (e) {}
try { db.exec('ALTER TABLE products ADD COLUMN precio REAL DEFAULT 0;'); } catch (e) {}
try { db.exec('ALTER TABLE products ADD COLUMN costo REAL DEFAULT 0;'); } catch (e) {}
try { db.exec('ALTER TABLE products ADD COLUMN imagen_thumbnail TEXT;'); } catch (e) {}
try { db.exec("ALTER TABLE products ADD COLUMN departamento TEXT DEFAULT 'ROPA';"); } catch (e) {}
try { db.exec("ALTER TABLE products ADD COLUMN observaciones TEXT;"); } catch (e) {}
try { db.exec("ALTER TABLE products ADD COLUMN suela TEXT DEFAULT 'SUELAS';"); } catch (e) {}
try { db.exec("ALTER TABLE products ADD COLUMN plantilla TEXT DEFAULT 'PLANTILLAS';"); } catch (e) {}
try { db.exec("ALTER TABLE products ADD COLUMN tacon TEXT DEFAULT 'PISO';"); } catch (e) {}
try { db.exec("ALTER TABLE products ADD COLUMN forro TEXT DEFAULT 'FORRO';"); } catch (e) {}
try { db.exec("ALTER TABLE products ADD COLUMN catalogo TEXT;"); } catch (e) {}
try { db.exec("ALTER TABLE products ADD COLUMN activo INTEGER DEFAULT 1;"); } catch (e) {}
try { db.exec("ALTER TABLE products ADD COLUMN descripcion TEXT;"); } catch (e) {}
try { db.exec("ALTER TABLE products ADD COLUMN corrida TEXT;"); } catch (e) {}
try { db.exec("ALTER TABLE products ADD COLUMN estado TEXT;"); } catch (e) {}
try { db.exec("ALTER TABLE products ADD COLUMN fecha_alta TEXT;"); } catch (e) {}
try { db.exec("ALTER TABLE products ADD COLUMN comprador TEXT DEFAULT 'Sin asignar';"); } catch (e) {}
try { db.exec("ALTER TABLE products ADD COLUMN pagina INTEGER DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE products ADD COLUMN status INTEGER DEFAULT 1;"); } catch (e) {}

// Populate defaults for existing records
try {
  const defaultObs = getFormattedDateDDMMYY();
  const defaultFechaAlta = getFormattedDateDDMMYYYY();
  db.prepare("UPDATE products SET activo = 1 WHERE activo IS NULL").run();
  db.prepare("UPDATE products SET status = 1 WHERE status IS NULL").run();
  db.prepare("UPDATE products SET comprador = 'Sin asignar' WHERE comprador IS NULL OR comprador = ''").run();
  db.prepare("UPDATE products SET pagina = 0 WHERE pagina IS NULL").run();
  db.prepare("UPDATE products SET fecha_alta = ? WHERE fecha_alta IS NULL OR fecha_alta = ''").run(defaultFechaAlta);
  db.prepare("UPDATE products SET departamento = 'ROPA' WHERE departamento IS NULL OR departamento = '' OR departamento = 'ropa'").run();
  db.prepare("UPDATE products SET suela = 'SUELAS' WHERE suela IS NULL OR suela = ''").run();
  db.prepare("UPDATE products SET plantilla = 'PLANTILLAS' WHERE plantilla IS NULL OR plantilla = ''").run();
  db.prepare("UPDATE products SET tacon = 'PISO' WHERE tacon IS NULL OR tacon = ''").run();
  db.prepare("UPDATE products SET forro = 'FORRO' WHERE forro IS NULL OR forro = ''").run();
  db.prepare("UPDATE products SET clasificacion = 'CASUAL' WHERE clasificacion IS NULL OR clasificacion = ''").run();
  db.prepare("UPDATE products SET observaciones = ? WHERE observaciones IS NULL OR observaciones = ''").run(defaultObs);
} catch (e) {}

// Align proveedor and sublinea with marca for existing records and set sample prices
try {
  db.prepare(`
    UPDATE products 
    SET proveedor = marca, sublinea = marca 
    WHERE marca IS NOT NULL AND marca != '' AND (proveedor != marca OR sublinea != marca)
  `).run();

  db.prepare(`UPDATE products SET precio = 2499.00, costo = 1749.30 WHERE id = 1 AND (precio IS NULL OR precio = 0)`).run();
  db.prepare(`UPDATE products SET precio = 1299.00, costo = 909.30 WHERE id = 2 AND (precio IS NULL OR precio = 0)`).run();
  db.prepare(`UPDATE products SET precio = 1899.00, costo = 1329.30 WHERE id = 3 AND (precio IS NULL OR precio = 0)`).run();
  db.prepare(`UPDATE products SET precio = 2199.00, costo = 1539.30 WHERE id = 4 AND (precio IS NULL OR precio = 0)`).run();
} catch (e) {}

// Insert initial sample products if database is empty so the table looks rich
const countRow = db.prepare('SELECT COUNT(*) as count FROM products').get();
if (countRow.count === 0) {
  const insertStmt = db.prepare(`
    INSERT INTO products (codigo_barras, estilo, color, acabado, marca, temporada, proveedor, sublinea, clasificacion, linea, precio, costo, imagen, ficha_imagen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const initialProducts = [
    [
      '7501234567891',
      'OX-ROYAL-01',
      'Negro Azabache',
      'Piel Napa Plena Flor',
      'Claremm Royale',
      'Otoño/Invierno 2026',
      'Claremm Royale', // Misma que marca
      'Claremm Royale', // Misma que marca
      'Caballero',
      'Calzado Formal',
      2499.00,
      1749.30, // 2499 - 30%
      'https://images.unsplash.com/photo-1614252235316-8c857d38b5f4?w=500&auto=format&fit=crop&q=80',
      null
    ],
    [
      '7501234567892',
      'MOC-CONFORT-77',
      'Miel Caramelo',
      'Gamuza Hidrofugada',
      'Claremm Urbano',
      'Primavera/Verano 2026',
      'Claremm Urbano', // Misma que marca
      'Claremm Urbano', // Misma que marca
      'Caballero',
      'Mocasín',
      1299.00,
      909.30, // 1299 - 30%
      'https://images.unsplash.com/photo-1533867617858-e7b97e060509?w=500&auto=format&fit=crop&q=80',
      null
    ],
    [
      '7501234567893',
      'STI-GOLDEN-99',
      'Dorado Metalizado',
      'Satín & Charol Espejo',
      'Claremm Dama VIP',
      'Primavera/Verano 2026',
      'Claremm Dama VIP', // Misma que marca
      'Claremm Dama VIP', // Misma que marca
      'Dama',
      'Zapatilla Tacón',
      1899.00,
      1329.30, // 1899 - 30%
      'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=500&auto=format&fit=crop&q=80',
      null
    ],
    [
      '7501234567894',
      'BOT-CHELSEA-42',
      'Café Tabaco',
      'Cuero Crazy Horse',
      'Claremm Heritage',
      'Atemporal',
      'Claremm Heritage', // Misma que marca
      'Claremm Heritage', // Misma que marca
      'Unisex',
      'Bota Chelsea',
      2199.00,
      1539.30, // 2199 - 30%
      'https://images.unsplash.com/photo-1638247025967-b4e38f787b76?w=500&auto=format&fit=crop&q=80',
      null
    ]
  ];

  for (const p of initialProducts) {
    insertStmt.run(...p);
  }
}

// Database helper operations
export const productOperations = {
  getAll: ({ search = '', marca = '', linea = '', clasificacion = '', page = 1, limit = 10, sortBy = 'id', sortOrder = 'DESC', includeInactive = false } = {}) => {
    let whereClauses = [];
    let params = [];

    if (!includeInactive) {
      whereClauses.push('(activo = 1 OR activo IS NULL)');
    }

    if (search && search.trim() !== '') {
      const term = `%${search.trim()}%`;
      whereClauses.push(`(
        codigo_barras LIKE ? OR
        estilo LIKE ? OR
        color LIKE ? OR
        acabado LIKE ? OR
        descripcion LIKE ? OR
        corrida LIKE ? OR
        estado LIKE ? OR
        fecha_alta LIKE ? OR
        marca LIKE ? OR
        temporada LIKE ? OR
        proveedor LIKE ? OR
        sublinea LIKE ? OR
        clasificacion LIKE ? OR
        linea LIKE ? OR
        departamento LIKE ? OR
        observaciones LIKE ? OR
        suela LIKE ? OR
        plantilla LIKE ? OR
        tacon LIKE ? OR
        forro LIKE ? OR
        catalogo LIKE ? OR
        comprador LIKE ?
      )`);
      for (let i = 0; i < 22; i++) {
        params.push(term);
      }
    }

    if (marca && marca.trim() !== '') {
      whereClauses.push('marca = ?');
      params.push(marca.trim());
    }

    if (linea && linea.trim() !== '') {
      whereClauses.push('linea = ?');
      params.push(linea.trim());
    }

    if (clasificacion && clasificacion.trim() !== '') {
      whereClauses.push('clasificacion = ?');
      params.push(clasificacion.trim());
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // Count total matching items
    const countQuery = `SELECT COUNT(*) as total FROM products ${whereSql}`;
    const totalRow = db.prepare(countQuery).get(...params);
    const total = Number(totalRow.total);

    // Validate and sanitize sort column
    const allowedSortCols = [
      'id', 'codigo_barras', 'estilo', 'color', 'acabado', 'descripcion', 'corrida',
      'estado', 'fecha_alta', 'marca', 'temporada', 'proveedor', 'sublinea', 'clasificacion',
      'linea', 'departamento', 'observaciones', 'suela', 'plantilla', 'tacon', 'forro',
      'catalogo', 'comprador', 'pagina', 'status', 'precio', 'costo', 'created_at'
    ];
    const safeSortBy = allowedSortCols.includes(sortBy) ? sortBy : 'id';
    const safeSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const safeLimit = Math.max(1, parseInt(limit, 10) || 10);
    const offset = (safePage - 1) * safeLimit;

    const dataQuery = `
      SELECT * FROM products 
      ${whereSql}
      ORDER BY ${safeSortBy} ${safeSortOrder}
      LIMIT ? OFFSET ?
    `;

    const items = db.prepare(dataQuery).all(...params, safeLimit, offset);

    return {
      items,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit) || 1
      }
    };
  },

  getById: (id) => {
    return db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  },

  findByBarcode: (barcode, excludeId = null) => {
    if (!barcode || !String(barcode).trim()) return null;
    const clean = String(barcode).trim();
    if (excludeId) {
      return db.prepare('SELECT * FROM products WHERE codigo_barras = ? AND id != ? AND (activo = 1 OR activo IS NULL) LIMIT 1').get(clean, excludeId);
    }
    return db.prepare('SELECT * FROM products WHERE codigo_barras = ? AND (activo = 1 OR activo IS NULL) LIMIT 1').get(clean);
  },

  create: (data) => {
    // Proveedor and Sublinea take the same value as Marca
    const marcaVal = data.marca ? String(data.marca).trim() : '';
    const proveedorVal = marcaVal || data.proveedor || '';
    const sublineaVal = marcaVal || data.sublinea || '';
    const temporadaVal = (data.temporada && String(data.temporada).trim()) || 'CLAREMM 26';
    const departamentoVal = (data.departamento && String(data.departamento).trim()) || 'ROPA';
    const clasificacionVal = (data.clasificacion && String(data.clasificacion).trim()) || 'CASUAL';
    const suelaVal = (data.suela && String(data.suela).trim()) || 'SUELAS';
    const plantillaVal = (data.plantilla && String(data.plantilla).trim()) || (data.plantillas && String(data.plantillas).trim()) || 'PLANTILLAS';
    const taconVal = (data.tacon && String(data.tacon).trim()) || 'PISO';
    const forroVal = (data.forro && String(data.forro).trim()) || 'FORRO';
    const catalogoVal = data.catalogo ? String(data.catalogo).trim() : '';
    const observacionesVal = (data.observaciones !== undefined && data.observaciones !== null && String(data.observaciones).trim() !== '')
      ? String(data.observaciones).trim()
      : getFormattedDateDDMMYY();
    const fechaAltaVal = (data.fecha_alta && String(data.fecha_alta).trim()) || getFormattedDateDDMMYYYY();
    const descripcionVal = data.descripcion ? String(data.descripcion).trim() : '';
    const corridaVal = data.corrida ? String(data.corrida).trim() : '';
    const estadoVal = data.estado ? String(data.estado).trim() : '';
    const compradorVal = (data.comprador && String(data.comprador).trim()) || 'Sin asignar';
    const paginaVal = data.pagina !== undefined && data.pagina !== null ? (parseInt(data.pagina, 10) || 0) : 0;
    const statusVal = data.status !== undefined && data.status !== null ? (parseInt(data.status, 10) || 1) : 1;

    // Calculate costo derived from precio (-30%)
    const precioVal = parseFloat(data.precio) || 0;
    const costoVal = parseFloat(data.costo) || (precioVal > 0 ? parseFloat((precioVal * 0.70).toFixed(2)) : 0);

    const stmt = db.prepare(`
      INSERT INTO products (
        codigo_barras, estilo, color, acabado, descripcion, corrida, estado, fecha_alta,
        marca, temporada, proveedor, sublinea,
        clasificacion, linea, departamento, observaciones,
        suela, plantilla, tacon, forro, catalogo, comprador, pagina,
        precio, costo, status, imagen, imagen_thumbnail, ficha_imagen, activo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);

    const result = stmt.run(
      data.codigo_barras || '',
      data.estilo || '',
      data.color || '',
      data.acabado || '',
      descripcionVal,
      corridaVal,
      estadoVal,
      fechaAltaVal,
      marcaVal,
      temporadaVal,
      proveedorVal,
      sublineaVal,
      clasificacionVal,
      data.linea || '',
      departamentoVal,
      observacionesVal,
      suelaVal,
      plantillaVal,
      taconVal,
      forroVal,
      catalogoVal,
      compradorVal,
      paginaVal,
      precioVal,
      costoVal,
      statusVal,
      data.imagen || '',
      data.imagen_thumbnail || '',
      data.ficha_imagen || ''
    );

    const insertedId = Number(result.lastInsertRowid);
    return productOperations.getById(insertedId);
  },

  update: (id, data) => {
    const existing = productOperations.getById(id);
    if (!existing) return null;

    const marcaVal = data.marca !== undefined ? data.marca : existing.marca;
    // Proveedor and Sublinea follow Marca
    const proveedorVal = marcaVal || (data.proveedor !== undefined ? data.proveedor : existing.proveedor);
    const sublineaVal = marcaVal || (data.sublinea !== undefined ? data.sublinea : existing.sublinea);
    const departamentoVal = data.departamento !== undefined ? (data.departamento || 'ROPA') : (existing.departamento || 'ROPA');
    const clasificacionVal = data.clasificacion !== undefined ? (data.clasificacion || 'CASUAL') : (existing.clasificacion || 'CASUAL');
    const suelaVal = data.suela !== undefined ? (data.suela || 'SUELAS') : (existing.suela || 'SUELAS');
    const plantillaVal = data.plantilla !== undefined ? (data.plantilla || 'PLANTILLAS') : (existing.plantilla || 'PLANTILLAS');
    const taconVal = data.tacon !== undefined ? (data.tacon || 'PISO') : (existing.tacon || 'PISO');
    const forroVal = data.forro !== undefined ? (data.forro || 'FORRO') : (existing.forro || 'FORRO');
    const catalogoVal = data.catalogo !== undefined ? data.catalogo : (existing.catalogo || '');
    const observacionesVal = data.observaciones !== undefined 
      ? data.observaciones 
      : (existing.observaciones || getFormattedDateDDMMYY());
    const fechaAltaVal = data.fecha_alta !== undefined ? data.fecha_alta : (existing.fecha_alta || getFormattedDateDDMMYYYY());
    const descripcionVal = data.descripcion !== undefined ? data.descripcion : (existing.descripcion || '');
    const corridaVal = data.corrida !== undefined ? data.corrida : (existing.corrida || '');
    const estadoVal = data.estado !== undefined ? data.estado : (existing.estado || '');
    const compradorVal = data.comprador !== undefined ? data.comprador : (existing.comprador || 'Sin asignar');
    const paginaVal = data.pagina !== undefined ? (parseInt(data.pagina, 10) || 0) : (existing.pagina || 0);
    const statusVal = data.status !== undefined ? (parseInt(data.status, 10) || 1) : (existing.status !== undefined ? existing.status : 1);

    // Calculate costo derived from precio (-30%)
    const precioVal = data.precio !== undefined ? (parseFloat(data.precio) || 0) : existing.precio;
    const costoVal = data.costo !== undefined 
      ? (parseFloat(data.costo) || (precioVal > 0 ? parseFloat((precioVal * 0.70).toFixed(2)) : 0))
      : (precioVal > 0 ? parseFloat((precioVal * 0.70).toFixed(2)) : 0);

    const stmt = db.prepare(`
      UPDATE products SET
        codigo_barras = ?,
        estilo = ?,
        color = ?,
        acabado = ?,
        descripcion = ?,
        corrida = ?,
        estado = ?,
        fecha_alta = ?,
        marca = ?,
        temporada = ?,
        proveedor = ?,
        sublinea = ?,
        clasificacion = ?,
        linea = ?,
        departamento = ?,
        observaciones = ?,
        suela = ?,
        plantilla = ?,
        tacon = ?,
        forro = ?,
        catalogo = ?,
        comprador = ?,
        pagina = ?,
        status = ?,
        precio = ?,
        costo = ?,
        imagen = ?,
        imagen_thumbnail = ?,
        ficha_imagen = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    stmt.run(
      data.codigo_barras !== undefined ? data.codigo_barras : existing.codigo_barras,
      data.estilo !== undefined ? data.estilo : existing.estilo,
      data.color !== undefined ? data.color : existing.color,
      data.acabado !== undefined ? data.acabado : existing.acabado,
      descripcionVal,
      corridaVal,
      estadoVal,
      fechaAltaVal,
      marcaVal,
      data.temporada !== undefined ? data.temporada : existing.temporada,
      proveedorVal,
      sublineaVal,
      clasificacionVal,
      data.linea !== undefined ? data.linea : existing.linea,
      departamentoVal,
      observacionesVal,
      suelaVal,
      plantillaVal,
      taconVal,
      forroVal,
      catalogoVal,
      compradorVal,
      paginaVal,
      statusVal,
      precioVal,
      costoVal,
      data.imagen !== undefined ? data.imagen : existing.imagen,
      data.imagen_thumbnail !== undefined ? data.imagen_thumbnail : existing.imagen_thumbnail,
      data.ficha_imagen !== undefined ? data.ficha_imagen : existing.ficha_imagen,
      id
    );

    return productOperations.getById(id);
  },

  delete: (id) => {
    const existing = productOperations.getById(id);
    if (!existing) return false;
    // Soft delete: solo oculta el producto sin eliminarlo de la base de datos
    db.prepare('UPDATE products SET activo = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    return true;
  },

  restore: (id) => {
    const existing = productOperations.getById(id);
    if (!existing) return false;
    db.prepare('UPDATE products SET activo = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    return true;
  },

  bulkCreate: (productsList) => {
    const defaultObs = getFormattedDateDDMMYY();
    const defaultFechaAlta = getFormattedDateDDMMYYYY();
    const stmt = db.prepare(`
      INSERT INTO products (
        codigo_barras, estilo, color, acabado, descripcion, corrida, estado, fecha_alta,
        marca, temporada, proveedor, sublinea,
        clasificacion, linea, departamento, observaciones,
        suela, plantilla, tacon, forro, catalogo, comprador, pagina,
        precio, costo, status, imagen, imagen_thumbnail, ficha_imagen, activo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);

    let createdCount = 0;
    for (const p of productsList) {
      const marcaVal = p.marca || '';
      const proveedorVal = marcaVal || p.proveedor || '';
      const sublineaVal = marcaVal || p.sublinea || '';
      const temporadaVal = (p.temporada && String(p.temporada).trim()) || 'CLAREMM 26';
      const departamentoVal = (p.departamento && String(p.departamento).trim()) || 'ROPA';
      const clasificacionVal = (p.clasificacion && String(p.clasificacion).trim()) || 'CASUAL';
      const suelaVal = (p.suela && String(p.suela).trim()) || 'SUELAS';
      const plantillaVal = (p.plantilla && String(p.plantilla).trim()) || (p.plantillas && String(p.plantillas).trim()) || 'PLANTILLAS';
      const taconVal = (p.tacon && String(p.tacon).trim()) || 'PISO';
      const forroVal = (p.forro && String(p.forro).trim()) || 'FORRO';
      const catalogoVal = p.catalogo ? String(p.catalogo).trim() : '';
      const observacionesVal = (p.observaciones && String(p.observaciones).trim()) || defaultObs;
      const fechaAltaVal = (p.fecha_alta && String(p.fecha_alta).trim()) || defaultFechaAlta;
      const descripcionVal = p.descripcion ? String(p.descripcion).trim() : '';
      const corridaVal = p.corrida ? String(p.corrida).trim() : '';
      const estadoVal = p.estado ? String(p.estado).trim() : '';
      const compradorVal = (p.comprador && String(p.comprador).trim()) || 'Sin asignar';
      const paginaVal = p.pagina !== undefined && p.pagina !== null ? (parseInt(p.pagina, 10) || 0) : 0;
      const statusVal = p.status !== undefined && p.status !== null ? (parseInt(p.status, 10) || 1) : 1;
      const precioVal = parseFloat(p.precio) || 0;
      const costoVal = parseFloat(p.costo) || (precioVal > 0 ? parseFloat((precioVal * 0.70).toFixed(2)) : 0);

      stmt.run(
        p.codigo_barras || '',
        p.estilo || '',
        p.color || '',
        p.acabado || '',
        descripcionVal,
        corridaVal,
        estadoVal,
        fechaAltaVal,
        marcaVal,
        temporadaVal,
        proveedorVal,
        sublineaVal,
        clasificacionVal,
        p.linea || '',
        departamentoVal,
        observacionesVal,
        suelaVal,
        plantillaVal,
        taconVal,
        forroVal,
        catalogoVal,
        compradorVal,
        paginaVal,
        precioVal,
        costoVal,
        statusVal,
        p.imagen || '',
        p.imagen_thumbnail || '',
        p.ficha_imagen || ''
      );
      createdCount++;
    }

    return createdCount;
  },

  getStats: () => {
    const totalRow = db.prepare('SELECT COUNT(*) as total FROM products WHERE (activo = 1 OR activo IS NULL)').get();
    const brandsRow = db.prepare("SELECT COUNT(DISTINCT marca) as brands FROM products WHERE marca != '' AND marca IS NOT NULL AND (activo = 1 OR activo IS NULL)").get();
    const linesRow = db.prepare("SELECT COUNT(DISTINCT linea) as lines FROM products WHERE linea != '' AND linea IS NOT NULL AND (activo = 1 OR activo IS NULL)").get();
    const recent = db.prepare('SELECT * FROM products WHERE (activo = 1 OR activo IS NULL) ORDER BY id DESC LIMIT 5').all();
    
    // Group by classification
    const classifications = db.prepare(`
      SELECT clasificacion, COUNT(*) as count 
      FROM products 
      WHERE clasificacion != '' AND clasificacion IS NOT NULL AND (activo = 1 OR activo IS NULL)
      GROUP BY clasificacion
    `).all();

    return {
      total: Number(totalRow.total),
      brandsCount: Number(brandsRow.brands),
      linesCount: Number(linesRow.lines),
      recent,
      classifications
    };
  }
};

export const settingsOperations = {
  get: (key) => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
  },
  set: (key, value) => {
    db.prepare(`
      INSERT INTO settings (key, value, updated_at) 
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run(key, value);
    return value;
  }
};

export default db;
