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

const cli = argsFrom(process.argv.slice(2));
const apply = cli.apply === true;
const SOURCE_SYSTEM = 'excel_mirlo_wildcat';
const IMPORT_PREFIX = 'mirlo-wildcat-20261122-corregido';
const excelPath = path.resolve(cli.xlsx || '/Users/laclavees12345/Downloads/MIRLO Y WILDCAT 16_11_26 CORREGIDO POR SUBIR A SAZ.xlsx');
const outputPath = path.resolve(cli.output || path.join(workspaceDir, 'entregables/mirlo-wildcat-corregido-supabase.json'));
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
const chunks = (values, size = 80) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
const sameText = (left, right) => text(left) === text(right);
const TEXT_FIELDS = ['marca', 'proveedor', 'temporada', 'sublinea', 'departamento', 'clasificacion', 'linea', 'corrida', 'acabado', 'suela', 'plantilla', 'tacon', 'forro', 'catalogo', 'observaciones'];

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
const organizations = await rest(`organizations?select=id,name&id=in.(${memberships.map(row => row.organization_id).join(',')})`);
const organization = organizations.find(row => normalize(row.name) === 'CLAREMM');
if (!organization) throw new Error('No se encontró la organización CLAREMM.');
const branches = await allRows(`branches?select=id,code,name,active&organization_id=eq.${organization.id}`);
const juarez = branches.find(row => row.code === 'JUAREZ') || branches[0];
if (!juarez) throw new Error('No se encontró sucursal JUAREZ.');

const [products, variants, priorMovements] = await Promise.all([
  allRows(`products?select=id,estilo,color,marca,proveedor,temporada,sublinea,departamento,clasificacion,linea,corrida,acabado,suela,plantilla,tacon,forro,catalogo,status,observaciones,costo,precio,imagen,source_system,source_id,activo,match_key&organization_id=eq.${organization.id}`),
  allRows('product_variants?select=id,product_id,size'),
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
    proveedor: text(row[4]),
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
    if (row.precio > 0) current.precio = row.precio;
    if (row.costo > 0) current.costo = row.costo;
    for (const field of TEXT_FIELDS) if (row[field]) current[field] = row[field];
  }
  return [...map.values()];
}

const excelProducts = mergeRows(excelRows);
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
function stockFor(productId) {
  const result = {};
  for (const variant of variantsByProduct.get(productId) || []) {
    const quantity = levelsByVariant.get(`${juarez.id}|${variant.id}`) || 0;
    if (quantity > 0) result[String(variant.size)] = quantity;
  }
  return result;
}
function scoreProduct(product) {
  return (
    (product.activo === false ? 0 : 500) +
    (Number(product.precio) > 0 ? 1000 : 0) +
    (String(product.imagen || '').trim() ? 400 : 0) +
    (product.source_system === 'saz_registered' ? 220 : 0)
  );
}
function matchProduct(row) {
  const unique = [...new Map([...(productsByExact.get(lookupKey(row.estilo_raw, row.color)) || []), ...(productsByCompact.get(compactKey(row.estilo_raw, row.color)) || [])].map(product => [product.id, product])).values()];
  if (!unique.length) return null;
  const active = unique.filter(product => product.activo !== false);
  return [...(active.length ? active : unique)].sort((left, right) => scoreProduct(right) - scoreProduct(left))[0];
}

const creates = [];
const fieldUpdates = [];
const stockAdds = [];
const keptHigherStock = [];
const matchedExisting = [];

for (const row of excelProducts) {
  const product = matchProduct(row);
  if (!product) {
    creates.push(row);
    for (const [size, quantity] of Object.entries(row.qtyBySize)) {
      if (quantity <= 0) continue;
      const importKey = `${IMPORT_PREFIX}:${compactKey(row.estilo_raw, row.color)}:${size}`;
      if (appliedKeys.has(importKey)) continue;
      stockAdds.push({ row, product: null, size, quantity, current: 0, next: quantity, importKey });
    }
    continue;
  }
  matchedExisting.push({ excel_estilo: row.estilo_raw, catalog_estilo: product.estilo, color: row.color, product_id: product.id, catalog_precio: Number(product.precio), excel_precio: row.precio });
  const patch = {};
  if (row.precio > 0 && Number(product.precio) !== row.precio) patch.precio = row.precio;
  if (row.costo > 0 && Number(product.costo) !== row.costo) patch.costo = row.costo;
  if (Number(product.status) !== row.status) patch.status = row.status;
  for (const field of TEXT_FIELDS) {
    if (text(row[field]) && !sameText(product[field], row[field])) patch[field] = row[field];
  }
  if (normalize(product.color) !== row.color) patch.color = row.color;
  if (product.activo === false) patch.activo = true;
  if (patch.color || patch.marca) patch.match_key = [product.estilo, patch.color || product.color, patch.marca || product.marca].map(normalize).join('|');
  if (Object.keys(patch).length) fieldUpdates.push({ product, patch, estilo: row.estilo_raw, color: row.color });
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
}

