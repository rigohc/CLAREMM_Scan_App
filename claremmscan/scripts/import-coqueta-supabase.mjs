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

function findExcel(cliPath) {
  if (cliPath) return path.resolve(cliPath);
  const dir = '/Users/laclavees12345/Downloads';
  const match = fs.readdirSync(dir).find(name => name.startsWith('COQUETA CLAREMM') && name.endsWith('.xlsx') && !name.startsWith('~$'));
  if (!match) throw new Error('No se encontró el Excel COQUETA CLAREMM en Descargas.');
  return path.join(dir, match);
}

const cli = argsFrom(process.argv.slice(2));
const apply = cli.apply === true;
const SOURCE_SYSTEM = 'excel_coqueta';
const IMPORT_PREFIX = 'coqueta-20261116';
const excelPath = findExcel(cli.xlsx);
const outputPath = path.resolve(cli.output || path.join(workspaceDir, 'entregables/coqueta-supabase.json'));
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
const lookupKey = (estilo, color) => `${normalize(estilo)}|${normalize(color)}`;
const compactKey = (estilo, color) => `${compactEstilo(estilo)}|${normalize(color)}`;
const sizeKey = value => {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed.toFixed(1) : text(value);
};
const chunks = (values, size = 150) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));

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

const memberships = await rest(`organization_members?select=organization_id&user_id=eq.${encodeURIComponent(userId)}`);
const organizationIds = memberships.map(row => row.organization_id);
const organizations = await rest(`organizations?select=id,name&id=in.(${organizationIds.join(',')})`);
const organization = organizations.find(row => normalize(row.name) === 'CLAREMM');
if (!organization) throw new Error('No se encontró la organización CLAREMM.');
const branches = await allRows(`branches?select=id,code,name,active&organization_id=eq.${organization.id}`);
const juarez = branches.find(row => row.code === 'JUAREZ') || branches[0];
if (!juarez) throw new Error('No se encontró sucursal JUAREZ.');

const [products, variants, registry, priorMovements] = await Promise.all([
  allRows(`products?select=id,estilo,color,marca,proveedor,temporada,sublinea,departamento,clasificacion,linea,corrida,acabado,suela,plantilla,tacon,forro,catalogo,status,observaciones,costo,precio,imagen,source_system,source_id,activo&organization_id=eq.${organization.id}`),
  allRows('product_variants?select=id,product_id,size'),
  allRows(`saz_product_registry?select=id,product_id,lookup_key,estilo,color&organization_id=eq.${organization.id}`),
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
  sizes.push(header.toFixed(1));
}

const excelRows = [];
const totalMismatches = [];
for (let index = 1; index < matrix.length; index++) {
  const row = matrix[index];
  const estilo = estiloText(row[0]);
  const color = normalize(row[1]);
  if (!estilo && !color) continue;
  if (!estilo || !color) throw new Error(`Fila ${index + 1} sin estilo o color.`);
  const qtyBySize = {};
  let calculated = 0;
  sizes.forEach((size, sizeIndex) => {
    const quantity = Math.trunc(number(row[20 + sizeIndex]));
    if (quantity <= 0) return;
    calculated += quantity;
    qtyBySize[size] = (qtyBySize[size] || 0) + quantity;
  });
  const declared = Math.trunc(number(row[totalIndex]));
  if (calculated !== declared) totalMismatches.push({ row: index + 1, estilo, color, calculated, declared });
  excelRows.push({
    source_row: index + 1,
    estilo_raw: estilo,
    color,
    precio: number(row[2]),
    marca: normalize(row[3]),
    proveedor: normalize(row[4]),
    temporada: text(row[5]),
    sublinea: normalize(row[6]),
    departamento: normalize(row[7]),
    clasificacion: normalize(row[8]),
    linea: normalize(row[9]),
    corrida: text(row[10]),
    acabado: normalize(row[11]),
    suela: normalize(row[12]),
    plantilla: normalize(row[13]),
    tacon: normalize(row[14]),
    forro: normalize(row[15]),
    catalogo: normalize(row[16]),
    status: Math.trunc(number(row[17]) || 1),
    observaciones: text(row[18]),
    costo: number(row[19]),
    qtyBySize,
    pairs: calculated,
    declared,
  });
}

function mergeRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = lookupKey(row.estilo_raw, row.color);
    if (!map.has(key)) {
      map.set(key, { ...row, source_rows: [row.source_row], qtyBySize: { ...row.qtyBySize } });
      continue;
    }
    const current = map.get(key);
    current.source_rows.push(row.source_row);
    current.pairs += row.pairs;
    current.declared += row.declared;
    for (const [size, quantity] of Object.entries(row.qtyBySize)) current.qtyBySize[size] = (current.qtyBySize[size] || 0) + quantity;
    if (!current.precio && row.precio) current.precio = row.precio;
    for (const field of ['marca', 'proveedor', 'temporada', 'sublinea', 'departamento', 'clasificacion', 'linea', 'corrida', 'acabado']) {
      if (!current[field] && row[field]) current[field] = row[field];
    }
  }
  return [...map.values()];
}

