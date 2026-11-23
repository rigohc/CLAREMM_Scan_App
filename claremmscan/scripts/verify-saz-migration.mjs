#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2), registeredIndex = argv.indexOf('--registered');
const registeredPath = registeredIndex >= 0 ? path.resolve(argv[registeredIndex + 1]) : '';

function readEnv(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/).flatMap(line => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1].startsWith('#')) return [];
    return [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]];
  }));
}

const env = { ...readEnv(path.resolve('.env.local')), ...process.env };
const url = String(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const apiKey = env.SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
const email = env.SUPABASE_MIGRATION_EMAIL || '';
const password = env.SUPABASE_MIGRATION_PASSWORD || '';
if (!url || !apiKey || !email || !password) throw new Error('Faltan las variables o credenciales de Supabase.');

const authResponse = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: apiKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const auth = await authResponse.json();
if (!authResponse.ok || !auth.access_token) throw new Error(`No se pudo autenticar: ${auth.error_description || auth.message || authResponse.status}`);

async function page(offset) {
  const response = await fetch(`${url}/rest/v1/inventory_items?select=item_key,estilo,color,talla,cantidad,precio,saz_cargado,saz_cargado_at,origen&order=item_key&limit=1000&offset=${offset}`, {
    headers: { apikey: apiKey, Authorization: `Bearer ${auth.access_token}` },
  });
  const text = await response.text(), data = text ? JSON.parse(text) : [];
  if (!response.ok) throw new Error(data?.message || data?.details || text || String(response.status));
  return data;
}

const rows = [];
for (let offset = 0; ; offset += 1000) {
  const next = await page(offset);
  rows.push(...next);
  if (next.length < 1000) break;
}

const byOrigin = {};
for (const row of rows) {
  const origin = row.origen || '(sin origen)';
  byOrigin[origin] ||= { registros: 0, pares: 0, cargados: 0, pendientes: 0 };
  byOrigin[origin].registros++;
  byOrigin[origin].pares += Number(row.cantidad || 0);
  byOrigin[origin][row.saz_cargado ? 'cargados' : 'pendientes']++;
}
const loaded = rows.filter(row => row.saz_cargado).length;
const invalidLegacyOrigin = rows.filter(row => row.origen !== 'supabase_legacy').length;
const verified = rows.length > 0 && loaded === 0 && invalidLegacyOrigin === 0;
const numericPrice = value => Number(String(value ?? '').replace(/[^0-9.-]/g, '')) || 0;
const pricedRows = rows.filter(row => numericPrice(row.precio) > 0);
const value = rows.reduce((sum, row) => sum + numericPrice(row.precio) * Number(row.cantidad || 0), 0);
let registeredComparison = null;
if (registeredPath) {
  const registered = JSON.parse(fs.readFileSync(registeredPath, 'utf8'));
  const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase().replace(/\s+/g, ' ');
  const key = row => [row.estilo, row.color, row.size ?? row.talla].map(normalize).join('|');
  const registeredMap = new Map((registered.variants || []).map(row => [key(row), row]));
  const matchedRows = rows.filter(row => registeredMap.has(key(row)));
  const matchedKeys = new Set(matchedRows.map(key));
  const unmatchedRegistered = [...registeredMap].filter(([variantKey]) => !matchedKeys.has(variantKey)).map(([, row]) => row);
  registeredComparison = {
    registered_variants: registeredMap.size,
    registered_pairs: [...registeredMap.values()].reduce((sum, row) => sum + Number(row.quantity || 0), 0),
    matching_flat_rows: matchedRows.length,
    matching_flat_pairs: matchedRows.reduce((sum, row) => sum + Number(row.cantidad || 0), 0),
    registered_variants_missing_from_flat: unmatchedRegistered.length,
    registered_pairs_missing_from_flat: unmatchedRegistered.reduce((sum, row) => sum + Number(row.quantity || 0), 0),
  };
}

console.log(JSON.stringify({
  verified,
  table: 'inventory_items',
  records: rows.length,
  pairs: rows.reduce((sum, row) => sum + Number(row.cantidad || 0), 0),
  loaded,
  pending: rows.length - loaded,
  unique_styles: new Set(rows.map(row => String(row.estilo || '').trim().toUpperCase()).filter(Boolean)).size,
  rows_with_quantity_over_one: rows.filter(row => Number(row.cantidad || 0) > 1).length,
  rows_with_price: pricedRows.length,
  pairs_with_price: pricedRows.reduce((sum, row) => sum + Number(row.cantidad || 0), 0),
  inventory_value: value,
  invalid_legacy_origin: invalidLegacyOrigin,
  by_origin: byOrigin,
  registered_comparison: registeredComparison,
}, null, 2));

if (!verified) process.exitCode = 2;