const catalogPairs = levels.filter(level => level.branch_id === juarez.id).reduce((sum, level) => sum + Number(level.quantity || 0), 0);
const addPairs = stockAdds.reduce((sum, row) => sum + row.quantity, 0);
const report = {
  generated_at: new Date().toISOString(),
  mode: apply ? 'APPLY' : 'DRY_RUN',
  file: path.basename(excelPath),
  excel: { rows: excelRows.length, products: excelProducts.length, pairs: excelProducts.reduce((sum, row) => sum + row.pairs, 0), with_price: excelProducts.filter(row => row.precio > 0).length, total_mismatches: totalMismatches },
  plan: {
    create_products: creates.length,
    update_fichas: fieldUpdates.length,
    add_stock_sizes: stockAdds.length,
    add_pairs: addPairs,
    kept_higher_juarez: keptHigherStock.length,
    will_not: ['No se marca SAZ.', 'No se pisa imagen.', 'No se baja stock de JUÁREZ.', 'No se toca inventory_items.'],
  },
  juarez_pairs_now: catalogPairs,
  juarez_pairs_after: catalogPairs + addPairs,
  creates: creates.map(row => ({ estilo: row.estilo_raw, color: row.color, marca: row.marca, precio: row.precio, pairs: row.pairs })),
  field_updates_sample: fieldUpdates.slice(0, 12).map(row => ({ estilo: row.estilo, color: row.color, patch: row.patch })),
  kept_higher_stock_sample: keptHigherStock.slice(0, 8),
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify({ ...report, field_updates: fieldUpdates.map(row => ({ id: row.product.id, estilo: row.estilo, color: row.color, patch: row.patch })), matched_existing: matchedExisting, stock_adds: stockAdds.map(row => ({ estilo: row.row.estilo_raw, color: row.row.color, size: row.size, add: row.quantity, from: row.current, to: row.next })) }, null, 2));
console.log(JSON.stringify({ output: outputPath, mode: report.mode, excel: report.excel, plan: report.plan, juarez_pairs_now: catalogPairs, juarez_pairs_after: catalogPairs + addPairs, creates: report.creates, field_updates_sample: report.field_updates_sample, kept_higher_stock_sample: report.kept_higher_stock_sample }, null, 2));
if (!apply) {
  console.log('\nSimulación lista. Usa --apply para escribir en Supabase tal cual el Excel, sin bajar JUÁREZ.');
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
  if (!group.length) continue;
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
}

for (const row of fieldUpdates) {
  await rest(`products?id=eq.${row.product.id}&organization_id=eq.${organization.id}`, { method: 'PATCH', body: row.patch, prefer: 'return=minimal' });
}

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
    reason: `Carga MIRLO/WILDCAT corregido 16/11/26 · ${item.row.estilo_raw} ${item.row.color}`,
    import_key: item.importKey,
    created_by: userId,
  });
  appliedStock.push({ product_id: item.productId, estilo: item.row.estilo_raw, color: item.row.color, size: item.size, added: item.quantity, from: current, to: next });
}

for (const group of chunks(levelsPayload, 80)) {
  if (!group.length) continue;
  await rest('inventory_levels?on_conflict=branch_id%2Cvariant_id', { method: 'POST', body: group, prefer: 'resolution=merge-duplicates,return=minimal' });
}
for (const group of chunks(movementPayload, 80)) {
  if (!group.length) continue;
  await rest('inventory_movements_relational?on_conflict=import_key', { method: 'POST', body: group, prefer: 'resolution=merge-duplicates,return=minimal' });
}

await rest('inventory_migration_runs', {
  method: 'POST',
  body: {
    organization_id: organization.id,
    branch_id: juarez.id,
    source_summary: {
      file: path.basename(excelPath),
      mode: 'overwrite_fields_raise_stock_not_saz',
      created: created.length,
      field_updates: fieldUpdates.length,
      stock_adds: appliedStock.length,
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
  stock_sizes: appliedStock.length,
  pairs_added: appliedStock.reduce((sum, row) => sum + row.added, 0),
  kept_higher_juarez: keptHigherStock.length,
  preserved: 'Fichas al Excel. Sin marcar SAZ, sin pisar imagen, sin bajar JUÁREZ.',
}, null, 2));
