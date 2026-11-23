#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';

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

if (!url || !apiKey || !email || !password) {
  throw new Error('Faltan las variables de Supabase o las credenciales de migración.');
}

const authResponse = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: apiKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const auth = await authResponse.json();
if (!authResponse.ok || !auth.access_token || !auth.user?.id) {
  throw new Error(`No se pudo autenticar: ${auth.error_description || auth.msg || auth.message || authResponse.status}`);
}

async function rest(resource) {
  const response = await fetch(`${url}/rest/v1/${resource}`, {
    headers: { apikey: apiKey, Authorization: `Bearer ${auth.access_token}` },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`GET ${resource}: ${data?.message || data?.details || text || response.status}`);
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

const memberships = await rest(`organization_members?select=organization_id&user_id=eq.${encodeURIComponent(auth.user.id)}`);
if (!memberships.length) throw new Error('La cuenta no pertenece a ninguna organización.');
const organizationIds = memberships.map(row => row.organization_id).join(',');
const organizations = await rest(`organizations?select=id,name&id=in.(${encodeURIComponent(organizationIds)})`);
const organization = organizations.find(row => String(row.name).trim().toUpperCase() === 'CLAREMM');
if (!organization) throw new Error('No se encontró la organización CLAREMM.');
const branches = await rest(`branches?select=id,code,name&organization_id=eq.${organization.id}&code=eq.JUAREZ`);
if (!branches.length) throw new Error('No se encontró la sucursal JUAREZ.');
const branch = branches[0];

const [summaryRows, batches, registry, registeredStock, levels, flatRows] = await Promise.all([
  rest(`saz_registration_summary?select=registered_products,registered_variants,registered_pairs&branch_id=eq.${branch.id}`),
  allRows(`saz_registration_batches?select=source_file,product_count,variant_count,pair_count&organization_id=eq.${organization.id}&branch_id=eq.${branch.id}&order=source_file`),
  allRows(`saz_product_registry?select=id&organization_id=eq.${organization.id}`),
  allRows(`saz_registered_stock?select=quantity&organization_id=eq.${organization.id}&branch_id=eq.${branch.id}`),
  allRows(`inventory_levels?select=quantity&branch_id=eq.${branch.id}`),
  allRows('inventory_items?select=cantidad,saz_cargado'),
]);

const summary = summaryRows[0] || {};
const registeredPairs = registeredStock.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
const relationalPairs = levels.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
const flatLoaded = flatRows.filter(row => row.saz_cargado);
const flatPending = flatRows.filter(row => !row.saz_cargado);
const loadedPairs = flatLoaded.reduce((sum, row) => sum + Number(row.cantidad || 0), 0);
const pendingPairs = flatPending.reduce((sum, row) => sum + Number(row.cantidad || 0), 0);
const expected = {
  batches: 3,
  catalog_products: 236,
  products_with_stock: 234,
  registered_variants: 736,
  registered_pairs: 920,
};
const actual = {
  batches: batches.length,
  catalog_products: registry.length,
  products_with_stock: Number(summary.registered_products || 0),
  registered_variants: registeredStock.length,
  registered_pairs: registeredPairs,
};
const checks = {
  batches: actual.batches === expected.batches,
  catalog_products: actual.catalog_products === expected.catalog_products,
  products_with_stock: actual.products_with_stock === expected.products_with_stock,
  registered_variants: actual.registered_variants === expected.registered_variants,
  registered_pairs: actual.registered_pairs === expected.registered_pairs,
  summary_matches: Number(summary.registered_products || 0) === expected.products_with_stock
    && Number(summary.registered_variants || 0) === expected.registered_variants
    && Number(summary.registered_pairs || 0) === expected.registered_pairs,
};

console.log(JSON.stringify({
  verified: Object.values(checks).every(Boolean),
  organization: organization.name,
  branch: { code: branch.code, name: branch.name },
  expected,
  actual,
  checks,
  summary_view: summaryRows,
  batches,
  relational_inventory: { rows: levels.length, pairs: relationalPairs },
  legacy_flat_inventory: {
    rows: flatRows.length,
    pairs: loadedPairs + pendingPairs,
    loaded_rows: flatLoaded.length,
    loaded_pairs: loadedPairs,
    pending_rows: flatPending.length,
    pending_pairs: pendingPairs,
  },
}, null, 2));

if (!Object.values(checks).every(Boolean)) process.exitCode = 2;