const excelProducts = mergeRows(excelRows);
const stylePrices = new Map();
for (const row of excelProducts) {
  if (!(row.precio > 0)) continue;
  const key = compactEstilo(row.estilo_raw);
  if (!stylePrices.has(key)) stylePrices.set(key, new Set());
  stylePrices.get(key).add(row.precio);
}
for (const row of excelProducts) {
  if (row.precio > 0) continue;
  const prices = [...(stylePrices.get(compactEstilo(row.estilo_raw)) || [])];
  if (prices.length === 1) row.precio = prices[0];
}

const productsByExact = new Map();
const productsByCompact = new Map();
for (const product of products) {
  const exact = lookupKey(product.estilo, product.color);
  const compact = compactKey(product.estilo, product.color);
  if (!productsByExact.has(exact)) productsByExact.set(exact, []);
  productsByExact.get(exact).push(product);
  if (!productsByCompact.has(compact)) productsByCompact.set(compact, []);
  productsByCompact.get(compact).push(product);
}
const variantsByProduct = new Map();
for (const variant of orgVariants) {
  if (!variantsByProduct.has(variant.product_id)) variantsByProduct.set(variant.product_id, []);
  variantsByProduct.get(variant.product_id).push(variant);
}
const levelsByVariant = new Map(levels.map(level => [`${level.branch_id}|${level.variant_id}`, Number(level.quantity || 0)]));
const productsById = new Map(products.map(product => [product.id, product]));
const groupStock = new Map();
for (const variant of orgVariants) {
  const product = productsById.get(variant.product_id);
  if (!product) continue;
  const quantity = levelsByVariant.get(`${juarez.id}|${variant.id}`) || 0;
  if (quantity <= 0) continue;
  const key = `${compactKey(product.estilo, product.color)}|${sizeKey(variant.size)}`;
  groupStock.set(key, (groupStock.get(key) || 0) + quantity);
}
function stockFor(productId) {
  const result = {};
  for (const variant of variantsByProduct.get(productId) || []) {
    const quantity = levelsByVariant.get(`${juarez.id}|${variant.id}`) || 0;
    if (quantity > 0) result[sizeKey(variant.size)] = quantity;
  }
  return result;
}
function groupQty(estilo, color, size) {
  return groupStock.get(`${compactKey(estilo, color)}|${sizeKey(size)}`) || 0;
}

function scoreProduct(product) {
  return (
    (product.activo === false ? 0 : 500) +
    (Number(product.precio) > 0 ? 1000 : 0) +
    (String(product.imagen || '').trim() ? 400 : 0) +
    (product.source_system === 'saz_registered' ? 220 : 0) +
    (/^0+\d/.test(String(product.estilo || '')) ? 80 : 0)
  );
}

