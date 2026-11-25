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

function normalize(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function compactEstilo(value) {
  return normalize(value).replace(/^0+(?=\d)/, '');
}

function estiloKeys(value) {
  const raw = normalize(value);
  const compact = compactEstilo(raw);
  const keys = [raw, compact, compact.replace(/-/g, '')];
  if (/^\d+$/.test(compact)) {
    for (let length = compact.length; length <= Math.max(6, compact.length); length += 1) keys.push(compact.padStart(length, '0'));
  }
  return [...new Set(keys.filter(Boolean))];
}

function priceOf(value) {
  const number = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(number) && number > 0 ? Number(number.toFixed(2)) : 0;
}

function compactKey(estilo, color) {
  return `${compactEstilo(estilo)}|${normalize(color)}`;
}

function chunks(values, size = 40) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, index + size));
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

function scoreProduct(product) {
  return (product.activo === false ? 0 : 500) + (Number(product.precio) > 0 ? 100 : 0) + (String(product.imagen || '').trim() ? 50 : 0);
}

const cli = argsFrom(process.argv.slice(2));
const apply = cli.apply === true;
const excelPath = path.resolve(cli.xlsx || '/Users/laclavees12345/Downloads/CLAREMM_Faltantes_SAZ_JUAREZ_2026-11-23.xlsx');
const env = { ...readEnv(path.resolve(scriptDir, '../.env.local')), ...process.env };
const url = String(env.SUPABASE_URL || '').replace(/\/$/, '');
const apiKey = env.SUPABASE_PUBLISHABLE_KEY || '';
const email = String(env.SUPABASE_MIGRATION_EMAIL || '').trim();
const password = String(env.SUPABASE_MIGRATION_PASSWORD || '').trim();
if (!fs.existsSync(excelPath)) throw new Error(`No existe: ${excelPath}`);
if (!url || !apiKey || !email || !password) throw new Error('Faltan credenciales de Supabase.');

const workbook = XLSX.readFile(excelPath, { cellDates: true, raw: false });
const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '', raw: false });
const excelPrices = new Map();
for (const row of rows) {
  const estilo = String(row.Estilo ?? '').trim();
  const color = normalize(row.Color);
  const precio = priceOf(row['Precio de venta']);
  if (!estilo || !color || !(precio > 0)) continue;
  excelPrices.set(compactKey(estilo, color), { estilo, color, precio, marca: String(row.Marca || '').trim() });
}

const authResponse = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: apiKey, 'Content-Type': 'application/json' },
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

const memberships = await rest(`organization_members?select=organization_id&user_id=eq.${encodeURIComponent(userId)}`);
const organizations = await rest(`organizations?select=id,name&id=in.(${memberships.map(row => row.organization_id).join(',')})`);
const organization = organizations.find(row => normalize(row.name) === 'CLAREMM');
if (!organization) throw new Error('No se encontró la organización CLAREMM.');

const products = await allRows(`products?select=id,estilo,color,marca,precio,imagen,activo,corrida&organization_id=eq.${organization.id}&activo=eq.true`);

const byCompact = new Map();
const byEstilo = new Map();
for (const product of products) {
  const key = compactKey(product.estilo, product.color);
  const list = byCompact.get(key) || [];
  list.push(product);
  byCompact.set(key, list);
  const estiloKey = compactEstilo(product.estilo);
  const estiloList = byEstilo.get(estiloKey) || [];
  estiloList.push(product);
  byEstilo.set(estiloKey, estiloList);
}

const updated = [];
const same = [];
const missing = [];
const ambiguous = [];

for (const [key, row] of excelPrices) {
  const matches = (byCompact.get(key) || []).filter(product => product.activo !== false);
  const candidates = matches.length ? matches : (byCompact.get(key) || []);
  if (!candidates.length) {
    missing.push(row);
    continue;
  }
  candidates.sort((left, right) => scoreProduct(right) - scoreProduct(left));
  const product = candidates[0];
  if (candidates.length > 1) ambiguous.push({ ...row, product_id: product.id, extras: candidates.length - 1 });
  const current = Number(product.precio || 0);
  if (current === row.precio) {
    same.push({ ...row, product_id: product.id, current });
    continue;
  }
  updated.push({ ...row, product_id: product.id, current, next: row.precio });
}

if (apply) {
  for (const group of chunks(updated, 20)) {
    await Promise.all(group.map(row => rest(`products?id=eq.${row.product_id}`, {
      method: 'PATCH',
      body: { precio: row.next },
      prefer: 'return=minimal',
    })));
  }
}

const report = {
  apply,
  excel_con_precio: excelPrices.size,
  catalog_hits: products.length,
  updated: updated.length,
  already_same: same.length,
  missing: missing.length,
  ambiguous: ambiguous.length,
  sample_updated: updated.slice(0, 8),
  sample_missing: missing.slice(0, 8),
};

console.log(JSON.stringify(report, null, 2));
if (!apply) console.log('\nSin --apply: solo lectura. Vuelve a correr con --apply para escribir en Supabase.');
