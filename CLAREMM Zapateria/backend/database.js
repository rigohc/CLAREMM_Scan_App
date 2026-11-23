import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getSizesForCorrida, validateInventoryItems } from './inventory.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbDir = path.join(__dirname, 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(dbDir, 'database.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);

function normalizeProductMatch(value) {
  return String(value || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase();
}

export const PRICE_LIST_IMPORT_FIELDS = [
  'acabado', 'descripcion', 'corrida', 'estado', 'fecha_alta', 'marca', 'temporada',
  'proveedor', 'sublinea', 'clasificacion', 'linea', 'departamento', 'observaciones',
  'suela', 'plantilla', 'tacon', 'forro', 'catalogo', 'comprador', 'pagina', 'status'
];

const REQUIRED_PRODUCT_FIELDS = {
  corrida: 'Corrida',
  catalogo: 'Catálogo',
  linea: 'Línea'
};

export function getMissingRequiredProductFields(product) {
  return Object.entries(REQUIRED_PRODUCT_FIELDS)
    .filter(([field]) => String(product?.[field] ?? '').trim() === '')
    .map(([, label]) => label);
}

function assertRequiredProductFields(product) {
  const missingFields = getMissingRequiredProductFields(product);
  if (missingFields.length) {
    throw new Error(`Completa los campos obligatorios: ${missingFields.join(', ')}.`);
  }
}

export function getFormattedDateDDMMYY(dateInput = null) {
  const d = dateInput ? new Date(dateInput) : new Date();
  const validDate = isNaN(d.getTime()) ? new Date() : d;
  const dd = String(validDate.getDate()).padStart(2, '0');
  const mm = String(validDate.getMonth() + 1).padStart(2, '0');
  const yy = String(validDate.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
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
    clasificacion TEXT,
    linea TEXT,
    departamento TEXT,
    observaciones TEXT,
    suela TEXT,
    plantilla TEXT,
    tacon TEXT,
    forro TEXT,
    catalogo TEXT,
    comprador TEXT,
    pagina INTEGER,
    precio REAL DEFAULT 0,
    costo REAL DEFAULT 0,
    status INTEGER,
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

  CREATE TABLE IF NOT EXISTS product_size_inventory (
    product_id INTEGER NOT NULL REFERENCES products(id),
    size TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity >= 0),
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (product_id, size)
  );

  CREATE TABLE IF NOT EXISTS inventory_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    size TEXT NOT NULL,
    operation TEXT NOT NULL CHECK (operation IN ('add', 'set')),
    previous_quantity INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    new_quantity INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migrations: ensure columns exist for existing databases
try { db.exec('ALTER TABLE products ADD COLUMN codigo_barras TEXT;'); } catch (e) {}
try { db.exec('ALTER TABLE products ADD COLUMN precio REAL DEFAULT 0;'); } catch (e) {}
try { db.exec('ALTER TABLE products ADD COLUMN costo REAL DEFAULT 0;'); } catch (e) {}
try { db.exec('ALTER TABLE products ADD COLUMN imagen_thumbnail TEXT;'); } catch (e) {}
try { db.exec('ALTER TABLE products ADD COLUMN departamento TEXT;'); } catch (e) {}
try { db.exec("ALTER TABLE products ADD COLUMN observaciones TEXT;"); } catch (e) {}
try { db.exec('ALTER TABLE products ADD COLUMN suela TEXT;'); } catch (e) {}
try { db.exec('ALTER TABLE products ADD COLUMN plantilla TEXT;'); } catch (e) {}
try { db.exec('ALTER TABLE products ADD COLUMN tacon TEXT;'); } catch (e) {}
try { db.exec('ALTER TABLE products ADD COLUMN forro TEXT;'); } catch (e) {}
try { db.exec("ALTER TABLE products ADD COLUMN catalogo TEXT;"); } catch (e) {}
try { db.exec("ALTER TABLE products ADD COLUMN activo INTEGER DEFAULT 1;"); } catch (e) {}
try { db.exec("ALTER TABLE products ADD COLUMN descripcion TEXT;"); } catch (e) {}
try { db.exec("ALTER TABLE products ADD COLUMN corrida TEXT;"); } catch (e) {}
try { db.exec("ALTER TABLE products ADD COLUMN estado TEXT;"); } catch (e) {}
try { db.exec("ALTER TABLE products ADD COLUMN fecha_alta TEXT;"); } catch (e) {}
try { db.exec('ALTER TABLE products ADD COLUMN comprador TEXT;'); } catch (e) {}
try { db.exec('ALTER TABLE products ADD COLUMN pagina INTEGER;'); } catch (e) {}
try { db.exec('ALTER TABLE products ADD COLUMN status INTEGER;'); } catch (e) {}

db.exec(`
  CREATE TRIGGER IF NOT EXISTS products_require_catalog_fields_insert
  BEFORE INSERT ON products
  WHEN NULLIF(TRIM(COALESCE(NEW.corrida, '')), '') IS NULL
    OR NULLIF(TRIM(COALESCE(NEW.catalogo, '')), '') IS NULL
    OR NULLIF(TRIM(COALESCE(NEW.linea, '')), '') IS NULL
  BEGIN
    SELECT RAISE(ABORT, 'Corrida, Catálogo y Línea son obligatorios.');
  END;

  CREATE TRIGGER IF NOT EXISTS products_require_catalog_fields_update
  BEFORE UPDATE OF corrida, catalogo, linea ON products
  WHEN NULLIF(TRIM(COALESCE(NEW.corrida, '')), '') IS NULL
    OR NULLIF(TRIM(COALESCE(NEW.catalogo, '')), '') IS NULL
    OR NULLIF(TRIM(COALESCE(NEW.linea, '')), '') IS NULL
  BEGIN
    SELECT RAISE(ABORT, 'Corrida, Catálogo y Línea son obligatorios.');
  END;
`);

// Populate defaults for existing records
try {
  const defaultObs = getFormattedDateDDMMYY();
  db.prepare("UPDATE products SET activo = 1 WHERE activo IS NULL").run();
  db.prepare("UPDATE products SET observaciones = ? WHERE observaciones IS NULL OR observaciones = ''").run(defaultObs);
} catch (e) {}

// Set sample prices for the initial catalog records.
try {
  db.prepare(`UPDATE products SET precio = 2499.00, costo = 1749.30 WHERE id = 1 AND (precio IS NULL OR precio = 0)`).run();
  db.prepare(`UPDATE products SET precio = 1299.00, costo = 909.30 WHERE id = 2 AND (precio IS NULL OR precio = 0)`).run();
  db.prepare(`UPDATE products SET precio = 1899.00, costo = 1329.30 WHERE id = 3 AND (precio IS NULL OR precio = 0)`).run();
  db.prepare(`UPDATE products SET precio = 2199.00, costo = 1539.30 WHERE id = 4 AND (precio IS NULL OR precio = 0)`).run();
} catch (e) {}

// Insert initial sample products if database is empty so the table looks rich
const countRow = db.prepare('SELECT COUNT(*) as count FROM products').get();
if (countRow.count === 0) {
  const insertStmt = db.prepare(`
    INSERT INTO products (codigo_barras, estilo, color, acabado, marca, temporada, proveedor, sublinea, clasificacion, linea, corrida, catalogo, precio, costo, imagen, ficha_imagen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      '21.50-27.00',
      'CLAREMM 26',
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
      '21.50-27.00',
      'CLAREMM 26',
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
      '21.50-27.00',
      'CLAREMM 26',
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
      '21.50-27.00',
      'CLAREMM 26',
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
  getAll: ({ search = '', marca = '', linea = '', clasificacion = '', dateFrom = '', dateTo = '', page = 1, limit = 10, sortBy = 'id', sortOrder = 'DESC', includeInactive = false } = {}) => {
    let whereClauses = [];
    let params = [];

    whereClauses.push(`
      NULLIF(TRIM(COALESCE(corrida, '')), '') IS NOT NULL
      AND NULLIF(TRIM(COALESCE(catalogo, '')), '') IS NOT NULL
      AND NULLIF(TRIM(COALESCE(linea, '')), '') IS NOT NULL
    `);

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

    if (dateFrom) {
      whereClauses.push('date(created_at) >= date(?)');
      params.push(dateFrom);
    }

    if (dateTo) {
      whereClauses.push('date(created_at) <= date(?)');
      params.push(dateTo);
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

  findByStyle: (style) => {
    return db.prepare(`
      SELECT * FROM products
      WHERE UPPER(TRIM(estilo)) = UPPER(TRIM(?))
        AND (activo = 1 OR activo IS NULL)
        AND NULLIF(TRIM(COALESCE(corrida, '')), '') IS NOT NULL
        AND NULLIF(TRIM(COALESCE(catalogo, '')), '') IS NOT NULL
        AND NULLIF(TRIM(COALESCE(linea, '')), '') IS NOT NULL
      ORDER BY color, acabado, marca
    `).all(style);
  },

  getSizeInventory: (id) => {
    const product = productOperations.getById(id);
    if (!product) return null;

    const quantities = new Map(
      db.prepare('SELECT size, quantity FROM product_size_inventory WHERE product_id = ?')
        .all(id)
        .map(row => [row.size, Number(row.quantity)])
    );
    return getSizesForCorrida(product.corrida).map(size => ({
      size,
      quantity: quantities.get(size) || 0
    }));
  },

  updateSizeInventory: (id, operation, items) => {
    const product = productOperations.getById(id);
    if (!product) return null;
    if (!['add', 'set'].includes(operation)) {
      throw new Error('La operación debe ser sumar o reemplazar.');
    }

    const validatedItems = validateInventoryItems(product.corrida, items);
    const selectQuantity = db.prepare(
      'SELECT quantity FROM product_size_inventory WHERE product_id = ? AND size = ?'
    );
    const upsertQuantity = db.prepare(`
      INSERT INTO product_size_inventory (product_id, size, quantity, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(product_id, size) DO UPDATE SET
        quantity = excluded.quantity,
        updated_at = CURRENT_TIMESTAMP
    `);
    const insertMovement = db.prepare(`
      INSERT INTO inventory_movements (
        product_id, size, operation, previous_quantity, quantity, new_quantity
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    db.exec('BEGIN IMMEDIATE');
    try {
      for (const item of validatedItems) {
        const previousQuantity = Number(
          selectQuantity.get(id, item.size)?.quantity || 0
        );
        const newQuantity = operation === 'add'
          ? previousQuantity + item.quantity
          : item.quantity;
        if (!Number.isSafeInteger(newQuantity)) {
          throw new Error(`La cantidad acumulada de la talla ${item.size} es demasiado grande.`);
        }
        upsertQuantity.run(id, item.size, newQuantity);
        insertMovement.run(
          id,
          item.size,
          operation,
          previousQuantity,
          item.quantity,
          newQuantity
        );
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }

    return productOperations.getSizeInventory(id);
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
    assertRequiredProductFields(data);
    const marcaVal = data.marca ? String(data.marca).trim() : '';
    const proveedorVal = data.proveedor ? String(data.proveedor).trim() : '';
    const sublineaVal = data.sublinea ? String(data.sublinea).trim() : '';
    const temporadaVal = (data.temporada && String(data.temporada).trim()) || 'CLAREMM 26';
    const departamentoVal = data.departamento ? String(data.departamento).trim() : '';
    const clasificacionVal = data.clasificacion ? String(data.clasificacion).trim() : '';
    const suelaVal = data.suela ? String(data.suela).trim() : '';
    const plantillaVal = data.plantilla ? String(data.plantilla).trim() : '';
    const taconVal = data.tacon ? String(data.tacon).trim() : '';
    const forroVal = data.forro ? String(data.forro).trim() : '';
    const catalogoVal = data.catalogo ? String(data.catalogo).trim() : '';
    const observacionesVal = (data.observaciones !== undefined && data.observaciones !== null && String(data.observaciones).trim() !== '')
      ? String(data.observaciones).trim()
      : getFormattedDateDDMMYY();
    const fechaAltaVal = data.fecha_alta ? String(data.fecha_alta).trim() : '';
    const descripcionVal = data.descripcion ? String(data.descripcion).trim() : '';
    const corridaVal = data.corrida ? String(data.corrida).trim() : '';
    const estadoVal = data.estado ? String(data.estado).trim() : '';
    const compradorVal = data.comprador ? String(data.comprador).trim() : '';
    const paginaValue = data.pagina === undefined || data.pagina === null || String(data.pagina).trim() === ''
      ? NaN
      : parseInt(data.pagina, 10);
    const paginaVal = Number.isNaN(paginaValue) ? null : paginaValue;
    const statusValue = data.status === undefined || data.status === null || String(data.status).trim() === ''
      ? NaN
      : parseInt(data.status, 10);
    const statusVal = Number.isNaN(statusValue) ? null : statusValue;

    // Calculate costo derived from precio (-30%)
    const precioVal = parseFloat(data.precio) || 0;
    const costoVal = parseFloat(data.costo) || (precioVal > 0 ? parseFloat((precioVal * 0.70).toFixed(2)) : 0);
    const stockItems = data.stockItems === undefined
      ? []
      : validateInventoryItems(corridaVal, data.stockItems);

    const stmt = db.prepare(`
      INSERT INTO products (
        codigo_barras, estilo, color, acabado, descripcion, corrida, estado, fecha_alta,
        marca, temporada, proveedor, sublinea,
        clasificacion, linea, departamento, observaciones,
        suela, plantilla, tacon, forro, catalogo, comprador, pagina,
        precio, costo, status, imagen, imagen_thumbnail, ficha_imagen, activo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);

    db.exec('BEGIN IMMEDIATE');
    try {
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
      const addInitialStock = db.prepare(`
        INSERT INTO product_size_inventory (product_id, size, quantity, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `);
      const logInitialStock = db.prepare(`
        INSERT INTO inventory_movements (
          product_id, size, operation, previous_quantity, quantity, new_quantity
        ) VALUES (?, ?, 'set', 0, ?, ?)
      `);
      for (const item of stockItems) {
        addInitialStock.run(insertedId, item.size, item.quantity);
        logInitialStock.run(insertedId, item.size, item.quantity, item.quantity);
      }

      db.exec('COMMIT');
      return productOperations.getById(insertedId);
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  },

  update: (id, data) => {
    const existing = productOperations.getById(id);
    if (!existing) return null;

    const marcaVal = data.marca !== undefined ? data.marca : existing.marca;
    const proveedorVal = data.proveedor !== undefined ? data.proveedor : (existing.proveedor || '');
    const sublineaVal = data.sublinea !== undefined ? data.sublinea : (existing.sublinea || '');
    const departamentoVal = data.departamento !== undefined ? data.departamento : (existing.departamento || '');
    const clasificacionVal = data.clasificacion !== undefined ? data.clasificacion : (existing.clasificacion || '');
    const suelaVal = data.suela !== undefined ? data.suela : (existing.suela || '');
    const plantillaVal = data.plantilla !== undefined ? data.plantilla : (existing.plantilla || '');
    const taconVal = data.tacon !== undefined ? data.tacon : (existing.tacon || '');
    const forroVal = data.forro !== undefined ? data.forro : (existing.forro || '');
    const catalogoVal = data.catalogo !== undefined ? data.catalogo : (existing.catalogo || '');
    const observacionesVal = data.observaciones !== undefined 
      ? data.observaciones 
      : (existing.observaciones || getFormattedDateDDMMYY());
    const fechaAltaVal = data.fecha_alta !== undefined ? data.fecha_alta : (existing.fecha_alta || '');
    const descripcionVal = data.descripcion !== undefined ? data.descripcion : (existing.descripcion || '');
    const corridaVal = data.corrida !== undefined ? data.corrida : (existing.corrida || '');
    const estadoVal = data.estado !== undefined ? data.estado : (existing.estado || '');
    const compradorVal = data.comprador !== undefined ? data.comprador : (existing.comprador || '');
    const paginaInput = data.pagina !== undefined ? data.pagina : existing.pagina;
    const paginaParsed = paginaInput === null || paginaInput === undefined || String(paginaInput).trim() === ''
      ? NaN
      : parseInt(paginaInput, 10);
    const paginaVal = Number.isNaN(paginaParsed) ? null : paginaParsed;
    const statusInput = data.status !== undefined ? data.status : existing.status;
    const statusParsed = statusInput === null || statusInput === undefined || String(statusInput).trim() === ''
      ? NaN
      : parseInt(statusInput, 10);
    const statusVal = Number.isNaN(statusParsed) ? null : statusParsed;

    // Calculate costo derived from precio (-30%)
    const precioVal = data.precio !== undefined ? (parseFloat(data.precio) || 0) : existing.precio;
    const costoVal = data.costo !== undefined 
      ? (parseFloat(data.costo) || (precioVal > 0 ? parseFloat((precioVal * 0.70).toFixed(2)) : 0))
      : (precioVal > 0 ? parseFloat((precioVal * 0.70).toFixed(2)) : 0);

    assertRequiredProductFields({
      corrida: corridaVal,
      catalogo: catalogoVal,
      linea: data.linea !== undefined ? data.linea : existing.linea
    });

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
    productsList.forEach((product, index) => {
      const missingFields = getMissingRequiredProductFields(product);
      if (missingFields.length) {
        throw new Error(`Fila ${index + 1}: faltan campos obligatorios: ${missingFields.join(', ')}.`);
      }
    });

    const defaultObs = getFormattedDateDDMMYY();
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
      const proveedorVal = p.proveedor || '';
      const sublineaVal = p.sublinea || '';
      const temporadaVal = (p.temporada && String(p.temporada).trim()) || 'CLAREMM 26';
      const departamentoVal = (p.departamento && String(p.departamento).trim()) || '';
      const clasificacionVal = (p.clasificacion && String(p.clasificacion).trim()) || '';
      const suelaVal = (p.suela && String(p.suela).trim()) || '';
      const plantillaVal = (p.plantilla && String(p.plantilla).trim()) || '';
      const taconVal = (p.tacon && String(p.tacon).trim()) || '';
      const forroVal = (p.forro && String(p.forro).trim()) || '';
      const catalogoVal = p.catalogo ? String(p.catalogo).trim() : '';
      const observacionesVal = (p.observaciones && String(p.observaciones).trim()) || defaultObs;
      const fechaAltaVal = (p.fecha_alta && String(p.fecha_alta).trim()) || '';
      const descripcionVal = p.descripcion ? String(p.descripcion).trim() : '';
      const corridaVal = p.corrida ? String(p.corrida).trim() : '';
      const estadoVal = p.estado ? String(p.estado).trim() : '';
      const compradorVal = (p.comprador && String(p.comprador).trim()) || '';
      const paginaValue = p.pagina === undefined || p.pagina === null || String(p.pagina).trim() === ''
        ? NaN
        : parseInt(p.pagina, 10);
      const paginaVal = Number.isNaN(paginaValue) ? null : paginaValue;
      const statusValue = p.status === undefined || p.status === null || String(p.status).trim() === ''
        ? NaN
        : parseInt(p.status, 10);
      const statusVal = Number.isNaN(statusValue) ? null : statusValue;
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

  importStyleColorPriceRows: (templateProductId, rows, fieldsToInherit = PRICE_LIST_IMPORT_FIELDS) => {
    if (!Array.isArray(fieldsToInherit)
        || fieldsToInherit.some(field => !PRICE_LIST_IMPORT_FIELDS.includes(field))
        || new Set(fieldsToInherit).size !== fieldsToInherit.length) {
      throw new Error('La selección de campos para heredar no es válida.');
    }

    const insertFields = PRICE_LIST_IMPORT_FIELDS.filter(field => field !== 'status');
    const updateExisting = db.prepare(`
      UPDATE products
      SET estilo = ?, color = ?, precio = ?, costo = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND (activo = 1 OR activo IS NULL)
    `);
    const insertNew = db.prepare(`
      INSERT INTO products (
        codigo_barras, estilo, color, ${insertFields.join(', ')},
        precio, costo, status, imagen, imagen_thumbnail, ficha_imagen, activo
      ) VALUES (?, ?, ?, ${insertFields.map(() => '?').join(', ')}, ?, ?, ?, '', '', '', 1)
    `);

    const result = { createdCount: 0, updatedCount: 0, skipped: [] };
    db.exec('BEGIN IMMEDIATE');
    try {
      const template = productOperations.getById(templateProductId);
      if (!template || (template.activo !== 1 && template.activo !== null)) {
        throw new Error('El producto base seleccionado no está activo.');
      }
      const activeProducts = db.prepare(
        'SELECT * FROM products WHERE activo = 1 OR activo IS NULL'
      ).all();

      for (const row of rows) {
        const matches = activeProducts.filter(product =>
          normalizeProductMatch(product.estilo) === normalizeProductMatch(row.estilo)
          && normalizeProductMatch(product.color) === normalizeProductMatch(row.color)
        );
        if (matches.length > 1) {
          result.skipped.push({
            estilo: row.estilo,
            color: row.color,
            reason: `Hay ${matches.length} productos activos con ese Estilo y Color; no se modificó ninguno.`
          });
          continue;
        }

        const price = Number(row.precio);
        const cost = Number((price * 0.7).toFixed(2));
        if (matches.length === 1) {
          const existing = matches[0];
          updateExisting.run(row.estilo, row.color, price, cost, existing.id);
          existing.estilo = row.estilo;
          existing.color = row.color;
          result.updatedCount++;
          continue;
        }

        const inheritedProduct = Object.fromEntries(insertFields.map(field => {
          const inherited = fieldsToInherit.includes(field) ? template[field] : null;
          if (row[field] !== undefined) return [field, row[field]];
          if (field === 'temporada' && fieldsToInherit.includes(field) && !inherited) {
            return [field, 'CLAREMM 26'];
          }
          return [field, inherited ?? (field === 'pagina' ? null : '')];
        }));
        const missingFields = getMissingRequiredProductFields(inheritedProduct);
        if (missingFields.length) {
          result.skipped.push({
            estilo: row.estilo,
            color: row.color,
            reason: `Faltan campos obligatorios: ${missingFields.join(', ')}.`
          });
          continue;
        }
        const inheritedValues = insertFields.map(field => inheritedProduct[field]);
        const status = row.status !== undefined
          ? row.status
          : (fieldsToInherit.includes('status') ? template.status : null);
        const insertResult = insertNew.run(
          '',
          row.estilo,
          row.color,
          ...inheritedValues,
          price,
          cost,
          status
        );
        const created = productOperations.getById(Number(insertResult.lastInsertRowid));
        activeProducts.push(created);
        result.createdCount++;
      }
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  },

  getStats: () => {
    const requiredFieldsSql = `
      NULLIF(TRIM(COALESCE(corrida, '')), '') IS NOT NULL
      AND NULLIF(TRIM(COALESCE(catalogo, '')), '') IS NOT NULL
      AND NULLIF(TRIM(COALESCE(linea, '')), '') IS NOT NULL
    `;
    const activeAndValid = `(activo = 1 OR activo IS NULL) AND ${requiredFieldsSql}`;
    const totalRow = db.prepare(`SELECT COUNT(*) as total FROM products WHERE ${activeAndValid}`).get();
    const brandsRow = db.prepare(`SELECT COUNT(DISTINCT marca) as brands FROM products WHERE marca != '' AND marca IS NOT NULL AND ${activeAndValid}`).get();
    const linesRow = db.prepare(`SELECT COUNT(DISTINCT linea) as lines FROM products WHERE linea != '' AND linea IS NOT NULL AND ${activeAndValid}`).get();
    const recent = db.prepare(`SELECT * FROM products WHERE ${activeAndValid} ORDER BY id DESC LIMIT 5`).all();
    
    // Group by classification
    const classifications = db.prepare(`
      SELECT clasificacion, COUNT(*) as count 
      FROM products 
      WHERE clasificacion != '' AND clasificacion IS NOT NULL AND ${activeAndValid}
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
