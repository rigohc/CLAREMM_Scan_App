#!/usr/bin/env node
'use strict';

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceDir = path.resolve(scriptDir, '../..');

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

function text(value) {
  return String(value ?? '').trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalize(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function compactEstilo(value) {
  return normalize(value).replace(/^0+(?=\d)/, '');
}

function compactKey(estilo, color) {
  return `${compactEstilo(estilo)}|${normalize(color)}`;
}

function sizeKey(value) {
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed.toFixed(1) : text(value);
}

function chunks(values, size = 80) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
}

const cli = argsFrom(process.argv.slice(2));
const apply = cli.apply === true;
const dumpPath = path.resolve(cli.input || path.join(workspaceDir, 'CLAREMM_Exportacion_SQLite_Supabase/datos.json'));
const outputPath = path.resolve(cli.output || path.join(workspaceDir, 'entregables/sqlite-export-supabase.json'));
const env = { ...readEnv(path.resolve(scriptDir, '../.env.local')), ...process.env };
const url = String(env.SUPABASE_URL || '').replace(/\/$/, '');
const apiKey = env.SUPABASE_PUBLISHABLE_KEY || '';
const email = String(env.SUPABASE_MIGRATION_EMAIL || '').trim();
const password = String(env.SUPABASE_MIGRATION_PASSWORD || '').trim();
if (!fs.existsSync(dumpPath)) throw new Error(`No existe: ${dumpPath}`);
if (!url || !apiKey || !email || !password) throw new Error('Faltan credenciales de Supabase.');

const rawDump = fs.readFileSync(dumpPath);
const dump = JSON.parse(rawDump.toString('utf8'));
const dumpHash = crypto.createHash('sha256').update(rawDump).digest('hex');
const productsDump = Array.isArray(dump.products) ? dump.products : [];
const inventoryDump = Array.isArray(dump.product_size_inventory) ? dump.product_size_inventory : [];
const movementsDump = Array.isArray(dump.inventory_movements) ? dump.inventory_movements : [];
const dumpById = new Map(productsDump.map(product => [String(product.id), product]));
const dumpPairs = inventoryDump.reduce((sum, row) => sum + Math.max(0, Math.trunc(number(row.quantity))), 0);

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
  if (!response.ok) {
    const error = new Error(`${method} ${resource}: ${data?.message || data?.details || raw || response.status}`);
    error.status = response.status;
    error.body = data;
    throw error;
  }
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

async function tableExists(name) {
  try {
    await rest(`${name}?select=*&limit=1`);
    return true;
  } catch (error) {
    if (error.status === 404 || /could not find the table/i.test(String(error.message))) return false;
    throw error;
  }
}

const memberships = await rest(`organization_members?select=organization_id,role&user_id=eq.${encodeURIComponent(userId)}`);
const organizations = await rest(`organizations?select=id,name&id=in.(${memberships.map(row => row.organization_id).join(',')})`);
const organization = organizations.find(row => normalize(row.name) === 'CLAREMM');
if (!organization) throw new Error('No se encontró la organización CLAREMM.');
const branches = await allRows(`branches?select=id,code,name&organization_id=eq.${organization.id}`);
const juarez = branches.find(row => row.code === 'JUAREZ') || branches[0];
if (!juarez) throw new Error('No se encontró sucursal JUAREZ.');

const products = await allRows(`products?select=id,estilo,color,precio,imagen,ficha_imagen,source_system,source_id,activo&organization_id=eq.${organization.id}`);
const sqliteProducts = products.filter(product => product.source_system === 'sqlite');
const sqliteIds = new Set(sqliteProducts.map(product => String(product.source_id)));
const variants = await allRows('product_variants?select=id,product_id,size');
const productIds = new Set(products.map(product => product.id));
const orgVariants = variants.filter(variant => productIds.has(variant.product_id));
const levels = [];
for (const group of chunks(orgVariants.map(variant => variant.id), 200)) {
  if (!group.length) continue;
  levels.push(...await rest(`inventory_levels?select=branch_id,variant_id,quantity&variant_id=in.(${group.join(',')})`));
}
const juarezLevels = levels.filter(level => level.branch_id === juarez.id);
const juarezPairs = juarezLevels.reduce((sum, level) => sum + Number(level.quantity || 0), 0);
const qtyByVariant = new Map(juarezLevels.map(level => [level.variant_id, Number(level.quantity || 0)]));
const productById = new Map(products.map(product => [product.id, product]));

const cloudByCombo = new Map();
for (const variant of orgVariants) {
  const product = productById.get(variant.product_id);
  if (!product) continue;
  const quantity = qtyByVariant.get(variant.id) || 0;
  if (quantity <= 0) continue;
  const key = `${compactKey(product.estilo, product.color)}|${sizeKey(variant.size)}`;
  cloudByCombo.set(key, (cloudByCombo.get(key) || 0) + quantity);
}

const dumpByCombo = new Map();
for (const row of inventoryDump) {
  const product = dumpById.get(String(row.product_id));
  if (!product) continue;
  const quantity = Math.max(0, Math.trunc(number(row.quantity)));
  if (!quantity) continue;
  const key = `${compactKey(product.estilo, product.color)}|${sizeKey(row.size)}`;
  dumpByCombo.set(key, (dumpByCombo.get(key) || 0) + quantity);
}

const ghostDuplicateAdds = [];
for (const [key, dumpQty] of dumpByCombo) {
  const current = cloudByCombo.get(key) || 0;
  if (dumpQty > current) {
    const [estilo, color, size] = key.split('|');
    ghostDuplicateAdds.push({ estilo, color, size, dumpQty, current, skipped_add: dumpQty - current });
  }
}

const sources = {};
for (const product of products) sources[product.source_system] = (sources[product.source_system] || 0) + 1;

const sidecarReady = {
  products: await tableExists('sqlite_local_products'),
  inventory: await tableExists('sqlite_local_size_inventory'),
  movements: await tableExists('sqlite_local_movements'),
};

const report = {
  generated_at: new Date().toISOString(),
  mode: apply ? 'APPLY' : 'DRY_RUN',
  dump: {
    file: path.basename(dumpPath),
    sha256: dumpHash,
    products: productsDump.length,
    inventory_rows: inventoryDump.length,
    pairs: dumpPairs,
    movements: movementsDump.length,
  },
  organization: { id: organization.id, name: organization.name },
  branch: { id: juarez.id, code: juarez.code, name: juarez.name },
  relational_before: {
    products: products.length,
    sqlite_products: sqliteProducts.length,
    sources,
    juarez_pairs: juarezPairs,
  },
  safety: {
    dump_sql_not_executed: true,
    fichas_skipped: true,
    images_not_uploaded: true,
    prices_not_changed: true,
    stock_not_set_down: true,
    inventory_items_untouched: true,
    sqlite_ids_already_in_catalog: productsDump.filter(product => sqliteIds.has(String(product.id))).length,
    sqlite_ids_missing: productsDump.filter(product => !sqliteIds.has(String(product.id))).map(product => product.id),
    skipped_duplicate_style_color_pairs: ghostDuplicateAdds.reduce((sum, row) => sum + row.skipped_add, 0),
    skipped_duplicate_rows: ghostDuplicateAdds,
  },
  sidecar_tables: sidecarReady,
  will: sidecarReady.products && sidecarReady.inventory && sidecarReady.movements
    ? ['Archivar SQLite en sqlite_local_* sin tocar products ni JUAREZ.']
    : ['Registrar el dump como corrida de archivo. No se crean fichas ni se mueve stock.'],
  will_not: [
    'No se ejecuta CLAREMM_Importar_Supabase.sql.',
    'No se crea ni altera public.products.',
    'No se suben ficha_imagen ni archivos de foto.',
    'No se pisa precio > 0 ni imagen.',
    'No se baja ni se vuelve a sumar stock de SQLite: el catálogo ya lo tiene y JUAREZ está más alto.',
    'No se toca inventory_items.',
  ],
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  output: outputPath,
  mode: report.mode,
  dump: report.dump,
  relational_before: report.relational_before,
  sidecar_tables: report.sidecar_tables,
  safety: {
    sqlite_ids_missing: report.safety.sqlite_ids_missing.length,
    skipped_duplicate_style_color_pairs: report.safety.skipped_duplicate_style_color_pairs,
  },
  will: report.will,
}, null, 2));