function matchProduct(row) {
  const exact = productsByExact.get(lookupKey(row.estilo_raw, row.color)) || [];
  const compact = productsByCompact.get(compactKey(row.estilo_raw, row.color)) || [];
  const unique = [...new Map([...exact, ...compact].map(product => [product.id, product])).values()];
  if (!unique.length) return null;
  const active = unique.filter(product => product.activo !== false);
  const pool = active.length ? active : unique;
  return [...pool].sort((left, right) => scoreProduct(right) - scoreProduct(left))[0];
}

const creates = [];
const stockAdds = [];
const priceFills = [];
const fieldFills = [];
const skippedNoPrice = [];
const alreadyApplied = [];
const alreadyCovered = [];
const matchedExisting = [];

function queueStock(row, product, size, excelQty, create) {
  const importKey = `${IMPORT_PREFIX}:${compactKey(row.estilo_raw, row.color)}:${sizeKey(size)}`;
  if (appliedKeys.has(importKey)) {
    alreadyApplied.push({ estilo: row.estilo_raw, color: row.color, size, quantity: excelQty, importKey, product_id: product?.id });
    return;
  }
  const current = groupQty(row.estilo_raw, row.color, size);
  const addQty = Math.max(0, excelQty - current);
  if (!addQty) {
    alreadyCovered.push({ estilo: row.estilo_raw, color: row.color, size, excelQty, current });
    return;
  }
  groupStock.set(`${compactKey(row.estilo_raw, row.color)}|${sizeKey(size)}`, current + addQty);
  stockAdds.push({
    row, product, size: sizeKey(size), quantity: addQty, excelQty, current,
    next: current + addQty, importKey, create,
  });
}

for (const row of excelProducts) {
  const product = matchProduct(row);
  const importSizes = Object.entries(row.qtyBySize).filter(([, quantity]) => quantity > 0);
  if (!product) {
    if (!(row.precio > 0)) skippedNoPrice.push({ estilo: row.estilo_raw, color: row.color, marca: row.marca, pairs: row.pairs });
    creates.push(row);
    for (const [size, quantity] of importSizes) queueStock(row, null, size, quantity, true);
    continue;
  }
  matchedExisting.push({
    excel_estilo: row.estilo_raw, catalog_estilo: product.estilo, color: row.color, product_id: product.id,
    catalog_precio: Number(product.precio), excel_precio: row.precio, has_image: Boolean(String(product.imagen || '').trim()),
    source_system: product.source_system, current_pairs: Object.values(stockFor(product.id)).reduce((sum, quantity) => sum + quantity, 0),
    group_pairs: [...groupStock].filter(([key]) => key.startsWith(`${compactKey(row.estilo_raw, row.color)}|`)).reduce((sum, [, qty]) => sum + qty, 0),
    excel_pairs: row.pairs, activo: product.activo !== false,
  });
  if (!(Number(product.precio) > 0) && row.precio > 0) priceFills.push({ product, precio: row.precio, estilo: row.estilo_raw, color: row.color });
  const emptyFields = {};
  for (const field of ['marca', 'proveedor', 'temporada', 'sublinea', 'departamento', 'clasificacion', 'linea', 'corrida', 'acabado', 'suela', 'plantilla', 'tacon', 'forro', 'catalogo', 'observaciones']) {
    if (!text(product[field]) && text(row[field])) emptyFields[field] = row[field];
  }
  if (!(Number(product.costo) > 0) && row.costo > 0) emptyFields.costo = row.costo;
  if (product.activo === false) emptyFields.activo = true;
  if (Object.keys(emptyFields).length) fieldFills.push({ product, fields: emptyFields, estilo: row.estilo_raw, color: row.color });
  for (const [size, quantity] of importSizes) queueStock(row, product, size, quantity, false);
}

