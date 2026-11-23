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

const style = String(process.argv[2] || '').trim().toUpperCase();
if (!style) throw new Error('Uso: node scripts/inspect-style-supabase.mjs ESTILO');
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

const memberships = await rest(`organization_members?select=organization_id&user_id=eq.${auth.user.id}`);
const organizationIds = memberships.map(row => row.organization_id);
const products = organizationIds.length ? await rest(`products?select=id,organization_id,estilo,color,marca,linea,acabado,precio,source_system,source_id&organization_id=in.(${organizationIds.join(',')})&estilo=ilike.${encodeURIComponent(style)}`) : [];
const productIds = products.map(row => row.id);
const variants = productIds.length ? await rest(`product_variants?select=id,product_id,size&product_id=in.(${productIds.join(',')})&order=size`) : [];
const variantIds = variants.map(row => row.id);
const [branches, levels, registry, registeredStock, flatRows] = await Promise.all([
  organizationIds.length ? rest(`branches?select=id,code,name&organization_id=in.(${organizationIds.join(',')})`) : [],
  variantIds.length ? rest(`inventory_levels?select=branch_id,variant_id,quantity&variant_id=in.(${variantIds.join(',')})`) : [],
  productIds.length ? rest(`saz_product_registry?select=id,product_id,lookup_key&product_id=in.(${productIds.join(',')})`) : [],
  variantIds.length ? rest(`saz_registered_stock?select=branch_id,variant_id,size,quantity&variant_id=in.(${variantIds.join(',')})`) : [],
  rest(`inventory_items?select=item_key,sucursal,estilo,color,talla,cantidad,precio,saz_cargado&user_id=eq.${auth.user.id}&estilo=ilike.${encodeURIComponent(style)}`),
]);
const branchById = new Map(branches.map(branch => [branch.id, branch]));
const variantById = new Map(variants.map(variant => [variant.id, variant]));
const relationalStock = levels.map(level => ({
  branch: branchById.get(level.branch_id)?.name || level.branch_id,
  product_id: variantById.get(level.variant_id)?.product_id || '',
  size: variantById.get(level.variant_id)?.size || '',
  quantity: Number(level.quantity || 0),
}));
console.log(JSON.stringify({ style, products, variants, relational_stock: relationalStock, registered_stock: registeredStock, registry, legacy_inventory_items: flatRows }, null, 2));
