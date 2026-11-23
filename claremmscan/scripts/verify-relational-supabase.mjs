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
const organization = organizations.find(row => String(row.name).toLocaleUpperCase() === 'CLAREMM');
if (!organization) throw new Error('No se encontró la organización CLAREMM.');
const branches = await rest(`branches?select=id,code,name&organization_id=eq.${organization.id}&code=eq.JUAREZ`);
if (!branches.length) throw new Error('No se encontró la sucursal JUAREZ.');
const branch = branches[0];

const [products, levels, movements] = await Promise.all([
  allRows(`products?select=id&organization_id=eq.${organization.id}`),
  allRows(`inventory_levels?select=variant_id,quantity&branch_id=eq.${branch.id}`),
  allRows(`inventory_movements_relational?select=id&organization_id=eq.${organization.id}`),
]);
const pairs = levels.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
const expected = { products: 1136, stock_rows: 2821, pairs: 3330, movements: 388 };
const actual = { products: products.length, stock_rows: levels.length, pairs, movements: movements.length };
const checks = Object.fromEntries(Object.keys(expected).map(key => [key, actual[key] === expected[key]]));

console.log(JSON.stringify({
  verified: Object.values(checks).every(Boolean),
  organization: organization.name,
  branch: { code: branch.code, name: branch.name },
  expected,
  actual,
  checks,
}, null, 2));

if (!Object.values(checks).every(Boolean)) process.exitCode = 2;