const catalogPairs = levels.filter(level => level.branch_id === juarez.id).reduce((sum, level) => sum + Number(level.quantity || 0), 0);
const addPairs = stockAdds.reduce((sum, row) => sum + row.quantity, 0);
const report = {
  generated_at: new Date().toISOString(),
  mode: apply ? 'APPLY' : 'DRY_RUN',
  file: path.basename(excelPath),
  organization: { id: organization.id, name: organization.name },
  branch: { id: juarez.id, code: juarez.code, name: juarez.name },
  excel: {
    rows: excelRows.length,
    products: excelProducts.length,
    pairs: excelProducts.reduce((sum, row) => sum + row.pairs, 0),
    with_price: excelProducts.filter(row => row.precio > 0).length,
    without_price: excelProducts.filter(row => !(row.precio > 0)).length,
    brands: Object.fromEntries([...excelProducts.reduce((map, row) => map.set(row.marca || 'SIN MARCA', (map.get(row.marca || 'SIN MARCA') || 0) + 1), new Map())]),
    total_mismatches: totalMismatches,
  },
  plan: {
    create_products: creates.length,
    create_pairs: creates.reduce((sum, row) => sum + row.pairs, 0),
    match_existing: matchedExisting.length,
    fill_missing_prices: priceFills.length,
    fill_empty_fields: fieldFills.length,
    add_stock_sizes: stockAdds.length,
    add_pairs: addPairs,
    skipped_no_price: skippedNoPrice.length,
    already_applied_sizes: alreadyApplied.length,
    already_covered_sizes: alreadyCovered.length,
    will_not: [
      'No se registra en SAZ.',
      'No se pisa precio > 0 ni imagen.',
      'No se baja stock: solo se suman pares del Excel.',
      'Este Excel crea fichas aunque no tengan precio.',
      'No se registra en saz_product_registry: queda pendiente de SAZ.',
      'No se toca inventory_items.',
    ],
  },
  juarez_pairs_now: catalogPairs,
  juarez_pairs_after: catalogPairs + addPairs,
  creates: creates.map(row => ({ estilo: row.estilo_raw, color: row.color, marca: row.marca, linea: row.linea, precio: row.precio, pairs: row.pairs, sizes: row.qtyBySize })),
  matched_existing: matchedExisting,
  price_fills: priceFills.map(row => ({ product_id: row.product.id, estilo: row.estilo, color: row.color, precio: row.precio })),
  skipped_no_price: skippedNoPrice,
  already_applied: alreadyApplied,
  already_covered: alreadyCovered,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output: outputPath, mode: report.mode, excel: report.excel, plan: report.plan, juarez_pairs_now: catalogPairs, juarez_pairs_after: catalogPairs + addPairs }, null, 2));

if (!apply) {
  console.log('\nSimulación lista. No se escribió en Supabase. Usa --apply para cargar a JUAREZ sin marcar SAZ.');
  process.exit(0);
}

const created = [];
const createPayload = creates.map(row => ({
  organization_id: organization.id,
  source_system: SOURCE_SYSTEM,
  source_id: lookupKey(row.estilo_raw, row.color),
  match_key: [row.estilo_raw, row.color, row.marca].map(normalize).join('|'),
  estilo: normalize(row.estilo_raw),
  color: row.color,
  precio: row.precio,
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
}));
for (const group of chunks(createPayload, 80)) {
  const saved = await rest('products?on_conflict=organization_id%2Csource_system%2Csource_id', {
    method: 'POST',
    body: group,
    prefer: 'resolution=merge-duplicates,return=representation',
  });
  for (const product of saved) {
    const createRow = creates.find(row => lookupKey(row.estilo_raw, row.color) === lookupKey(product.estilo, product.color));
    if (createRow) createRow.product_id = product.id;
    created.push({ id: product.id, estilo: product.estilo, color: product.color, precio: Number(product.precio) });
  }
  console.log(`Productos nuevos: ${created.length}/${creates.length}`);
}

