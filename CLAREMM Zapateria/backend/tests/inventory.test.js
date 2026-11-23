import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { getSizesForCorrida, validateInventoryItems } from '../inventory.js';

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'claremm-inventory-'));
process.env.DATABASE_PATH = path.join(testDirectory, 'database.sqlite');
const { default: db, productOperations } = await import('../database.js');
const createProduct = (data) => productOperations.create({
  corrida: '18-21',
  catalogo: 'TEST',
  linea: 'TEST',
  ...data
});

after(() => {
  db.close();
  fs.rmSync(testDirectory, { recursive: true, force: true });
});

test('expands integer and half-size ranges using the endpoints', () => {
  assert.deepEqual(getSizesForCorrida('18-21'), ['18', '19', '20', '21']);
  assert.deepEqual(
    getSizesForCorrida('18-21.50'),
    ['18', '18.5', '19', '19.5', '20', '20.5', '21', '21.5']
  );
  assert.deepEqual(getSizesForCorrida('18.50-21'), ['18.5', '19', '19.5', '20', '20.5', '21']);
});

test('rejects fractional ranges that cannot form integer or half sizes', () => {
  assert.throws(() => getSizesForCorrida('18.25-21.25'), /enteras o medias tallas/);
  assert.throws(() => getSizesForCorrida('21-18'), /igual o mayor/);
});

test('validates quantities against the product corrida', () => {
  assert.deepEqual(
    validateInventoryItems('18-19', [{ size: '18', quantity: 2 }]),
    [{ size: '18', quantity: 2 }]
  );
  assert.throws(
    () => validateInventoryItems('18-19', [{ size: '18.5', quantity: 2 }]),
    /no pertenece/
  );
  assert.throws(
    () => validateInventoryItems('18-19', [{ size: '18', quantity: -1 }]),
    /entero no negativo/
  );
});

test('adds and replaces stock atomically per product and talla', () => {
  const product = createProduct({
    estilo: 'TEST-STOCK',
    corrida: '18-19',
    stockItems: [{ size: '18', quantity: 3 }]
  });
  assert.deepEqual(productOperations.getSizeInventory(product.id), [
    { size: '18', quantity: 3 },
    { size: '19', quantity: 0 }
  ]);

  productOperations.updateSizeInventory(
    product.id,
    'add',
    [{ size: '18', quantity: 2 }, { size: '19', quantity: 4 }]
  );
  assert.deepEqual(productOperations.getSizeInventory(product.id), [
    { size: '18', quantity: 5 },
    { size: '19', quantity: 4 }
  ]);

  productOperations.updateSizeInventory(product.id, 'set', [{ size: '18', quantity: 1 }]);
  assert.deepEqual(productOperations.getSizeInventory(product.id), [
    { size: '18', quantity: 1 },
    { size: '19', quantity: 4 }
  ]);

  assert.throws(
    () => productOperations.updateSizeInventory(product.id, 'add', [{ size: '20', quantity: 2 }]),
    /no pertenece/
  );
  assert.deepEqual(productOperations.getSizeInventory(product.id), [
    { size: '18', quantity: 1 },
    { size: '19', quantity: 4 }
  ]);
});

test('adds exactly one unit per quick scan and rejects a talla outside the corrida', () => {
  const product = createProduct({
    estilo: 'TEST-QUICK-SCAN',
    corrida: '21.5-22'
  });

  productOperations.updateSizeInventory(product.id, 'add', [{ size: '21.5', quantity: 1 }]);
  productOperations.updateSizeInventory(product.id, 'add', [{ size: '21.5', quantity: 1 }]);

  assert.deepEqual(productOperations.getSizeInventory(product.id), [
    { size: '21.5', quantity: 2 },
    { size: '22', quantity: 0 }
  ]);
  assert.throws(
    () => productOperations.updateSizeInventory(product.id, 'add', [{ size: '22.5', quantity: 1 }]),
    /no pertenece/
  );
  assert.equal(productOperations.getSizeInventory(product.id)[0].quantity, 2);
});

test('filters products by inclusive registration-date bounds before pagination', () => {
  const before = createProduct({ estilo: 'DATE-BEFORE' });
  const firstInRange = createProduct({ estilo: 'DATE-IN-1' });
  const secondInRange = createProduct({ estilo: 'DATE-IN-2' });
  const after = createProduct({ estilo: 'DATE-AFTER' });
  const setRegistrationDate = db.prepare('UPDATE products SET created_at = ? WHERE id = ?');
  setRegistrationDate.run('2026-11-11 23:59:59', before.id);
  setRegistrationDate.run('2026-11-12 00:00:00', firstInRange.id);
  setRegistrationDate.run('2026-11-13 23:59:59', secondInRange.id);
  setRegistrationDate.run('2026-11-14 00:00:00', after.id);

  const result = productOperations.getAll({
    search: 'DATE-',
    dateFrom: '2026-11-12',
    dateTo: '2026-11-13',
    page: 1,
    limit: 1
  });

  assert.equal(result.pagination.total, 2);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, secondInRange.id);
});