if (!apply) {
  console.log('\nSimulación lista. El SQL original no se ejecutó. Usa --apply solo para archivar el dump, sin tocar fichas ni existencias.');
  process.exit(0);
}

const snapshot = {
  products: products.length,
  sqlite_products: sqliteProducts.length,
  juarez_pairs: juarezPairs,
};

await rest('inventory_migration_runs', {
  method: 'POST',
  body: {
    organization_id: organization.id,
    branch_id: juarez.id,
    source_summary: {
      kind: 'sqlite_local_archive',
      file: path.basename(dumpPath),
      sha256: dumpHash,
      skipped_fichas: true,
      skipped_images: true,
      did_not_run_dump_sql: true,
      products: productsDump.length,
      inventory_rows: inventoryDump.length,
      pairs: dumpPairs,
      movements: movementsDump.length,
      sqlite_ids_already_in_catalog: report.safety.sqlite_ids_already_in_catalog,
      skipped_duplicate_style_color_pairs: report.safety.skipped_duplicate_style_color_pairs,
    },
    product_count: productsDump.length,
    variant_count: inventoryDump.length,
    pair_count: dumpPairs,
    created_by: userId,
  },
  prefer: 'return=minimal',
});

let sidecar = { products: 0, inventory: 0, movements: 0, used: false };
if (sidecarReady.products && sidecarReady.inventory && sidecarReady.movements) {
  sidecar.used = true;
  const productRows = productsDump.map(product => ({
    sqlite_id: Number(product.id),
    organization_id: organization.id,
    estilo: text(product.estilo),
    color: text(product.color),
    acabado: text(product.acabado),
    marca: text(product.marca),
    temporada: text(product.temporada),
    proveedor: text(product.proveedor),
    sublinea: text(product.sublinea),
    clasificacion: text(product.clasificacion),
    linea: text(product.linea),
    codigo_barras: text(product.codigo_barras),
    precio: number(product.precio),
    costo: number(product.costo),
    departamento: text(product.departamento),
    observaciones: text(product.observaciones),
    suela: text(product.suela),
    plantilla: text(product.plantilla),
    tacon: text(product.tacon),
    forro: text(product.forro),
    catalogo: text(product.catalogo),
    activo: Math.trunc(number(product.activo)),
    descripcion: text(product.descripcion),
    corrida: text(product.corrida),
    estado: text(product.estado),
    fecha_alta: text(product.fecha_alta),
    comprador: text(product.comprador),
    pagina: Math.trunc(number(product.pagina)),
    status: Math.trunc(number(product.status) || 1),
    imagen_sqlite_path: text(product.imagen),
    sqlite_created_at: text(product.created_at),
    sqlite_updated_at: text(product.updated_at),
  }));
  for (const group of chunks(productRows)) {
    await rest('sqlite_local_products?on_conflict=sqlite_id', {
      method: 'POST', body: group, prefer: 'resolution=merge-duplicates,return=minimal',
    });
    sidecar.products += group.length;
  }
  const inventoryRows = inventoryDump.map(row => ({
    organization_id: organization.id,
    sqlite_product_id: Number(row.product_id),
    size: text(row.size),
    quantity: Math.max(0, Math.trunc(number(row.quantity))),
    sqlite_updated_at: text(row.updated_at),
  }));
  for (const group of chunks(inventoryRows)) {
    await rest('sqlite_local_size_inventory?on_conflict=sqlite_product_id%2Csize', {
      method: 'POST', body: group, prefer: 'resolution=merge-duplicates,return=minimal',
    });
    sidecar.inventory += group.length;
  }
  const movementRows = movementsDump.map(row => ({
    sqlite_id: Number(row.id),
    organization_id: organization.id,
    sqlite_product_id: Number(row.product_id),
    size: text(row.size),
    operation: text(row.operation),
    previous_quantity: Math.trunc(number(row.previous_quantity)),
    quantity: Math.trunc(number(row.quantity)),
    new_quantity: Math.max(0, Math.trunc(number(row.new_quantity))),
    sqlite_created_at: text(row.created_at),
  }));
  for (const group of chunks(movementRows)) {
    await rest('sqlite_local_movements?on_conflict=sqlite_id', {
      method: 'POST', body: group, prefer: 'resolution=merge-duplicates,return=minimal',
    });
    sidecar.movements += group.length;
  }
}