for (const row of priceFills) {
  await rest(`products?id=eq.${row.product.id}`, { method: 'PATCH', body: { precio: row.precio }, prefer: 'return=minimal' });
}
for (const row of fieldFills) {
  await rest(`products?id=eq.${row.product.id}`, { method: 'PATCH', body: row.fields, prefer: 'return=minimal' });
}

const stockPlan = stockAdds.map(item => {
  const productId = item.product?.id || item.row.product_id;
  if (!productId) throw new Error(`Sin producto para ${item.row.estilo_raw} ${item.row.color} talla ${item.size}`);
  return { ...item, productId };
});
const variantPayload = [...new Map(stockPlan.map(item => [`${item.productId}|${item.size}`, { product_id: item.productId, size: String(item.size) }])).values()];
const variantIds = new Map();
let variantCount = 0;
for (const group of chunks(variantPayload, 80)) {
  const saved = await rest('product_variants?on_conflict=product_id%2Csize', {
    method: 'POST',
    body: group,
    prefer: 'resolution=merge-duplicates,return=representation',
  });
  for (const variant of saved) variantIds.set(`${variant.product_id}|${variant.size}`, variant.id);
  variantCount += group.length;
  console.log(`Tallas: ${variantCount}/${variantPayload.length}`);
}

const currentByVariant = new Map();
const variantIdList = [...new Set(stockPlan.map(item => variantIds.get(`${item.productId}|${item.size}`)).filter(Boolean))];
for (const group of chunks(variantIdList, 200)) {
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
  const next = current + item.quantity;
  levelsPayload.push({ branch_id: juarez.id, variant_id: variantId, quantity: next, updated_by: userId });
  movementPayload.push({
    organization_id: organization.id,
    branch_id: juarez.id,
    variant_id: variantId,
    operation: 'add',
    previous_quantity: current,
    quantity: item.quantity,
    new_quantity: next,
    reason: `Carga COQUETA 16/11/26 · pendiente de SAZ · ${item.row.estilo_raw} ${item.row.color}`,
    import_key: item.importKey,
    created_by: userId,
  });
  appliedStock.push({ product_id: item.productId, estilo: item.row.estilo_raw, color: item.row.color, size: item.size, added: item.quantity, from: current, to: next });
}

let levelCount = 0;
for (const group of chunks(levelsPayload, 80)) {
  await rest('inventory_levels?on_conflict=branch_id%2Cvariant_id', {
    method: 'POST', body: group, prefer: 'resolution=merge-duplicates,return=minimal',
  });
  levelCount += group.length;
  console.log(`Existencias: ${levelCount}/${levelsPayload.length}`);
}
let movementCount = 0;
for (const group of chunks(movementPayload, 80)) {
  await rest('inventory_movements_relational?on_conflict=import_key', {
    method: 'POST', body: group, prefer: 'resolution=merge-duplicates,return=minimal',
  });
  movementCount += group.length;
  console.log(`Movimientos: ${movementCount}/${movementPayload.length}`);
}

await rest('inventory_migration_runs', {
  method: 'POST',
  body: {
    organization_id: organization.id,
    branch_id: juarez.id,
    source_summary: {
      file: path.basename(excelPath),
      mode: 'add_stock_create_not_saz',
      pending_saz: true,
      created: created.length,
      price_fills: priceFills.length,
      stock_adds: appliedStock.length,
      skipped_no_price: skippedNoPrice.length,
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
  price_fills: priceFills.length,
  field_fills: fieldFills.length,
  stock_sizes: appliedStock.length,
  pairs_added: appliedStock.reduce((sum, row) => sum + row.added, 0),
  skipped_no_price: skippedNoPrice,
  preserved: 'Sin marcar SAZ, sin pisar precio/imagen, sin bajar stock.',
}, null, 2));