test('imports style/color/price rows without overwriting existing product data', () => {
  const template = createProduct({
    estilo: 'BASE-TEMPLATE',
    color: 'NEGRO',
    acabado: 'PIEL',
    corrida: '18-19',
    marca: 'PIRMA',
    proveedor: 'PROVEEDOR BASE',
    linea: 'TENIS',
    sublinea: 'INFANTIL',
    clasificacion: 'NIÑO',
    departamento: 'CALZADO',
    precio: 1000,
    imagen: '/uploads/template.jpg',
    codigo_barras: 'BASE-BARCODE'
  });
  const existing = createProduct({
    estilo: 'STYLE-EXISTING',
    color: 'AZUL',
    acabado: 'GAMUZA',
    corrida: '21-24',
    marca: 'OTRA MARCA',
    precio: 500,
    imagen: '/uploads/existing.jpg'
  });
  const ambiguousA = createProduct({ estilo: 'STYLE-AMBIGUOUS', color: 'ROJO' });
  createProduct({ estilo: 'STYLE-AMBIGUOUS', color: 'ROJO' });

  const result = productOperations.importStyleColorPriceRows(template.id, [
    { estilo: 'STYLE-EXISTING', color: 'AZUL', precio: 900 },
    { estilo: 'STYLE-NEW', color: 'BLANCO', precio: 800 },
    { estilo: 'STYLE-AMBIGUOUS', color: 'ROJO', precio: 700 }
  ]);
  const updated = productOperations.getById(existing.id);
  const created = productOperations.findByStyle('STYLE-NEW')[0];

  assert.equal(result.updatedCount, 1);
  assert.equal(result.createdCount, 1);
  assert.equal(result.skipped.length, 1);
  assert.equal(updated.precio, 900);
  assert.equal(updated.costo, 630);
  assert.equal(updated.acabado, 'GAMUZA');
  assert.equal(updated.corrida, '21-24');
  assert.equal(updated.marca, 'OTRA MARCA');
  assert.equal(updated.imagen, '/uploads/existing.jpg');
  assert.equal(created.marca, 'PIRMA');
  assert.equal(created.proveedor, 'PROVEEDOR BASE');
  assert.equal(created.precio, 800);
  assert.equal(created.costo, 560);
  assert.equal(created.codigo_barras, '');
  assert.equal(created.imagen, '');
  assert.equal(productOperations.getSizeInventory(created.id).every(item => item.quantity === 0), true);
  assert.equal(productOperations.getById(ambiguousA.id).precio, 0);
});

test('inherits only selected base fields and lets Excel values override them for new products', () => {
  const template = createProduct({
    estilo: 'BASE-SELECTIVE',
    acabado: 'PIEL',
    corrida: '18-21',
    marca: 'MARCA BASE',
    proveedor: 'PROVEEDOR BASE',
    precio: 1000
  });

  const result = productOperations.importStyleColorPriceRows(
    template.id,
    [{
      estilo: 'STYLE-SELECTIVE',
      color: 'BLANCO',
      precio: 800,
      marca: 'MARCA EXCEL',
      descripcion: 'Descripción desde Excel'
    }],
    ['acabado', 'corrida', 'marca', 'linea', 'catalogo']
  );
  const created = productOperations.findByStyle('STYLE-SELECTIVE')[0];

  assert.equal(result.createdCount, 1);
  assert.equal(created.acabado, 'PIEL');
  assert.equal(created.corrida, '18-21');
  assert.equal(created.marca, 'MARCA EXCEL');
  assert.equal(created.proveedor, '');
  assert.equal(created.temporada, '');
  assert.equal(created.descripcion, 'Descripción desde Excel');
  assert.equal(created.pagina, null);
  assert.equal(created.status, null);
  assert.equal(created.costo, 560);
});

test('requires corrida, catalogo and linea for new and updated products', () => {
  assert.throws(
    () => productOperations.create({ estilo: 'MISSING-CATALOG-FIELDS', corrida: '18-19', linea: 'TEST' }),
    /Catálogo/
  );
  assert.throws(
    () => db.prepare('INSERT INTO products (estilo, corrida, linea) VALUES (?, ?, ?)')
      .run('DIRECT-MISSING-CATALOG', '18-19', 'TEST'),
    /Corrida, Catálogo y Línea son obligatorios/
  );

  const product = createProduct({ estilo: 'REQUIRED-CATALOG-FIELDS' });
  assert.throws(
    () => productOperations.update(product.id, { catalogo: '  ' }),
    /Catálogo/
  );
  assert.throws(
    () => db.prepare('UPDATE products SET catalogo = ? WHERE id = ?').run('', product.id),
    /Corrida, Catálogo y Línea son obligatorios/
  );
  assert.equal(productOperations.getById(product.id).catalogo, 'TEST');
});

test('skips price-list products when corrida, catalogo or linea are not inherited or supplied', () => {
  const template = createProduct({ estilo: 'IMPORT-BASE-MISSING-FIELDS' });
  const result = productOperations.importStyleColorPriceRows(
    template.id,
    [{ estilo: 'IMPORT-MISSING-FIELDS', color: 'NEGRO', precio: 500 }],
    ['acabado', 'corrida', 'marca']
  );

  assert.equal(result.createdCount, 0);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0].reason, /Catálogo, Línea/);
  assert.equal(productOperations.findByStyle('IMPORT-MISSING-FIELDS').length, 0);
});
