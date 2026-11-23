#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceDir = path.resolve(scriptDir, '../..');
const XLSX = require(path.join(workspaceDir, 'CLAREMM Zapateria/backend/node_modules/xlsx'));
const SazCatalog = require(path.join(scriptDir, '../saz-catalog.js'));
SazCatalog.loadFromData(
  JSON.parse(fs.readFileSync(path.join(scriptDir, '../saz-catalog/product-option-values.json'), 'utf8')),
  JSON.parse(fs.readFileSync(path.join(scriptDir, '../saz-catalog/provider-option-values.json'), 'utf8')),
);

function argsFrom(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index++) {
    if (!argv[index].startsWith('--')) continue;
    values[argv[index].slice(2)] = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : true;
  }
  return values;
}

function readEnv(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/).flatMap(line => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1].startsWith('#')) return [];
    return [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]];
  }));
}

const cli = argsFrom(process.argv.slice(2));
const apply = cli.apply === true;
const SAZ_THROUGH_ROW = Number(cli['saz-through'] || 194);
const SOURCE_SYSTEM = 'excel_inventario';
const IMPORT_PREFIX = 'hoja-calculo-20261122';
const LOADED_STATUS = 'CARGADO EN SAZ';
const excelPath = path.resolve(cli.xlsx || '/Users/laclavees12345/Downloads/Hoja de cálculo sin título (2).xlsx');
const outputPath = path.resolve(cli.output || path.join(workspaceDir, 'entregables/hoja-calculo-supabase.json'));
const env = { ...readEnv(path.resolve(scriptDir, '../.env.local')), ...process.env };
const url = String(env.SUPABASE_URL || '').replace(/\/$/, '');
const apiKey = env.SUPABASE_PUBLISHABLE_KEY || '';
const email = String(env.SUPABASE_MIGRATION_EMAIL || '').trim();
const password = String(env.SUPABASE_MIGRATION_PASSWORD || '').trim();
if (!fs.existsSync(excelPath)) throw new Error(`No existe: ${excelPath}`);
if (!url || !apiKey || !email || !password) throw new Error('Faltan credenciales de Supabase.');

const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase().replace(/\s+/g, ' ');
const text = value => String(value ?? '').trim();
const number = value => Number(String(value ?? '').replace(/[^0-9.-]/g, '')) || 0;
const estiloText = value => (typeof value === 'number' && Number.isFinite(value) ? String(Math.trunc(value)) : String(value ?? '').trim());
const compactEstilo = value => normalize(value).replace(/^0+(?=\d)/, '');
const hyphenlessEstilo = value => compactEstilo(value).replace(/-/g, '');
const padEstilo = value => {
  const compact = compactEstilo(value);
  return /^\d+$/.test(compact) ? compact.padStart(Math.max(6, compact.length), '0') : normalize(estiloText(value));
};
const lookupKey = (estilo, color) => `${normalize(estilo)}|${normalize(color)}`;
const compactKey = (estilo, color) => `${hyphenlessEstilo(estilo)}|${normalize(color)}`;
const COLOR_TOKEN_ALIASES = { BCO: 'BLANCO', BLNCO: 'BLANCO', NGO: 'NEGRO', NGRO: 'NEGRO', MULTI: 'MULTICOLOR' };
const sizeKey = value => {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed.toFixed(1) : text(value);
};
const chunks = (values, size = 80) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
const sameText = (left, right) => text(left) === text(right);
const isEmptyCell = value => value === '' || value == null;
const TEXT_FIELDS = ['marca', 'proveedor', 'temporada', 'sublinea', 'departamento', 'clasificacion', 'linea', 'corrida', 'acabado', 'suela', 'plantilla', 'tacon', 'forro', 'catalogo', 'observaciones'];
const SAZ_FIELDS = {
  marca: 'marca', proveedor: 'proveedor', temporada: 'temporada', sublinea: 'sublinea',
  departamento: 'departamento', clasificacion: 'clasificacion', linea: 'linea', corrida: 'corrida',
  acabado: 'acabado', suela: 'suela', plantilla: 'plantilla', tacon: 'tacon', forro: 'forro', catalogo: 'catalogo',
};

