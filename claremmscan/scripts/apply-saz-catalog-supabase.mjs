#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const catalog = require('../saz-catalog.js');
const productOptions = JSON.parse(fs.readFileSync(path.join(scriptDir, '../saz-catalog/product-option-values.json'), 'utf8'));
const providerOptions = JSON.parse(fs.readFileSync(path.join(scriptDir, '../saz-catalog/provider-option-values.json'), 'utf8'));
catalog.loadFromData(productOptions, providerOptions);

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

const FIELDS = ['color', 'marca', 'proveedor', 'temporada', 'sublinea', 'departamento', 'clasificacion', 'linea', 'corrida', 'acabado', 'suela', 'plantilla', 'tacon', 'forro'];
const catalogText = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase().replace(/\s+/g, ' ');
const compactEstilo = value => catalogText(value).replace(/^0+(?=\d)/, '');
const chunks = (values, size = 80) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));

function officialValue(field, raw) {
  const current = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!current) return '';
  const resolved = catalog.resolve(field, current);
  if (!resolved) return '';
  const key = catalog.normalizeKey(resolved);
  return catalog.getOptions(field).find(value => catalog.normalizeKey(value) === key) || '';
}

const cli = argsFrom(process.argv.slice(2));
const apply = cli.apply === true;
const env = { ...readEnv(path.resolve(scriptDir, '../.env.local')), ...process.env };
const url = String(env.SUPABASE_URL || '').replace(/\/$/, '');
const apiKey = env.SUPABASE_PUBLISHABLE_KEY || '';
const email = String(env.SUPABASE_MIGRATION_EMAIL || '').trim();
const password = String(env.SUPABASE_MIGRATION_PASSWORD || '').trim();
if (!url || !apiKey || !email || !password) throw new Error('Faltan credenciales de Supabase.');

const authResponse = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: apiKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const auth = await authResponse.json();
if (!authResponse.ok || !auth.access_token) throw new Error(`Auth: ${auth.error_description || auth.message || authResponse.status}`);
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
const organization = organizations.find(row => catalogText(row.name) === 'CLAREMM');
if (!organization) throw new Error('No se encontró CLAREMM.');

const products = await allRows(`products?select=id,estilo,color,marca,proveedor,temporada,sublinea,departamento,clasificacion,linea,corrida,acabado,suela,plantilla,tacon,forro,match_key,precio,imagen,activo&organization_id=eq.${organization.id}`);
const occupied = new Map();
for (const product of products) {
  if (product.activo === false) continue;
  const key = `${compactEstilo(product.estilo)}|${catalog.normalizeKey(product.color)}`;
  if (!occupied.has(key)) occupied.set(key, product.id);
}

const fieldCounts = Object.fromEntries(FIELDS.map(field => [field, 0]));
const updates = [];
const colorCollisions = [];
const leftover = { color: new Map(), proveedor: new Map() };

for (const product of products) {
  const patch = {};
  for (const field of FIELDS) {
    const official = officialValue(field, product[field]);
    if (!official || official === String(product[field] ?? '').trim().replace(/\s+/g, ' ')) continue;
    if (field === 'color') {
      const nextKey = `${compactEstilo(product.estilo)}|${catalog.normalizeKey(official)}`;
      const holder = occupied.get(nextKey);
      if (holder && holder !== product.id) {
        colorCollisions.push({ id: product.id, estilo: product.estilo, from: product.color, to: official, existingId: holder });
        continue;
      }
    }
    patch[field] = official;
    fieldCounts[field] += 1;
  }
  if (Object.keys(patch).length) {
    if (patch.color || patch.marca) {
      patch.match_key = [product.estilo, patch.color || product.color, patch.marca || product.marca].map(catalogText).join('|');
    }
    updates.push({ id: product.id, estilo: product.estilo, fromColor: product.color, patch });
  }
  const colorOfficial = officialValue('color', product.color);
  if (String(product.color || '').trim() && !colorOfficial) {
    const key = String(product.color).trim();
    leftover.color.set(key, (leftover.color.get(key) || 0) + 1);
  }
  const proveedorOfficial = officialValue('proveedor', product.proveedor);
  if (String(product.proveedor || '').trim() && !proveedorOfficial) {
    const key = String(product.proveedor).trim();
    leftover.proveedor.set(key, (leftover.proveedor.get(key) || 0) + 1);
  }
}

const top = map => [...map.entries()].sort((left, right) => right[1] - left[1]).slice(0, 12).map(([value, count]) => ({ value, count }));
const summary = {
  mode: apply ? 'APPLY' : 'DRY_RUN',
  products: products.length,
  toUpdate: updates.length,
  fieldCounts,
  colorCollisions: colorCollisions.length,
  colorCollisionSample: colorCollisions.slice(0, 8),
  leftoverColors: leftover.color.size,
  leftoverColorSample: top(leftover.color),
  leftoverProviders: leftover.proveedor.size,
  leftoverProviderSample: top(leftover.proveedor),
  sample: updates.slice(0, 12).map(row => ({ estilo: row.estilo, fromColor: row.fromColor, patch: row.patch })),
  note: 'No se tocan precio, imagen ni existencias. Proveedor solo se ajusta si ya existe en SAZ; los no dados de alta se dejan.',
};
console.log(JSON.stringify(summary, null, 2));
if (!apply) {
  console.log('\nSimulación lista. Usa --apply para escribir en Supabase.');
  process.exit(0);
}

const groups = new Map();
for (const row of updates) {
  const key = JSON.stringify(row.patch);
  if (!groups.has(key)) groups.set(key, { patch: row.patch, ids: [] });
  groups.get(key).ids.push(row.id);
}

let patched = 0;
for (const group of groups.values()) {
  for (const ids of chunks(group.ids, 80)) {
    await rest(`products?id=in.(${ids.join(',')})&organization_id=eq.${organization.id}`, {
      method: 'PATCH',
      body: group.patch,
      prefer: 'return=minimal',
    });
    patched += ids.length;
  }
}

const colorUpdates = updates.filter(row => row.patch.color);
const registryByProduct = new Map();
for (const ids of chunks(colorUpdates.map(row => row.id), 80)) {
  if (!ids.length) continue;
  const rows = await allRows(`saz_product_registry?select=id,product_id,lookup_key,estilo,color&organization_id=eq.${organization.id}&product_id=in.(${ids.join(',')})`);
  for (const row of rows) registryByProduct.set(row.product_id, row);
}
let registryPatched = 0;
for (const row of colorUpdates) {
  const current = registryByProduct.get(row.id);
  if (!current) continue;
  const lookupKey = `${catalogText(row.estilo)}|${catalogText(row.patch.color)}`;
  await rest(`saz_product_registry?id=eq.${current.id}&organization_id=eq.${organization.id}`, {
    method: 'PATCH',
    body: { color: catalogText(row.patch.color), lookup_key: lookupKey },
    prefer: 'return=minimal',
  });
  registryPatched += 1;
}

console.log(JSON.stringify({
  applied: true,
  patched,
  registryPatched,
  skippedColorCollisions: colorCollisions.length,
  leftoverProviders: leftover.proveedor.size,
}, null, 2));
