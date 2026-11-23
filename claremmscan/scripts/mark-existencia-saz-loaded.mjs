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
const LOADED_STATUS = 'CARGADO EN SAZ';
const excelPath = path.resolve(cli.xlsx || '/Users/laclavees12345/Downloads/existencia.xlsx');
const env = { ...readEnv(path.resolve(scriptDir, '../.env.local')), ...process.env };
const url = String(env.SUPABASE_URL || '').replace(/\/$/, '');
const apiKey = env.SUPABASE_PUBLISHABLE_KEY || '';
const email = String(env.SUPABASE_MIGRATION_EMAIL || '').trim();
const password = String(env.SUPABASE_MIGRATION_PASSWORD || '').trim();
if (!fs.existsSync(excelPath)) throw new Error(`No existe: ${excelPath}`);
if (!url || !apiKey || !email || !password) throw new Error('Faltan credenciales de Supabase.');

const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase().replace(/\s+/g, ' ');
const estiloText = value => (typeof value === 'number' && Number.isFinite(value) ? String(Math.trunc(value)) : String(value ?? '').trim());
const compactEstilo = value => normalize(value).replace(/^0+(?=\d)/, '');
const compactKey = (estilo, color) => `${compactEstilo(estilo)}|${normalize(color)}`;
const lookupKey = (estilo, color) => `${normalize(estilo)}|${normalize(color)}`;
const estiloValues = value => {
  const raw = normalize(estiloText(value));
  const compact = compactEstilo(raw);
  const padded = /^\d+$/.test(compact) ? compact.padStart(Math.max(6, compact.length), '0') : '';
  return [...new Set([raw, compact, padded].filter(Boolean))];
};
const chunks = (values, size = 80) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
const catalogScore = product => (
  (Number(product.precio) > 0 ? 1000 : 0) +
  (String(product.imagen || '').trim() ? 400 : 0) +
  (product.source_system === 'saz_registered' ? 220 : 0) +
  (/^0+\d/.test(String(product.estilo || '')) ? 80 : 0)
);
const pickCanonical = candidates => [...candidates].sort((left, right) => catalogScore(right) - catalogScore(left) || String(left.id).localeCompare(String(right.id)))[0];

const workbook = XLSX.readFile(excelPath, { cellDates: true, raw: true });
const excelRows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '', raw: true });
const excelByKey = new Map();
for (const row of excelRows) {
  const estilo = estiloText(row.Estilo);
  const color = normalize(row.Color);
  if (!estilo || !color) throw new Error(`Fila sin estilo o color: ${JSON.stringify({ estilo, color })}`);
  const key = compactKey(estilo, color);
  if (!excelByKey.has(key)) excelByKey.set(key, { estilo, color, rows: 0 });
  excelByKey.get(key).rows += 1;
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

const estiloFilter = [...new Set([...excelByKey.values()].flatMap(item => estiloValues(item.estilo)))];
const products = [];
for (const group of chunks(estiloFilter, 60)) {
  const encoded = group.map(value => encodeURIComponent(value)).join(',');
  products.push(...await allRows(`products?select=id,estilo,color,precio,imagen,source_system,estado,activo&organization_id=eq.${organization.id}&estilo=in.(${encoded})`));
}
const productsByCompact = new Map();
for (const product of products) {
  const key = compactKey(product.estilo, product.color);
  if (!productsByCompact.has(key)) productsByCompact.set(key, []);
  productsByCompact.get(key).push(product);
}

const registry = await allRows(`saz_product_registry?select=id,product_id,lookup_key,estilo,color&organization_id=eq.${organization.id}`);
const registryByLookup = new Map();
const registryByCompact = new Map();
for (const row of registry) {
  registryByLookup.set(normalize(row.lookup_key), row);
  const compact = compactKey(row.estilo || String(row.lookup_key).split('|')[0], row.color || String(row.lookup_key).split('|')[1]);
  if (!registryByCompact.has(compact)) registryByCompact.set(compact, row);
}

const matched = [];
const missing = [];
const alreadyRegistered = [];
const statusUpdates = [];
for (const [key, item] of excelByKey) {
  const candidates = (productsByCompact.get(key) || []).filter(product => product.activo !== false);
  const product = pickCanonical(candidates);
  if (!product) {
    missing.push(item);
    continue;
  }
  const exactKey = lookupKey(product.estilo, product.color);
  const registered = registryByLookup.get(exactKey) || registryByCompact.get(key);
  const needsStatus = candidates.filter(row => String(row.estado || '') !== LOADED_STATUS).map(row => row.id);
  matched.push({
    key, estilo: product.estilo, color: product.color, productId: product.id,
    copies: candidates.length, registered: Boolean(registered && registered.product_id === product.id),
    previousEstado: product.estado || '', needsStatus: needsStatus.length,
  });
  if (registered && registered.product_id === product.id) alreadyRegistered.push(exactKey);
  statusUpdates.push({ product, candidates, registered, exactKey, item });
}

const summary = {
  mode: apply ? 'APPLY' : 'DRY_RUN',
  file: path.basename(excelPath),
  excelRows: excelRows.length,
  uniqueFichas: excelByKey.size,
  matched: matched.length,
  missing: missing.length,
  alreadyInRegistry: alreadyRegistered.length,
  statusToUpdate: statusUpdates.reduce((sum, row) => sum + row.candidates.filter(item => String(item.estado || '') !== LOADED_STATUS).length, 0),
  registryToInsert: statusUpdates.filter(row => !(row.registered && row.registered.product_id === row.product.id)).length,
  missingSample: missing.slice(0, 12).map(item => `${item.estilo}|${item.color}`),
  note: 'Solo estatus. No se tocan existencias, precios ni fotos.',
};

console.log(JSON.stringify(summary, null, 2));
if (!apply) {
  console.log('\nSimulación lista. Usa --apply para marcar CARGADO EN SAZ.');
  process.exit(0);
}

const now = new Date().toISOString();
const productIds = [...new Set(statusUpdates.flatMap(row => row.candidates.map(item => item.id)))];
for (const group of chunks(productIds, 80)) {
  const encoded = group.join(',');
  await rest(`products?id=in.(${encoded})&organization_id=eq.${organization.id}`, {
    method: 'PATCH',
    body: { estado: LOADED_STATUS },
    prefer: 'return=minimal',
  });
}

const registryRows = statusUpdates.map(row => ({
  organization_id: organization.id,
  product_id: row.product.id,
  lookup_key: row.exactKey,
  estilo: normalize(row.product.estilo),
  color: normalize(row.product.color),
  source_files: [path.basename(excelPath)],
  last_registered_at: now,
}));
for (const group of chunks(registryRows, 80)) {
  await rest('saz_product_registry?on_conflict=organization_id%2Clookup_key', {
    method: 'POST',
    body: group,
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
}

const afterRegistry = await allRows(`saz_product_registry?select=id&organization_id=eq.${organization.id}`);
const afterProducts = [];
for (const group of chunks(productIds, 80)) {
  afterProducts.push(...await rest(`products?select=id,estado,precio,imagen&id=in.(${group.join(',')})`));
}
const statusOk = afterProducts.filter(row => row.estado === LOADED_STATUS).length;
const priceGuard = afterProducts.filter(row => Number(row.precio) > 0).length;
const imageGuard = afterProducts.filter(row => String(row.imagen || '').trim()).length;

console.log(JSON.stringify({
  completed: true,
  markedProducts: statusOk,
  registryTotal: afterRegistry.length,
  priceRowsUntouched: priceGuard,
  imageRowsPresent: imageGuard,
  missing: missing.length,
}, null, 2));
