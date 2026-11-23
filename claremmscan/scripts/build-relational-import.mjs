#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceDir = path.resolve(scriptDir, '../..');

function argsFrom(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    values[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return values;
}

function loadXlsx() {
  const candidates = ['xlsx', path.join(workspaceDir, 'CLAREMM Zapateria/backend/node_modules/xlsx')];
  for (const candidate of candidates) {
    try { return require(candidate); } catch {}
  }
  throw new Error('No se encontró el lector XLSX. Ejecuta el script desde este workspace o instala xlsx localmente.');
}

const cli = argsFrom(process.argv.slice(2));
const sqlitePath = path.resolve(cli.sqlite || path.join(workspaceDir, 'CLAREMM Zapateria/backend/data/database.sqlite'));
const xlsxPath = path.resolve(cli.xlsx || '/Users/laclavees12345/Downloads/CLAREMM_Inventario_Saz_Final.xlsx');
const outputPath = path.resolve(cli.output || '/tmp/claremm-relational-import.json');
const organizationName = String(cli.organization || 'CLAREMM').trim();
const branchCode = String(cli['branch-code'] || 'JUAREZ').trim().toUpperCase();
const branchName = String(cli['branch-name'] || 'CLAREMM ZAPATERIA JUAREZ').trim();

for (const file of [sqlitePath, xlsxPath]) if (!fs.existsSync(file)) throw new Error(`No existe: ${file}`);

const XLSX = loadXlsx();
const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase().replace(/\s+/g, ' ');
const text = value => String(value ?? '').trim();
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const matchKey = product => [product.estilo, product.color, product.marca].map(normalize).join('|');
const productBase = values => ({
  codigo_barras: text(values.codigo_barras), estilo: text(values.estilo), color: text(values.color), precio: number(values.precio),
  marca: text(values.marca), proveedor: text(values.proveedor), temporada: text(values.temporada), sublinea: text(values.sublinea),
  departamento: text(values.departamento), clasificacion: text(values.clasificacion), linea: text(values.linea), corrida: text(values.corrida),
  acabado: text(values.acabado), suela: text(values.suela), plantilla: text(values.plantilla), tacon: text(values.tacon), forro: text(values.forro),
  catalogo: text(values.catalogo), status: Math.trunc(number(values.status) || 1), observaciones: text(values.observaciones), costo: number(values.costo),
  descripcion: text(values.descripcion), estado: text(values.estado), fecha_alta: text(values.fecha_alta), comprador: text(values.comprador),
  pagina: Math.trunc(number(values.pagina)), activo: values.activo === undefined ? true : Boolean(Number(values.activo)), imagen: text(values.imagen),
  imagen_thumbnail: text(values.imagen_thumbnail), ficha_imagen: text(values.ficha_imagen),
});

const workbook = XLSX.readFile(xlsxPath, { cellDates: true });
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const excelRows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });
if (!excelRows.length) throw new Error('El Excel no contiene registros.');
const sizeColumns = Object.keys(excelRows[0]).filter(key => /^\d+\.\d$/.test(key));
const products = [], inventory = [], movements = [];
let excelPairs = 0, totalMismatches = 0;

for (const row of excelRows) {
  const product = productBase({
    estilo: row.Estilo, color: row.Color, precio: row['Precio de venta'], marca: row.Marca, proveedor: row.Proveedor,
    temporada: row.Temporada, sublinea: row.Sublinea, departamento: row.Departamento, clasificacion: row.Clasificacion,
    linea: row.Linea, corrida: row['Corrida de tallas'], acabado: row['Material/Acabado'], suela: row.Suela,
    plantilla: row.Plantillas, tacon: row.Tacon, forro: row.Forro, catalogo: row.Catalogo, status: row.Status,
    observaciones: row.Observaciones, costo: row.Costo,
  });
  if (!product.estilo || !product.color) throw new Error('El Excel contiene un producto sin estilo o color.');
  const sourceId = [product.estilo, product.color, product.marca, product.corrida].map(normalize).join('|');
  products.push({ ...product, source_system: 'saz_excel', source_id: sourceId, match_key: matchKey(product) });
  let calculatedTotal = 0;
  for (const size of sizeColumns) {
    const quantity = Math.trunc(number(row[size]));
    if (quantity <= 0) continue;
    calculatedTotal += quantity;
    inventory.push({ source_system: 'saz_excel', source_id: sourceId, size, quantity });
  }
  excelPairs += calculatedTotal;
  if (calculatedTotal !== Math.trunc(number(row['Total Existencia']))) totalMismatches++;
}
const db = new DatabaseSync(sqlitePath, { readOnly: true });
const sqliteProducts = db.prepare('select * from products order by id').all();
const sqliteInventory = db.prepare('select product_id, size, quantity from product_size_inventory order by product_id, size').all();
const sqliteMovements = db.prepare('select * from inventory_movements order by id').all();
const sqliteProductIds = new Set(sqliteProducts.map(product => Number(product.id)));
let sqlitePairs = 0;

for (const row of sqliteProducts) {
  const product = productBase(row);
  products.push({ ...product, source_system: 'sqlite', source_id: String(row.id), match_key: matchKey(product) });
}
for (const row of sqliteInventory) {
  if (!sqliteProductIds.has(Number(row.product_id))) throw new Error(`Inventario SQLite huérfano para product_id ${row.product_id}.`);
  const quantity = Math.trunc(number(row.quantity));
  if (quantity <= 0) continue;
  sqlitePairs += quantity;
  inventory.push({ source_system: 'sqlite', source_id: String(row.product_id), size: text(row.size), quantity });
}
for (const row of sqliteMovements) {
  if (!sqliteProductIds.has(Number(row.product_id))) continue;
  movements.push({
    source_system: 'sqlite', source_id: String(row.product_id), source_movement_id: String(row.id), size: text(row.size),
    operation: row.operation === 'add' ? 'add' : 'set', previous_quantity: Math.trunc(number(row.previous_quantity)),
    quantity: Math.trunc(number(row.quantity)), new_quantity: Math.max(0, Math.trunc(number(row.new_quantity))),
    created_at: text(row.created_at), reason: 'Historial migrado desde SQLite',
  });
}

const sourceKeys = new Set(), duplicateSourceKeys = [];
for (const product of products) {
  const key = `${product.source_system}|${product.source_id}`;
  if (sourceKeys.has(key)) duplicateSourceKeys.push(key);
  sourceKeys.add(key);
}
if (duplicateSourceKeys.length) throw new Error(`Identificadores de origen duplicados: ${duplicateSourceKeys.slice(0, 5).join(', ')}`);

const matchCounts = new Map();
for (const product of products) matchCounts.set(product.match_key, (matchCounts.get(product.match_key) || 0) + 1);
const payload = {
  version: 1,
  generated_at: new Date().toISOString(),
  organization: { name: organizationName },
  branch: { code: branchCode, name: branchName },
  summary: {
    products: products.length,
    variants_with_stock: inventory.length,
    pairs: excelPairs + sqlitePairs,
    movements: movements.length,
    sources: {
      saz_excel: { products: excelRows.length, pairs: excelPairs, total_mismatches: totalMismatches, file: path.basename(xlsxPath) },
      sqlite: { products: sqliteProducts.length, pairs: sqlitePairs, movements: sqliteMovements.length, file: path.basename(sqlitePath) },
    },
    ambiguous_match_keys: [...matchCounts.values()].filter(count => count > 1).length,
  },
  products,
  inventory,
  movements,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
console.log(JSON.stringify({ output: outputPath, ...payload.summary, organization: payload.organization.name, branch: payload.branch }, null, 2));

