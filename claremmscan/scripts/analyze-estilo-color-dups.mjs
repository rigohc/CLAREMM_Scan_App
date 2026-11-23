#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceDir = path.resolve(scriptDir, '../..');

function readEnv(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/).flatMap(line => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1].startsWith('#')) return [];
    return [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]];
  }));
}

const env = { ...readEnv(path.resolve(scriptDir, '../.env.local')), ...process.env };
const url = String(env.SUPABASE_URL || '').replace(/\/$/, '');
const apiKey = env.SUPABASE_PUBLISHABLE_KEY || '';
const email = String(env.SUPABASE_MIGRATION_EMAIL || '').trim();
const password = String(env.SUPABASE_MIGRATION_PASSWORD || '').trim();
if (!url || !apiKey || !email || !password) throw new Error('Faltan credenciales de Supabase.');

const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase().replace(/\s+/g, ' ');
const compactEstilo = value => normalize(value).replace(/^0+(?=\d)/, '');
const compactKey = (estilo, color) => `${compactEstilo(estilo)}|${normalize(color)}`;
const chunks = (values, size = 150) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
const blank = value => !normalize(value) || normalize(value) === 'NAN';

const authResponse = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: apiKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const auth = await authResponse.json();
if (!authResponse.ok || !auth.access_token) throw new Error(`Auth: ${auth.error_description || auth.message || authResponse.status}`);
const token = auth.access_token;
const userId = auth.user.id;
const headers = { apikey: apiKey, Authorization: `Bearer ${token}` };

