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
const url = String(env.SUPABASE_URL || '').replace(/\/$/, '');
const apiKey = env.SUPABASE_PUBLISHABLE_KEY || '';
const email = env.SUPABASE_MIGRATION_EMAIL || '';
const password = env.SUPABASE_MIGRATION_PASSWORD || '';
if (!url || !apiKey || !email || !password) throw new Error('Faltan variables o credenciales de Supabase.');

const authResponse = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
const auth = await authResponse.json();
if (!authResponse.ok || !auth.access_token) throw new Error(`No se pudo autenticar: ${auth.error_description || auth.message || authResponse.status}`);
const headers = { apikey: apiKey, Authorization: `Bearer ${auth.access_token}` };
async function rest(resource) {
  const response = await fetch(`${url}/rest/v1/${resource}`, { headers });
  const body = await response.json();
  if (!response.ok) throw new Error(`${resource}: ${body.message || response.status}`);
  return body;
}
async function allRows(resource) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await rest(`${resource}${resource.includes('?') ? '&' : '?'}limit=1000&offset=${offset}`);
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

const memberships = await rest(`organization_members?select=organization_id&user_id=eq.${auth.user.id}`);
const organizations = await rest(`organizations?select=id,name&id=in.(${memberships.map(row => row.organization_id).join(',')})`);
const organization = organizations.find(row => String(row.name).trim().toUpperCase() === 'CLAREMM') || organizations[0];
if (!organization) throw new Error('No se encontró una organización accesible.');
const [branches, products, registry, variants] = await Promise.all([
  rest(`branches?select=id,code,name,active&organization_id=eq.${organization.id}&active=eq.true&order=name`),
  allRows(`products?select=id,estilo,color&organization_id=eq.${organization.id}&activo=eq.true`),
  allRows(`saz_product_registry?select=product_id,lookup_key&organization_id=eq.${organization.id}`),
  allRows(`product_variants?select=id,product_id,size,products!inner(organization_id)&products.organization_id=eq.${organization.id}`),
]);
const eligible = branches.filter(branch => String(branch.code).toUpperCase() !== 'JUAREZ' && String(branch.name).toUpperCase() !== 'CLAREMM ZAPATERIA JUAREZ');
console.log(JSON.stringify({ verified: true, organization: organization.name, active_branches: branches.map(({ code, name }) => ({ code, name })), eligible_branch_count: eligible.length, catalog_products: products.length, official_registry_keys: registry.length, product_variants: variants.length }, null, 2));
