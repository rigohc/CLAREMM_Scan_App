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
  const preferred = '/Users/laclavees12345/Downloads/Document (1).xlsx';
  if (fs.existsSync(preferred)) return preferred;
  throw new Error('No se encontró Document (1).xlsx en Descargas.');
}

const cli = argsFrom(process.argv.slice(2));
const apply = cli.apply === true;
const SOURCE_SYSTEM = 'saz_precargado';
const PRELOADED_STATUS = 'YA PRECARGADO EN SAZ';
const excelPath = findExcel(cli.xlsx);
const outputPath = path.resolve(cli.output || path.join(workspaceDir, 'entregables/saz-precargado-supabase.json'));
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
const compactKey = (estilo, color) => `${compactEstilo(estilo)}|${normalize(color)}`;
const chunks = (values, size = 80) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));

function rowTime(row) {
  const value = row['Fecha Alta'];
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rowScore(row) {
  const estilo = estiloText(row.Estilo);
  return (
    (/^0+\d/.test(estilo) ? 80 : 0) +
    (normalize(row.Marca) ? 25 : 0) +
    (text(row.Corrida) ? 10 : 0) +
    (text(row.Linea) ? 10 : 0) +
    (text(row.Acabado) ? 10 : 0) +
    (number(row.Precio) > 0 ? 5 : 0)
  );
}

function pickRow(group) {
  return [...group].sort((left, right) => rowScore(right) - rowScore(left) || rowTime(right) - rowTime(left))[0];
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

const memberships = await rest(`organization_members?select=organization_id&user_id=eq.${encodeURIComponent(userId)}`);
const organizations = await rest(`organizations?select=id,name&id=in.(${memberships.map(row => row.organization_id).join(',')})`);
const organization = organizations.find(row => normalize(row.name) === 'CLAREMM');
if (!organization) throw new Error('No se encontró la organización CLAREMM.');
const branches = await allRows(`branches?select=id,code,name&organization_id=eq.${organization.id}`);
const juarez = branches.find(row => row.code === 'JUAREZ') || branches[0];
if (!juarez) throw new Error('No se encontró sucursal JUAREZ.');

const products = await allRows(`products?select=id,estilo,color,precio,imagen,source_system,estado,activo&organization_id=eq.${organization.id}`);
const productsByCompact = new Map();
for (const product of products) {
  const key = compactKey(product.estilo, product.color);
  if (!productsByCompact.has(key)) productsByCompact.set(key, []);
  productsByCompact.get(key).push(product);
}

console.log('Leyendo Excel SAZ recuperado…');
const workbook = XLSX.readFile(excelPath, { cellDates: true, raw: true });
const excelRows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '', raw: true });
const grouped = new Map();
for (const row of excelRows) {
  const estilo = estiloText(row.Estilo);
  const color = normalize(row.Color);
  if (!estilo || !color) throw new Error(`Fila sin estilo o color: ${JSON.stringify({ estilo, color })}`);
  const key = compactKey(estilo, color);
  if (!grouped.has(key)) grouped.set(key, []);
  grouped.get(key).push(row);
}

const creates = [];
const matchedExisting = [];
const priceGuard = [];
for (const [key, group] of grouped) {
  const row = pickRow(group);
  const candidates = productsByCompact.get(key) || [];
  const active = candidates.filter(product => product.activo !== false);
  const match = (active.length ? active : candidates)[0] || null;
  if (match) {
    matchedExisting.push({
      key, excel_estilo: estiloText(row.Estilo), excel_color: normalize(row.Color),
      excel_precio: number(row.Precio), catalog_precio: Number(match.precio || 0),
      catalog_source: match.source_system, has_image: Boolean(String(match.imagen || '').trim()),
      product_id: match.id, excel_dups: group.length,
    });
    priceGuard.push({ id: match.id, precio: Number(match.precio || 0), imagen: String(match.imagen || '') });
    continue;
  }
  creates.push({
    key,
    estilo: estiloText(row.Estilo),
    color: normalize(row.Color),
    acabado: normalize(row.Acabado),
    descripcion: text(row.Descripcion),
    corrida: text(row.Corrida),
    fecha_alta: text(row['Fecha Alta']),
    linea: normalize(row.Linea),
    sublinea: normalize(row.Sublinea),
    plantilla: normalize(row.Plantilla),
    temporada: text(row.Temporada),
    clasificacion: normalize(row.Clasificacion),
    marca: normalize(row.Marca),
    costo: number(row.Costo),
    precio: number(row.Precio),
    status: Math.trunc(number(row.Status) || 1),
    observaciones: text(row.Observaciones),
    catalogo: normalize(row.Catalogo),
    comprador: text(row.Comprador) || 'Sin asignar',
    pagina: Math.trunc(number(row.Pagina)),
    excel_dups: group.length,
  });
}