function estiloKeys(value) {
  const raw = normalize(estiloText(value));
  const compact = compactEstilo(raw);
  const hyphenless = hyphenlessEstilo(raw);
  const padded = /^\d+$/.test(compact.replace(/-/g, '')) ? compact.replace(/-/g, '').padStart(Math.max(6, compact.replace(/-/g, '').length), '0') : '';
  return [...new Set([raw, compact, hyphenless, padded].filter(Boolean))];
}

function colorKeys(value) {
  const resolved = SazCatalog.resolve('color', value) || normalize(value);
  const normalized = normalize(resolved);
  const spaced = normalized.replace(/[\/]+/g, ' ').replace(/\s+/g, ' ');
  const slashed = normalized.replace(/\s*\/\s*/g, '/');
  return [...new Set([normalize(value), normalized, spaced, slashed].filter(Boolean))];
}

function colorTokens(value) {
  return normalize(SazCatalog.resolve('color', value) || value)
    .replace(/[\/]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(token => COLOR_TOKEN_ALIASES[token] || token);
}

function colorsCompatible(left, right) {
  if (!text(left) || !text(right)) return false;
  if (SazCatalog.matches('color', left, right)) return true;
  const a = colorTokens(left);
  const b = colorTokens(right);
  if (a.join('|') === b.join('|')) return true;
  const sortedA = [...a].sort().join('|');
  const sortedB = [...b].sort().join('|');
  if (sortedA === sortedB) return true;
  const setA = new Set(a);
  const setB = new Set(b);
  return [...setA].every(token => setB.has(token)) || [...setB].every(token => setA.has(token));
}

function obsText(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const day = String(value.getDate()).padStart(2, '0');
    const month = String(value.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${String(value.getFullYear()).slice(-2)}`;
  }
  return text(value);
}

function resolveField(field, value) {
  if (!text(value)) return '';
  if (field === 'observaciones') return obsText(value);
  if (SAZ_FIELDS[field]) return SazCatalog.resolve(SAZ_FIELDS[field], value) || text(value);
  return text(value);
}

const authResponse = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: apiKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const auth = await authResponse.json();
if (!authResponse.ok || !auth.access_token || !auth.user?.id) {
  throw new Error(`Auth: ${auth.error_description || auth.message || authResponse.status}`);
}
const token = auth.access_token;
const userId = auth.user.id;

async function rest(resource, { method = 'GET', body, prefer = '' } = {}) {
  const response = await fetch(`${url}/rest/v1/${resource}`, {
    method,
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  const data = raw ? JSON.parse(raw) : null;
  if (!response.ok) throw new Error(`${method} ${resource}: ${data?.message || data?.details || raw || response.status}`);
  return data;
}

async function allRows(resource, pageSize = 1000) {
  const result = [];
  for (let offset = 0; ; offset += pageSize) {
    const separator = resource.includes('?') ? '&' : '?';
    const rows = await rest(`${resource}${separator}limit=${pageSize}&offset=${offset}`);
    result.push(...rows);
    if (rows.length < pageSize) return result;
  }
}

async function mapPool(items, size, worker) {
  const result = [];
  for (const group of chunks(items, size)) {
    result.push(...await Promise.all(group.map(worker)));
  }
  return result;
}

const memberships = await rest(`organization_members?select=organization_id&user_id=eq.${encodeURIComponent(userId)}`);
const organizations = await rest(`organizations?select=id,name&id=in.(${memberships.map(row => row.organization_id).join(',')})`);
const organization = organizations.find(row => normalize(row.name) === 'CLAREMM');
if (!organization) throw new Error('No se encontró la organización CLAREMM.');
const branches = await allRows(`branches?select=id,code,name,active&organization_id=eq.${organization.id}`);
const juarez = branches.find(row => row.code === 'JUAREZ') || branches[0];
if (!juarez) throw new Error('No se encontró sucursal JUAREZ.');

const [products, variants, registry, priorMovements] = await Promise.all([
  allRows(`products?select=id,estilo,color,marca,proveedor,temporada,sublinea,departamento,clasificacion,linea,corrida,acabado,suela,plantilla,tacon,forro,catalogo,status,observaciones,costo,precio,imagen,source_system,source_id,activo,match_key,estado&organization_id=eq.${organization.id}`),
  allRows('product_variants?select=id,product_id,size'),
  allRows(`saz_product_registry?select=id,product_id,lookup_key,estilo,color,source_files&organization_id=eq.${organization.id}`),
  allRows(`inventory_movements_relational?select=import_key&import_key=like.${IMPORT_PREFIX}*`),
]);
const productIdSet = new Set(products.map(product => product.id));
const orgVariants = variants.filter(variant => productIdSet.has(variant.product_id));
const appliedKeys = new Set((priorMovements || []).map(row => String(row.import_key || '')));
const levels = [];
for (const group of chunks(orgVariants.map(variant => variant.id), 200)) {
  if (!group.length) continue;
  levels.push(...await rest(`inventory_levels?select=branch_id,variant_id,quantity&variant_id=in.(${group.join(',')})`));
}

const workbook = XLSX.readFile(excelPath, { cellDates: true, raw: true });
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
const headersRow = matrix[0] || [];
const totalIndex = headersRow.findIndex(value => normalize(value) === 'TOTAL EXISTENCIA');
if (totalIndex <= 20) throw new Error('El Excel no tiene la columna Total Existencia esperada.');
const sizes = [];
for (let index = 20; index < totalIndex; index++) {
  const header = Number(headersRow[index]);
  if (!Number.isFinite(header)) throw new Error(`Talla inválida en columna ${index}: ${headersRow[index]}`);
  sizes.push(sizeKey(header));
}

const excelRows = [];
const totalMismatches = [];
for (let index = 1; index < matrix.length; index++) {
  const row = matrix[index];
  const excelRow = index + 1;
  const estilo = estiloText(row[0]);
  const colorRaw = text(row[1]);
  if (!estilo && !colorRaw) continue;
  if (!estilo || !colorRaw) throw new Error(`Fila ${excelRow} sin estilo o color.`);
  const color = SazCatalog.resolve('color', colorRaw) || normalize(colorRaw);
  const qtyBySize = {};
  let calculated = 0;
  let hasSizeCells = false;
  sizes.forEach((size, sizeIndex) => {
    const raw = row[20 + sizeIndex];
    if (isEmptyCell(raw)) return;
    hasSizeCells = true;
    const quantity = Math.trunc(number(raw));
    if (quantity <= 0) return;
    calculated += quantity;
    qtyBySize[size] = (qtyBySize[size] || 0) + quantity;
  });
  const declaredRaw = row[totalIndex];
  const declared = isEmptyCell(declaredRaw) ? calculated : Math.trunc(number(declaredRaw));
  if (hasSizeCells && calculated !== declared) totalMismatches.push({ row: excelRow, estilo, color, calculated, declared });
  excelRows.push({
    source_row: excelRow,
    estilo_raw: estilo,
    estilo: padEstilo(estilo),
    color,
    color_raw: colorRaw,
    precio: isEmptyCell(row[2]) ? 0 : number(row[2]),
    marca: resolveField('marca', row[3]),
    proveedor: resolveField('proveedor', row[4]),
    temporada: resolveField('temporada', row[5]),
    sublinea: resolveField('sublinea', row[6]),
    departamento: resolveField('departamento', row[7]),
    clasificacion: resolveField('clasificacion', row[8]),
    linea: resolveField('linea', row[9]),
    corrida: resolveField('corrida', row[10]),
    acabado: resolveField('acabado', row[11]),
    suela: resolveField('suela', row[12]),
    plantilla: resolveField('plantilla', row[13]),
    tacon: resolveField('tacon', row[14]),
    forro: resolveField('forro', row[15]),
    catalogo: resolveField('catalogo', row[16]),
    status: isEmptyCell(row[17]) ? null : Math.trunc(number(row[17]) || 1),
    observaciones: resolveField('observaciones', row[18]),
    costo: isEmptyCell(row[19]) ? 0 : number(row[19]),
    qtyBySize,
    pairs: calculated,
    declared,
    hasSizeCells,
    saz_registered: excelRow <= SAZ_THROUGH_ROW,
  });
}

function mergeRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = compactKey(row.estilo_raw, row.color);
    if (!map.has(key)) {
      map.set(key, { ...row, source_rows: [row.source_row], qtyBySize: { ...row.qtyBySize } });
      continue;
    }
    const current = map.get(key);
    current.source_rows.push(row.source_row);
    current.pairs += row.pairs;
    current.declared += row.declared;
    current.hasSizeCells = current.hasSizeCells || row.hasSizeCells;
    current.saz_registered = current.saz_registered || row.saz_registered;
    if (/^0+\d/.test(row.estilo_raw) || padEstilo(row.estilo_raw).length > padEstilo(current.estilo).length) current.estilo = padEstilo(row.estilo_raw);
    for (const [size, quantity] of Object.entries(row.qtyBySize)) current.qtyBySize[size] = (current.qtyBySize[size] || 0) + quantity;
    if (row.precio > 0) current.precio = row.precio;
    if (row.costo > 0) current.costo = row.costo;
    if (row.status != null) current.status = row.status;
    for (const field of TEXT_FIELDS) if (row[field]) current[field] = row[field];
  }
  return [...map.values()];
}

const excelProducts = mergeRows(excelRows);
const productsByLookup = new Map();
const productsByEstilo = new Map();
function remember(map, key, product) {
  if (!map.has(key)) map.set(key, []);
  if (!map.get(key).some(row => row.id === product.id)) map.get(key).push(product);
}
for (const product of products) {
  for (const estilo of estiloKeys(product.estilo)) {
    remember(productsByEstilo, estilo, product);
    for (const color of colorKeys(product.color)) remember(productsByLookup, `${estilo}|${color}`, product);
  }
}
const variantsByProduct = new Map();
for (const variant of orgVariants) {
  if (!variantsByProduct.has(variant.product_id)) variantsByProduct.set(variant.product_id, []);
  variantsByProduct.get(variant.product_id).push(variant);
}
const levelsByVariant = new Map(levels.map(level => [`${level.branch_id}|${level.variant_id}`, Number(level.quantity || 0)]));
const registryByLookup = new Map(registry.map(row => [normalize(row.lookup_key), row]));
const registryByCompact = new Map();
for (const row of registry) {
  const compact = compactKey(row.estilo || String(row.lookup_key).split('|')[0], row.color || String(row.lookup_key).split('|')[1]);
  if (!registryByCompact.has(compact)) registryByCompact.set(compact, row);
}

function stockFor(productId) {
  const result = {};
  for (const variant of variantsByProduct.get(productId) || []) {
    const quantity = levelsByVariant.get(`${juarez.id}|${variant.id}`) || 0;
    if (quantity > 0) result[sizeKey(variant.size)] = quantity;
  }
  return result;
}
function scoreProduct(product) {
  return (
    (product.activo === false ? 0 : 500) +
    (Number(product.precio) > 0 ? 1000 : 0) +
    (String(product.imagen || '').trim() ? 400 : 0) +
    (product.source_system === 'saz_registered' ? 220 : 0) +
    (String(product.estado || '') === LOADED_STATUS ? 80 : 0) +
    (/^0+\d/.test(String(product.estilo || '')) ? 80 : 0)
  );
}
function pickCanonical(list) {
  if (!list.length) return null;
  const active = list.filter(product => product.activo !== false);
  return [...(active.length ? active : list)].sort((left, right) => scoreProduct(right) - scoreProduct(left))[0];
}

function matchProduct(row) {
  const unique = new Map();
  for (const estilo of estiloKeys(row.estilo_raw)) {
    for (const color of colorKeys(row.color_raw || row.color)) {
      for (const product of productsByLookup.get(`${estilo}|${color}`) || []) unique.set(product.id, product);
    }
  }
  const exact = pickCanonical([...unique.values()]);
  if (exact) return exact;
  const estiloGroup = new Map();
  for (const estilo of estiloKeys(row.estilo_raw)) {
    for (const product of productsByEstilo.get(estilo) || []) estiloGroup.set(product.id, product);
  }
  const compatible = [...estiloGroup.values()].filter(product => colorsCompatible(row.color_raw || row.color, product.color));
  return pickCanonical(compatible.length === 1 ? compatible : []);
}

function richness(row) {
  return TEXT_FIELDS.filter(field => text(row[field])).length + (row.precio > 0 ? 3 : 0) + (row.costo > 0 ? 1 : 0) + (row.hasSizeCells ? 1 : 0);
}

function combineExcel(rows) {
  const sorted = [...rows].sort((left, right) => richness(right) - richness(left) || left.source_row - right.source_row);
  const base = {
    ...sorted[0],
    source_rows: rows.flatMap(row => row.source_rows || [row.source_row]),
    qtyBySize: {},
    pairs: 0,
    declared: 0,
    saz_registered: rows.some(row => row.saz_registered),
    hasSizeCells: rows.some(row => row.hasSizeCells),
  };
  for (const row of rows) {
    for (const [size, quantity] of Object.entries(row.qtyBySize)) base.qtyBySize[size] = Math.max(base.qtyBySize[size] || 0, quantity);
  }
  base.pairs = Object.values(base.qtyBySize).reduce((sum, quantity) => sum + quantity, 0);
  base.declared = Math.max(base.pairs, ...rows.map(row => Number(row.declared || 0)));
  for (const row of sorted.slice(1)) {
    if (!(base.precio > 0) && row.precio > 0) base.precio = row.precio;
    if (!(base.costo > 0) && row.costo > 0) base.costo = row.costo;
    if (base.status == null && row.status != null) base.status = row.status;
    for (const field of TEXT_FIELDS) if (!text(base[field]) && text(row[field])) base[field] = row[field];
  }
  return base;
}

const creates = [];
const fieldUpdates = [];
const stockAdds = [];
const keptHigherStock = [];
const skippedEmpty = [];
const sazMarks = [];
const alreadySaz = [];
const matchedExisting = [];
const matchedByProduct = new Map();
const unmatched = [];
for (const row of excelProducts) {
  const product = matchProduct(row);
  if (!product) {
    unmatched.push(row);
    continue;
  }
  if (!matchedByProduct.has(product.id)) matchedByProduct.set(product.id, { product, rows: [] });
  matchedByProduct.get(product.id).rows.push(row);
}

for (const row of unmatched) {
  creates.push(row);
  for (const [size, quantity] of Object.entries(row.qtyBySize)) {
    if (quantity <= 0) continue;
    const importKey = `${IMPORT_PREFIX}:${compactKey(row.estilo_raw, row.color)}:${size}`;
    if (appliedKeys.has(importKey)) continue;
    stockAdds.push({ row, product: null, size, quantity, current: 0, next: quantity, importKey });
  }
}

for (const { product, rows } of matchedByProduct.values()) {
  const row = combineExcel(rows);
  matchedExisting.push({
    excel_estilo: row.estilo_raw, catalog_estilo: product.estilo, color: row.color, product_id: product.id,
    catalog_precio: Number(product.precio), excel_precio: row.precio, saz_registered: row.saz_registered,
  });
  const patch = {};
  if (row.precio > 0 && Number(product.precio) !== row.precio) patch.precio = row.precio;
  if (row.costo > 0 && Number(product.costo) !== row.costo) patch.costo = row.costo;
  if (row.status != null && Number(product.status) !== row.status) patch.status = row.status;
  for (const field of TEXT_FIELDS) {
    if (text(row[field]) && !sameText(product[field], row[field])) patch[field] = row[field];
  }
  if (padEstilo(row.estilo) !== padEstilo(product.estilo) && /^0+\d/.test(row.estilo) && compactEstilo(row.estilo) === compactEstilo(product.estilo)) {
    patch.estilo = row.estilo;
  } else if (/^\d+$/.test(hyphenlessEstilo(row.estilo_raw)) && padEstilo(row.estilo_raw) !== String(product.estilo || '').trim()) {
    if (hyphenlessEstilo(row.estilo_raw) === hyphenlessEstilo(product.estilo)) patch.estilo = padEstilo(row.estilo_raw);
  }
  if (normalize(product.color) !== normalize(row.color) && text(row.color)) {
    const compatible = SazCatalog.matches('color', product.color, row.color) || colorsCompatible(product.color, row.color);
    if (!compatible) patch.color = row.color;
    else if (colorTokens(row.color).length > colorTokens(product.color).length) patch.color = row.color;
  }
  if (product.activo === false) patch.activo = true;
  if (patch.estilo || patch.color || patch.marca) {
    patch.match_key = [patch.estilo || product.estilo, patch.color || product.color, patch.marca || product.marca].map(normalize).join('|');
  }
  if (Object.keys(patch).length) fieldUpdates.push({ product, patch, estilo: row.estilo_raw, color: row.color, source_rows: row.source_rows });
  else skippedEmpty.push({ estilo: row.estilo_raw, color: row.color, reason: 'ficha ya igual o Excel vacío' });

  const currentStock = stockFor(product.id);
  for (const [size, quantity] of Object.entries(row.qtyBySize)) {
    if (quantity <= 0) continue;
    const current = currentStock[size] || 0;
    if (current > quantity) {
      keptHigherStock.push({ estilo: row.estilo_raw, color: row.color, size, current, excel: quantity });
      continue;
    }
    const add = quantity - current;
    if (add <= 0) continue;
    const importKey = `${IMPORT_PREFIX}:${product.id}:${size}`;
    if (appliedKeys.has(importKey)) continue;
    stockAdds.push({ row, product, size, quantity: add, current, next: current + add, importKey });
  }

  if (row.saz_registered) {
    const exactKey = lookupKey(patch.estilo || product.estilo, patch.color || product.color);
    const registered = registryByLookup.get(normalize(exactKey)) || registryByCompact.get(compactKey(product.estilo, product.color));
    if (registered && registered.product_id === product.id && String(product.estado || '') === LOADED_STATUS) {
      alreadySaz.push({ estilo: row.estilo_raw, color: row.color, product_id: product.id });
    } else {
      sazMarks.push({ product, exactKey, registered, estilo: padEstilo(patch.estilo || product.estilo), color: normalize(patch.color || product.color), needsStatus: String(product.estado || '') !== LOADED_STATUS });
    }
  }
}

const catalogPairs = levels.filter(level => level.branch_id === juarez.id).reduce((sum, level) => sum + Number(level.quantity || 0), 0);
const addPairs = stockAdds.reduce((sum, row) => sum + row.quantity, 0);
const priceUpdates = fieldUpdates.filter(row => row.patch.precio != null);
const report = {
  generated_at: new Date().toISOString(),
  mode: apply ? 'APPLY' : 'DRY_RUN',
  file: path.basename(excelPath),
  saz_through_row: SAZ_THROUGH_ROW,
  excel: {
    rows: excelRows.length,
    products: excelProducts.length,
    pairs: excelProducts.reduce((sum, row) => sum + row.pairs, 0),
    with_price: excelProducts.filter(row => row.precio > 0).length,
    without_price: excelProducts.filter(row => !(row.precio > 0)).length,
    saz_rows: excelProducts.filter(row => row.saz_registered).length,
    pending_saz: excelProducts.filter(row => !row.saz_registered).length,
    empty_size_products: excelProducts.filter(row => !row.hasSizeCells).length,
    total_mismatches: totalMismatches,
  },
  plan: {
    create_products: creates.length,
    update_fichas: fieldUpdates.length,
    price_updates: priceUpdates.length,
    add_stock_sizes: stockAdds.length,
    add_pairs: addPairs,
    kept_higher_juarez: keptHigherStock.length,
    mark_saz: sazMarks.length,
    already_saz: alreadySaz.length,
    will_not: [
      'Celdas vacías del Excel no pisan ficha ni stock.',
      'No se pisa imagen.',
      'No se baja stock de JUÁREZ.',
      'No se toca inventory_items.',
      `Solo filas 2–${SAZ_THROUGH_ROW} se marcan CARGADO EN SAZ.`,
    ],
  },
  juarez_pairs_now: catalogPairs,
  juarez_pairs_after: catalogPairs + addPairs,
  creates: creates.map(row => ({ estilo: row.estilo, color: row.color, marca: row.marca, precio: row.precio, pairs: row.pairs, saz: row.saz_registered, rows: row.source_rows })),
  field_updates_sample: fieldUpdates.slice(0, 12).map(row => ({ estilo: row.estilo, color: row.color, patch: row.patch })),
  price_updates_sample: priceUpdates.slice(0, 15).map(row => ({ estilo: row.estilo, color: row.color, from: Number(row.product.precio), to: row.patch.precio })),
  kept_higher_stock_sample: keptHigherStock.slice(0, 8),
  missing_saz_sample: creates.filter(row => row.saz_registered).slice(0, 8),
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify({
  ...report,
  field_updates: fieldUpdates.map(row => ({ id: row.product.id, estilo: row.estilo, color: row.color, patch: row.patch })),
  matched_existing: matchedExisting,
  stock_adds: stockAdds.map(row => ({ estilo: row.row.estilo_raw, color: row.row.color, size: row.size, add: row.quantity, from: row.current, to: row.next })),
  saz_marks: sazMarks.map(row => ({ id: row.product.id, lookup_key: row.exactKey, needsStatus: row.needsStatus })),
}, null, 2));
console.log(JSON.stringify({
  output: outputPath, mode: report.mode, excel: report.excel, plan: report.plan,
  juarez_pairs_now: catalogPairs, juarez_pairs_after: catalogPairs + addPairs,
  creates: report.creates.slice(0, 20), creates_total: creates.length,
  field_updates_sample: report.field_updates_sample,
  price_updates_sample: report.price_updates_sample,
  kept_higher_stock_sample: report.kept_higher_stock_sample,
}, null, 2));
if (!apply) {
  console.log('\nSimulación lista. Usa --apply para escribir en Supabase: ficha con dato, stock solo al alza, SAZ hasta fila 194.');
  process.exit(0);
}

const created = [];
const createPayload = creates.map(row => ({
  organization_id: organization.id,
  source_system: SOURCE_SYSTEM,
  source_id: compactKey(row.estilo, row.color),
  match_key: [row.estilo, row.color, row.marca].map(normalize).join('|'),
  estilo: row.estilo,
  color: row.color,
  precio: row.precio || 0,
  marca: row.marca || '',
  proveedor: row.proveedor || '',
  temporada: row.temporada || '',
  sublinea: row.sublinea || '',
  departamento: row.departamento || '',
  clasificacion: row.clasificacion || '',
  linea: row.linea || '',
  corrida: row.corrida || '',
  acabado: row.acabado || '',
  suela: row.suela || '',
  plantilla: row.plantilla || '',
  tacon: row.tacon || '',
  forro: row.forro || '',
  catalogo: row.catalogo || '',
  status: row.status || 1,
  observaciones: row.observaciones || '',
  costo: row.costo || 0,
  activo: true,
  imagen: '',
  estado: row.saz_registered ? LOADED_STATUS : '',
}));
for (const group of chunks(createPayload, 80)) {
  if (!group.length) continue;
  const saved = await rest('products?on_conflict=organization_id%2Csource_system%2Csource_id', {
    method: 'POST',
    body: group,
    prefer: 'resolution=merge-duplicates,return=representation',
  });
  for (const product of saved) {
    const createRow = creates.find(row => compactKey(row.estilo, row.color) === compactKey(product.estilo, product.color));
    if (createRow) createRow.product_id = product.id;
    created.push({ id: product.id, estilo: product.estilo, color: product.color, precio: Number(product.precio), saz: createRow?.saz_registered });
  }
}

await mapPool(fieldUpdates, 12, async row => {
  await rest(`products?id=eq.${row.product.id}&organization_id=eq.${organization.id}`, { method: 'PATCH', body: row.patch, prefer: 'return=minimal' });
});

const stockPlan = stockAdds.map(item => {
  const productId = item.product?.id || item.row.product_id;
  if (!productId) throw new Error(`Sin producto para ${item.row.estilo_raw} ${item.row.color} talla ${item.size}`);
  return { ...item, productId };
});
const variantPayload = [...new Map(stockPlan.map(item => [`${item.productId}|${item.size}`, { product_id: item.productId, size: String(item.size) }])).values()];
const variantIds = new Map();
for (const group of chunks(variantPayload, 80)) {
  if (!group.length) continue;
  const saved = await rest('product_variants?on_conflict=product_id%2Csize', {
    method: 'POST',
    body: group,
    prefer: 'resolution=merge-duplicates,return=representation',
  });
  for (const variant of saved) variantIds.set(`${variant.product_id}|${variant.size}`, variant.id);
}

const currentByVariant = new Map();
const variantIdList = [...new Set(stockPlan.map(item => variantIds.get(`${item.productId}|${item.size}`)).filter(Boolean))];
for (const group of chunks(variantIdList, 200)) {
  if (!group.length) continue;
  const rows = await rest(`inventory_levels?select=variant_id,quantity&branch_id=eq.${juarez.id}&variant_id=in.(${group.join(',')})`);
  for (const row of rows) currentByVariant.set(row.variant_id, Number(row.quantity || 0));
}

const levelsPayload = [];
const movementPayload = [];
const appliedStock = [];
for (const item of stockPlan) {
  const variantId = variantIds.get(`${item.productId}|${item.size}`);
  if (!variantId) throw new Error(`Sin talla ${item.size} para ${item.row.estilo_raw} ${item.row.color}`);
  const current = currentByVariant.get(variantId) || 0;
  const add = Math.max(0, (item.current + item.quantity) - current);
  const next = current + add;
  if (add <= 0) continue;
  levelsPayload.push({ branch_id: juarez.id, variant_id: variantId, quantity: next, updated_by: userId });
  movementPayload.push({
    organization_id: organization.id,
    branch_id: juarez.id,
    variant_id: variantId,
    operation: 'add',
    previous_quantity: current,
    quantity: add,
    new_quantity: next,
    reason: `Actualización inventario Excel · ${item.row.estilo_raw} ${item.row.color}`,
    import_key: item.importKey,
    created_by: userId,
  });
  appliedStock.push({ product_id: item.productId, estilo: item.row.estilo_raw, color: item.row.color, size: item.size, added: add, from: current, to: next });
}

for (const group of chunks(levelsPayload, 80)) {
  if (!group.length) continue;
  await rest('inventory_levels?on_conflict=branch_id%2Cvariant_id', { method: 'POST', body: group, prefer: 'resolution=merge-duplicates,return=minimal' });
}
for (const group of chunks(movementPayload, 80)) {
  if (!group.length) continue;
  await rest('inventory_movements_relational?on_conflict=import_key', { method: 'POST', body: group, prefer: 'resolution=merge-duplicates,return=minimal' });
}

const now = new Date().toISOString();
const sazProducts = [
  ...sazMarks.map(row => ({
    organization_id: organization.id,
    product_id: row.product.id,
    lookup_key: row.exactKey,
    estilo: row.estilo,
    color: row.color,
    source_files: [path.basename(excelPath)],
    last_registered_at: now,
  })),
  ...creates.filter(row => row.saz_registered && row.product_id).map(row => ({
    organization_id: organization.id,
    product_id: row.product_id,
    lookup_key: lookupKey(row.estilo, row.color),
    estilo: row.estilo,
    color: normalize(row.color),
    source_files: [path.basename(excelPath)],
    last_registered_at: now,
  })),
];
const statusIds = [...new Set([
  ...sazMarks.filter(row => row.needsStatus).map(row => row.product.id),
  ...creates.filter(row => row.saz_registered && row.product_id).map(row => row.product_id),
])];
for (const group of chunks(statusIds, 80)) {
  if (!group.length) continue;
  await rest(`products?id=in.(${group.join(',')})&organization_id=eq.${organization.id}`, {
    method: 'PATCH',
    body: { estado: LOADED_STATUS },
    prefer: 'return=minimal',
  });
}
for (const group of chunks(sazProducts, 80)) {
  if (!group.length) continue;
  await rest('saz_product_registry?on_conflict=organization_id%2Clookup_key', {
    method: 'POST',
    body: group,
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
}

await rest('inventory_migration_runs', {
  method: 'POST',
  body: {
    organization_id: organization.id,
    branch_id: juarez.id,
    source_summary: {
      file: path.basename(excelPath),
      mode: 'fill_nonempty_raise_stock_saz_through_194',
      created: created.length,
      field_updates: fieldUpdates.length,
      stock_adds: appliedStock.length,
      saz_marks: sazProducts.length,
    },
    product_count: created.length,
    variant_count: appliedStock.length,
    pair_count: appliedStock.reduce((sum, row) => sum + row.added, 0),
    created_by: userId,
  },
  prefer: 'return=minimal',
});

console.log(JSON.stringify({
  completed: true,
  created: created.length,
  field_updates: fieldUpdates.length,
  price_updates: priceUpdates.length,
  stock_sizes: appliedStock.length,
  pairs_added: appliedStock.reduce((sum, row) => sum + row.added, 0),
  kept_higher_juarez: keptHigherStock.length,
  saz_marked: sazProducts.length,
  preserved: 'Vacío no pisa. Sin imagen. Sin bajar JUÁREZ. SAZ solo hasta fila 194.',
}, null, 2));