async function rest(resource) {
  const response = await fetch(`${url}/rest/v1/${resource}`, { headers });
  const body = await response.json();
  if (!response.ok) throw new Error(`${resource}: ${body.message || response.status}`);
  return body;
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
const organization = (await rest(`organizations?select=id,name&id=in.(${memberships.map(row => row.organization_id).join(',')})`)).find(row => normalize(row.name) === 'CLAREMM');
const branches = await allRows(`branches?select=id,code,name&organization_id=eq.${organization.id}`);
const juarez = branches.find(row => row.code === 'JUAREZ');
const [products, variants] = await Promise.all([
  allRows(`products?select=id,estilo,color,marca,proveedor,linea,acabado,corrida,precio,imagen,source_system,source_id,activo&organization_id=eq.${organization.id}`),
  allRows('product_variants?select=id,product_id,size'),
]);
const productIds = new Set(products.map(product => product.id));
const orgVariants = variants.filter(variant => productIds.has(variant.product_id));
const levels = [];
for (const group of chunks(orgVariants.map(variant => variant.id), 200)) {
  levels.push(...await rest(`inventory_levels?select=branch_id,variant_id,quantity&variant_id=in.(${group.join(',')})`));
}
const variantsByProduct = new Map();
for (const variant of orgVariants) {
  if (!variantsByProduct.has(variant.product_id)) variantsByProduct.set(variant.product_id, []);
  variantsByProduct.get(variant.product_id).push(variant);
}
const qtyByVariant = new Map(levels.filter(level => level.branch_id === juarez.id).map(level => [level.variant_id, Number(level.quantity || 0)]));
function stockOf(productId) {
  const result = {};
  let pairs = 0;
  for (const variant of variantsByProduct.get(productId) || []) {
    const quantity = qtyByVariant.get(variant.id) || 0;
    if (quantity > 0) {
      result[String(variant.size)] = quantity;
      pairs += quantity;
    }
  }
  return { sizes: result, pairs };
}

const groups = new Map();
for (const product of products) {
  const key = compactKey(product.estilo, product.color);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(product);
}

function score(product) {
  const stock = stockOf(product.id);
  return (
    (Number(product.precio) > 0 ? 1000 : 0) +
    (String(product.imagen || '').trim() ? 400 : 0) +
    (product.source_system === 'saz_registered' ? 200 : 0) +
    (/^0+\d/.test(String(product.estilo || '')) ? 80 : 0) +
    (product.activo === false ? -500 : 0) +
    (!blank(product.marca) ? 20 : 0) +
    (!blank(product.linea) ? 10 : 0) +
    (!blank(product.acabado) ? 10 : 0) +
    Math.min(stock.pairs, 50)
  );
}

const duplicates = [];
for (const [key, group] of groups) {
  const active = group.filter(product => product.activo !== false);
  if (active.length < 2 && group.length < 2) continue;
  if (group.length < 2) continue;
  const ranked = [...group].sort((a, b) => score(b) - score(a));
  const canonical = ranked[0];
  const others = ranked.slice(1);
  const prices = [...new Set(group.map(product => Number(product.precio)).filter(price => price > 0))];
  const marcas = [...new Set(group.map(product => normalize(product.marca) || '(vacío)'))];
  const lineas = [...new Set(group.map(product => normalize(product.linea) || '(vacío)'))];
  const acabados = [...new Set(group.map(product => normalize(product.acabado) || '(vacío)'))];
  const estilos = [...new Set(group.map(product => String(product.estilo)))];
  const sources = [...new Set(group.map(product => product.source_system))];
  const conflict = prices.length > 1;
  const sizeUnion = {};
  const sizeOverlap = [];
  for (const product of group) {
    const stock = stockOf(product.id);
    for (const [size, quantity] of Object.entries(stock.sizes)) {
      if (sizeUnion[size]) sizeOverlap.push({ size, from: product.estilo, add: quantity, already: sizeUnion[size] });
      sizeUnion[size] = (sizeUnion[size] || 0) + quantity;
    }
  }
  duplicates.push({
    key,
    estilos,
    color: normalize(canonical.color),
    count: group.length,
    active: active.length,
    conflict,
    prices,
    marcas,
    lineas,
    acabados,
    sources,
    canonical: {
      id: canonical.id, estilo: canonical.estilo, marca: canonical.marca, linea: canonical.linea,
      acabado: canonical.acabado, precio: Number(canonical.precio), imagen: Boolean(String(canonical.imagen || '').trim()),
      source_system: canonical.source_system, activo: canonical.activo !== false, pairs: stockOf(canonical.id).pairs,
    },
    others: others.map(product => ({
      id: product.id, estilo: product.estilo, marca: product.marca, linea: product.linea,
      acabado: product.acabado, precio: Number(product.precio), imagen: Boolean(String(product.imagen || '').trim()),
      source_system: product.source_system, activo: product.activo !== false, pairs: stockOf(product.id).pairs,
      sizes: stockOf(product.id).sizes,
    })),
    merged_pairs: Object.values(sizeUnion).reduce((sum, quantity) => sum + quantity, 0),
    overlapping_sizes: sizeOverlap,
    attr_diff: { marca: marcas.length > 1, linea: lineas.length > 1, acabado: acabados.length > 1, estilo: estilos.length > 1 },
  });
}

duplicates.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
const safe = duplicates.filter(row => !row.conflict);
const conflicts = duplicates.filter(row => row.conflict);
const report = {
  generated_at: new Date().toISOString(),
  products: products.length,
  unique_estilo_color: groups.size,
  duplicate_groups: duplicates.length,
  safe_to_merge: safe.length,
  price_conflicts: conflicts.length,
  extra_fichas: duplicates.reduce((sum, row) => sum + row.count - 1, 0),
  juarez_pairs_in_dups: duplicates.reduce((sum, row) => sum + row.merged_pairs, 0),
  attr_variation: {
    marca: duplicates.filter(row => row.attr_diff.marca).length,
    linea: duplicates.filter(row => row.attr_diff.linea).length,
    acabado: duplicates.filter(row => row.attr_diff.acabado).length,
    leading_zero: duplicates.filter(row => row.attr_diff.estilo).length,
  },
  conflicts: conflicts.map(row => ({
    key: row.key, prices: row.prices, canonical: row.canonical, others: row.others, marcas: row.marcas, lineas: row.lineas,
  })),
  safe_preview: safe.map(row => ({
    key: row.key,
    keep: `${row.canonical.estilo} ${row.color} ${row.canonical.marca} $${row.canonical.precio} ${row.canonical.imagen ? 'img' : 'no-img'} ${row.canonical.pairs}p`,
    merge: row.others.map(product => `${product.estilo} ${product.marca || '—'} $${product.precio} ${product.pairs}p ${product.activo ? '' : '(inactivo)'}`),
    marcas: row.marcas,
    lineas: row.lineas,
    acabados: row.acabados,
    overlapping_sizes: row.overlapping_sizes,
    merged_pairs: row.merged_pairs,
  })),
};
const output = path.join(workspaceDir, 'entregables/estilo-color-duplicados.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({ ...report, groups: duplicates }, null, 2));
console.log(JSON.stringify({
  output,
  products: report.products,
  unique_estilo_color: report.unique_estilo_color,
  duplicate_groups: report.duplicate_groups,
  safe_to_merge: report.safe_to_merge,
  price_conflicts: report.price_conflicts,
  extra_fichas: report.extra_fichas,
  attr_variation: report.attr_variation,
  conflict_keys: conflicts.map(row => `${row.key} precios ${row.prices.join('/')}`),
  sample_safe: report.safe_preview.slice(0, 15),
}, null, 2));