const afterProducts = await allRows(`products?select=id,source_system,precio,imagen&organization_id=eq.${organization.id}`);
const afterSqlite = afterProducts.filter(product => product.source_system === 'sqlite');
const afterLevels = [];
for (const group of chunks(orgVariants.map(variant => variant.id), 200)) {
  if (!group.length) continue;
  afterLevels.push(...await rest(`inventory_levels?select=branch_id,variant_id,quantity&variant_id=in.(${group.join(',')})`));
}
const afterPairs = afterLevels.filter(level => level.branch_id === juarez.id).reduce((sum, level) => sum + Number(level.quantity || 0), 0);
const unchanged = afterProducts.length === snapshot.products && afterSqlite.length === snapshot.sqlite_products && afterPairs === snapshot.juarez_pairs;
if (!unchanged) throw new Error(`La verificación falló: productos ${snapshot.products}->${afterProducts.length}, sqlite ${snapshot.sqlite_products}->${afterSqlite.length}, pares ${snapshot.juarez_pairs}->${afterPairs}`);

report.mode = 'APPLY';
report.sidecar_written = sidecar;
report.relational_after = {
  products: afterProducts.length,
  sqlite_products: afterSqlite.length,
  juarez_pairs: afterPairs,
  unchanged: true,
};
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  completed: true,
  sidecar_written: sidecar,
  relational_after: report.relational_after,
  output: outputPath,
}, null, 2));