const snapshot = {
  products: products.length,
  juarez_id: juarez.id,
  price_guard_sample: priceGuard.slice(0, 25),
};
const report = {
  generated_at: new Date().toISOString(),
  mode: apply ? 'APPLY' : 'DRY_RUN',
  file: path.basename(excelPath),
  organization: { id: organization.id, name: organization.name },
  branch: { id: juarez.id, code: juarez.code, name: juarez.name },
  excel: {
    rows: excelRows.length,
    unique_estilo_color: grouped.size,
    duplicate_groups: [...grouped.values()].filter(group => group.length > 1).length,
  },
  plan: {
    already_in_catalog: matchedExisting.length,
    create_preloaded: creates.length,
    fill_existing_prices: 0,
    add_stock: 0,
    register_official_saz: 0,
  },
  will: [
    `Crear ${creates.length} fichas nuevas con estatus ${PRELOADED_STATUS}.`,
    'Dejar intactos los registros que ya existen (precios e imágenes actuales).',
  ],
  will_not: [
    'No se pisa precio ni imagen de fichas actuales: este SAZ es antiguo y está desactualizado.',
    'No se mueve inventario: el archivo no trae tallas ni existencias.',
    'No se escribe en saz_product_registry: no es una carga oficial reciente.',
    'No se toca inventory_items.',
  ],
  matched_sample: matchedExisting.slice(0, 12),
  create_sample: creates.slice(0, 12).map(row => ({ estilo: row.estilo, color: row.color, marca: row.marca, precio: row.precio, corrida: row.corrida })),
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output: outputPath, mode: report.mode, excel: report.excel, plan: report.plan }, null, 2));

if (!apply) {
  console.log('\nSimulación lista. Usa --apply para crear solo las fichas faltantes como YA PRECARGADO EN SAZ.');
  process.exit(0);
}

let created = 0;
for (const [index, group] of chunks(creates, 80).entries()) {
  const payload = group.map(row => ({
    organization_id: organization.id,
    source_system: SOURCE_SYSTEM,
    source_id: row.key,
    match_key: [row.estilo, row.color, row.marca].map(normalize).join('|'),
    estilo: normalize(row.estilo),
    color: row.color,
    precio: row.precio,
    marca: row.marca || '',
    proveedor: '',
    temporada: row.temporada || '',
    sublinea: row.sublinea || '',
    departamento: '',
    clasificacion: row.clasificacion || '',
    linea: row.linea || '',
    corrida: row.corrida || '',
    acabado: row.acabado || '',
    suela: '',
    plantilla: row.plantilla || '',
    tacon: '',
    forro: '',
    catalogo: row.catalogo || '',
    status: row.status || 1,
    observaciones: row.observaciones || '',
    costo: row.costo || 0,
    descripcion: row.descripcion || '',
    estado: PRELOADED_STATUS,
    fecha_alta: row.fecha_alta || '',
    comprador: row.comprador || '',
    pagina: row.pagina || 0,
    activo: true,
    imagen: '',
  }));
  await rest('products?on_conflict=organization_id%2Csource_system%2Csource_id', {
    method: 'POST', body: payload, prefer: 'resolution=merge-duplicates,return=minimal',
  });
  created += payload.length;
  if (created % 800 === 0 || created === creates.length) console.log(`Fichas precargadas: ${created}/${creates.length}`);
}

const afterProducts = await allRows(`products?select=id,estilo,color,precio,imagen,source_system,estado&organization_id=eq.${organization.id}`);
const preloaded = afterProducts.filter(product => product.source_system === SOURCE_SYSTEM);
const guardFailed = [];
for (const snapshotRow of priceGuard.slice(0, 200)) {
  const current = afterProducts.find(product => product.id === snapshotRow.id);
  if (!current) {
    guardFailed.push({ id: snapshotRow.id, reason: 'missing' });
    continue;
  }
  if (Number(current.precio || 0) !== snapshotRow.precio || String(current.imagen || '') !== snapshotRow.imagen) {
    guardFailed.push({ id: snapshotRow.id, before: snapshotRow, after: { precio: current.precio, imagen: current.imagen } });
  }
}
if (guardFailed.length) throw new Error(`Se alteraron fichas existentes: ${JSON.stringify(guardFailed.slice(0, 5))}`);

await rest('inventory_migration_runs', {
  method: 'POST',
  body: {
    organization_id: organization.id,
    branch_id: juarez.id,
    source_summary: {
      file: path.basename(excelPath),
      mode: 'saz_precargado_missing_only',
      excel_rows: excelRows.length,
      unique_estilo_color: grouped.size,
      already_in_catalog: matchedExisting.length,
      created,
      prices_outdated: true,
      stock_unchanged: true,
      official_saz_untouched: true,
    },
    product_count: created,
    variant_count: 0,
    pair_count: 0,
    created_by: userId,
  },
  prefer: 'return=minimal',
});

report.mode = 'APPLY';
report.applied = {
  created,
  catalog_products_after: afterProducts.length,
  preloaded_after: preloaded.length,
  existing_prices_images_unchanged: true,
};
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  completed: true,
  created,
  already_in_catalog: matchedExisting.length,
  catalog_products_after: afterProducts.length,
  preloaded: preloaded.length,
  preserved: 'Precios e imágenes actuales intactos. Sin stock ni registro oficial SAZ.',
  output: outputPath,
}, null, 2));
