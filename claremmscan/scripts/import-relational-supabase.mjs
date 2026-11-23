#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';

function argsFrom(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    values[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
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
const inputPath = path.resolve(cli.input || '/tmp/claremm-relational-import.json');
const env = { ...readEnv(path.resolve(cli.env || '.env.local')), ...process.env };
const url = String(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const apiKey = env.SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
const email = env.SUPABASE_MIGRATION_EMAIL || cli.email || '';
const password = env.SUPABASE_MIGRATION_PASSWORD || env.SUPABASE_PASSWORD || '';
const apply = cli.apply === true;

if (!fs.existsSync(inputPath)) throw new Error(`No existe el paquete: ${inputPath}`);
const payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
if (!payload?.products?.length || !payload?.branch?.code) throw new Error('El paquete relacional no es válido.');

console.log(JSON.stringify({
  mode: apply ? 'APPLY' : 'DRY_RUN', input: inputPath, organization: payload.organization,
  branch: payload.branch, summary: payload.summary,
}, null, 2));

if (!apply) {
  console.log('\nValidación correcta. Para escribir en Supabase usa --apply y configura SUPABASE_MIGRATION_EMAIL/SUPABASE_MIGRATION_PASSWORD.');
  process.exit(0);
}

if (!url || !apiKey || !email || !password) {
  throw new Error('Faltan SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_MIGRATION_EMAIL o SUPABASE_MIGRATION_PASSWORD.');
}

const authResponse = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: apiKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const auth = await authResponse.json();
if (!authResponse.ok || !auth.access_token || !auth.user?.id) throw new Error(`No se pudo autenticar: ${auth.error_description || auth.msg || auth.message || authResponse.status}`);
const token = auth.access_token, userId = auth.user.id;

async function rest(resource, { method = 'GET', body, prefer = '', headers = {} } = {}) {
  const response = await fetch(`${url}/rest/v1/${resource}`, {
    method,
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${method} ${resource}: ${data?.message || data?.details || text || response.status}`);
  return data;
}

const chunk = (values, size = 150) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
const sourceKey = value => `${value.source_system}|${value.source_id}`;

async function resolveOrganization() {
  const memberships = await rest(`organization_members?select=organization_id,role&user_id=eq.${encodeURIComponent(userId)}`);
  if (memberships.length) {
    const ids = memberships.map(item => item.organization_id).join(',');
    const organizations = await rest(`organizations?select=id,name&id=in.(${encodeURIComponent(ids)})`);
    const match = organizations.find(item => item.name.toLocaleUpperCase() === payload.organization.name.toLocaleUpperCase());
    if (match) return match;
  }
  const [organization] = await rest('organizations', {
    method: 'POST', body: { name: payload.organization.name, created_by: userId }, prefer: 'return=representation',
  });
  await rest('organization_members', {
    method: 'POST', body: { organization_id: organization.id, user_id: userId, role: 'admin', is_default: true }, prefer: 'return=minimal',
  });
  return organization;
}

const organization = await resolveOrganization();
const [branch] = await rest('branches?on_conflict=organization_id%2Ccode', {
  method: 'POST',
  body: { organization_id: organization.id, code: payload.branch.code, name: payload.branch.name, active: true },
  prefer: 'resolution=merge-duplicates,return=representation',
});

const productIds = new Map();
let processed = 0;
for (const group of chunk(payload.products)) {
  const rows = group.map(product => ({ ...product, organization_id: organization.id }));
  const saved = await rest('products?on_conflict=organization_id%2Csource_system%2Csource_id', {
    method: 'POST', body: rows, prefer: 'resolution=merge-duplicates,return=representation',
  });
  for (const row of saved) productIds.set(sourceKey(row), row.id);
  processed += group.length;
  console.log(`Productos: ${processed}/${payload.products.length}`);
}

const variantRequests = new Map();
for (const row of [...payload.inventory, ...payload.movements]) {
  const productId = productIds.get(sourceKey(row));
  if (!productId) throw new Error(`No se encontró el producto ${sourceKey(row)}.`);
  variantRequests.set(`${productId}|${row.size}`, { product_id: productId, size: String(row.size) });
}
const variants = [...variantRequests.values()], variantIds = new Map();
processed = 0;
for (const group of chunk(variants)) {
  const saved = await rest('product_variants?on_conflict=product_id%2Csize', {
    method: 'POST', body: group, prefer: 'resolution=merge-duplicates,return=representation',
  });
  for (const row of saved) variantIds.set(`${row.product_id}|${row.size}`, row.id);
  processed += group.length;
  console.log(`Tallas: ${processed}/${variants.length}`);
}

const levels = payload.inventory.map(row => {
  const productId = productIds.get(sourceKey(row)), variantId = variantIds.get(`${productId}|${row.size}`);
  return { branch_id: branch.id, variant_id: variantId, quantity: row.quantity, updated_by: userId };
});
processed = 0;
for (const group of chunk(levels)) {
  await rest('inventory_levels?on_conflict=branch_id%2Cvariant_id', {
    method: 'POST', body: group, prefer: 'resolution=merge-duplicates,return=minimal',
  });
  processed += group.length;
  console.log(`Existencias: ${processed}/${levels.length}`);
}

const movementRows = payload.movements.map(row => {
  const productId = productIds.get(sourceKey(row)), variantId = variantIds.get(`${productId}|${row.size}`);
  return {
    organization_id: organization.id, branch_id: branch.id, variant_id: variantId, operation: row.operation,
    previous_quantity: row.previous_quantity, quantity: row.quantity, new_quantity: row.new_quantity,
    reason: row.reason, import_key: `${row.source_system}:${row.source_movement_id}`, created_by: userId,
    created_at: row.created_at || new Date().toISOString(),
  };
});
processed = 0;
for (const group of chunk(movementRows)) {
  await rest('inventory_movements_relational?on_conflict=import_key', {
    method: 'POST', body: group, prefer: 'resolution=merge-duplicates,return=minimal',
  });
  processed += group.length;
  console.log(`Movimientos: ${processed}/${movementRows.length}`);
}

await rest('inventory_migration_runs', {
  method: 'POST',
  body: {
    organization_id: organization.id, branch_id: branch.id, source_summary: payload.summary.sources,
    product_count: payload.summary.products, variant_count: payload.summary.variants_with_stock,
    pair_count: payload.summary.pairs, created_by: userId,
  },
  prefer: 'return=minimal',
});

console.log(JSON.stringify({
  completed: true, organization_id: organization.id, branch_id: branch.id,
  products: payload.products.length, variants: variants.length, pairs: payload.summary.pairs, movements: movementRows.length,
}, null, 2));

