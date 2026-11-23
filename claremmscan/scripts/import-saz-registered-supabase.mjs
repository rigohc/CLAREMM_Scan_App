#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';

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
const inputPath = path.resolve(cli.input || '/tmp/claremm-saz-registered.json');
const env = { ...readEnv(path.resolve(cli.env || '.env.local')), ...process.env };
const url = String(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const apiKey = env.SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
const email = env.SUPABASE_MIGRATION_EMAIL || '';
const password = env.SUPABASE_MIGRATION_PASSWORD || '';
const apply = cli.apply === true;
if (!fs.existsSync(inputPath)) throw new Error(`No existe el paquete: ${inputPath}`);
const payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
if (!payload?.products?.length || !payload?.variants?.length) throw new Error('El paquete SAZ no es válido.');

console.log(JSON.stringify({ mode: apply ? 'APPLY' : 'DRY_RUN', input: inputPath, files: payload.files, union: payload.union }, null, 2));
if (!apply) process.exit(0);
if (!url || !apiKey || !email || !password) throw new Error('Faltan las variables o credenciales de Supabase.');

const authResponse = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
});
const auth = await authResponse.json();
if (!authResponse.ok || !auth.access_token || !auth.user?.id) throw new Error(`No se pudo autenticar: ${auth.error_description || auth.message || authResponse.status}`);
const token = auth.access_token, userId = auth.user.id;

async function rest(resource, { method = 'GET', body, prefer = '' } = {}) {
  const response = await fetch(`${url}/rest/v1/${resource}`, {
    method,
    headers: { apikey: apiKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text(), data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${method} ${resource}: ${data?.message || data?.details || text || response.status}`);
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

const chunks = (values, size = 150) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase().replace(/\s+/g, ' ');
const lookupKey = value => `${normalize(value.estilo)}|${normalize(value.color)}`;
const officialFields = ['estilo','color','precio','marca','proveedor','temporada','sublinea','departamento','clasificacion','linea','corrida','acabado','suela','plantilla','tacon','forro','catalogo','status','observaciones','costo'];
const productData = product => Object.fromEntries(officialFields.map(field => [field, product[field] ?? (['precio','costo'].includes(field) ? 0 : '')]));

const memberships = await rest(`organization_members?select=organization_id&user_id=eq.${encodeURIComponent(userId)}`);
const organizationIds = memberships.map(row => row.organization_id).join(',');
const organizations = await rest(`organizations?select=id,name&id=in.(${encodeURIComponent(organizationIds)})`);
const organization = organizations.find(row => normalize(row.name) === 'CLAREMM');
if (!organization) throw new Error('No se encontró la organización CLAREMM.');
const branches = await rest(`branches?select=id,code,name&organization_id=eq.${organization.id}&code=eq.JUAREZ`);
if (!branches.length) throw new Error('No se encontró la sucursal JUAREZ.');
const branch = branches[0];

const existingProducts = await allRows(`products?select=*&organization_id=eq.${organization.id}`);
const productsByLookup = new Map();
for (const product of existingProducts) {
  const key = lookupKey(product);
  if (!productsByLookup.has(key)) productsByLookup.set(key, []);
  productsByLookup.get(key).push(product);
}
const existingRegistry = await allRows(`saz_product_registry?select=*&organization_id=eq.${organization.id}`);
const registryByLookup = new Map(existingRegistry.map(row => [row.lookup_key, row]));
const existingProductById = new Map(existingProducts.map(row => [row.id, row]));

const productIds = new Map(), newProducts = [], matchedProducts = [];
let resolvedUnique = 0, resolvedProvider = 0, resolvedRegistry = 0, createdForAmbiguity = 0;
for (const product of payload.products) {
  const key = product.lookup_key;
  const registered = registryByLookup.get(key);
  if (registered && existingProductById.has(registered.product_id)) {
    productIds.set(key, registered.product_id); resolvedRegistry++; continue;
  }
  const candidates = productsByLookup.get(key) || [];
  let match = candidates.length === 1 ? candidates[0] : null;
  if (match) resolvedUnique++;
  if (!match && candidates.length > 1 && product.proveedor) {
    const providers = candidates.filter(candidate => normalize(candidate.proveedor) === normalize(product.proveedor));
    if (providers.length === 1) { match = providers[0]; resolvedProvider++; }
  }
  if (match) {
    productIds.set(key, match.id);
    matchedProducts.push({ id: match.id, data: productData(product) });
    continue;
  }
  if (candidates.length > 1) createdForAmbiguity++;
  newProducts.push({
    ...productData(product), organization_id: organization.id, source_system: 'saz_registered', source_id: key,
    match_key: key, activo: true,
  });
}

for (const group of chunks(newProducts)) {
  const saved = await rest('products?on_conflict=organization_id%2Csource_system%2Csource_id', {
    method: 'POST', body: group, prefer: 'resolution=merge-duplicates,return=representation',
  });
  for (const product of saved) productIds.set(product.source_id, product.id);
}
for (const product of matchedProducts) {
  await rest(`products?id=eq.${product.id}`, { method: 'PATCH', body: product.data, prefer: 'return=minimal' });
}
if (productIds.size !== payload.products.length) throw new Error(`Solo se resolvieron ${productIds.size} de ${payload.products.length} productos.`);

const registryRows = payload.products.map(product => ({
  organization_id: organization.id, product_id: productIds.get(product.lookup_key), lookup_key: product.lookup_key,
  estilo: product.estilo, color: product.color, source_files: product.source_files, last_registered_at: new Date().toISOString(),
}));
const registryIds = new Map();
for (const group of chunks(registryRows)) {
  const saved = await rest('saz_product_registry?on_conflict=organization_id%2Clookup_key', {
    method: 'POST', body: group, prefer: 'resolution=merge-duplicates,return=representation',
  });
  for (const row of saved) registryIds.set(row.lookup_key, row.id);
}

const variantRequests = payload.variants.map(row => ({ product_id: productIds.get(row.product_lookup_key), size: row.size }));
const variantIds = new Map();
for (const group of chunks(variantRequests)) {
  const saved = await rest('product_variants?on_conflict=product_id%2Csize', {
    method: 'POST', body: group, prefer: 'resolution=merge-duplicates,return=representation',
  });
  for (const row of saved) variantIds.set(`${row.product_id}|${row.size}`, row.id);
}

const requestedVariantIds = [...variantIds.values()];
const existingLevels = [];
for (const group of chunks(requestedVariantIds, 100)) {
  const ids = group.join(',');
  existingLevels.push(...await rest(`inventory_levels?select=variant_id,quantity&branch_id=eq.${branch.id}&variant_id=in.(${encodeURIComponent(ids)})`));
}
const previousByVariant = new Map(existingLevels.map(row => [row.variant_id, Number(row.quantity || 0)]));

const levels = payload.variants.map(row => {
  const productId = productIds.get(row.product_lookup_key), variantId = variantIds.get(`${productId}|${row.size}`);
  return { branch_id: branch.id, variant_id: variantId, quantity: row.quantity, updated_by: userId };
});
for (const group of chunks(levels)) {
  await rest('inventory_levels?on_conflict=branch_id%2Cvariant_id', {
    method: 'POST', body: group, prefer: 'resolution=merge-duplicates,return=minimal',
  });
}

const stockRows = payload.variants.map(row => {
  const productId = productIds.get(row.product_lookup_key), variantId = variantIds.get(`${productId}|${row.size}`);
  return {
    organization_id: organization.id, branch_id: branch.id, registry_id: registryIds.get(row.product_lookup_key),
    variant_id: variantId, size: row.size, quantity: row.quantity, source_files: row.source_files,
    registered_at: new Date().toISOString(),
  };
});
for (const group of chunks(stockRows)) {
  await rest('saz_registered_stock?on_conflict=branch_id%2Cregistry_id%2Csize', {
    method: 'POST', body: group, prefer: 'resolution=merge-duplicates,return=minimal',
  });
}

const movementRows = payload.variants.map(row => {
  const productId = productIds.get(row.product_lookup_key), variantId = variantIds.get(`${productId}|${row.size}`), previous = previousByVariant.get(variantId) || 0;
  return {
    organization_id: organization.id, branch_id: branch.id, variant_id: variantId, operation: previous ? 'set' : 'initial_import',
    previous_quantity: previous, quantity: row.quantity, new_quantity: row.quantity,
    reason: `Registrado en SAZ: ${row.source_files.join(', ')}`,
    import_key: `saz_registered:${branch.id}:${registryIds.get(row.product_lookup_key)}:${row.size}`,
    created_by: userId,
  };
});
for (const group of chunks(movementRows)) {
  await rest('inventory_movements_relational?on_conflict=import_key', {
    method: 'POST', body: group, prefer: 'resolution=merge-duplicates,return=minimal',
  });
}

const dateFromFile = file => {
  const match = file.match(/(\d{2})_(\d{2})_(\d{2})/);
  return match ? `20${match[3]}-${match[2]}-${match[1]}` : null;
};
const batchRows = payload.files.map(file => ({
  organization_id: organization.id, branch_id: branch.id, source_file: file.file, registered_on: dateFromFile(file.file),
  product_count: file.products, variant_count: file.variants, pair_count: file.pairs,
  validation_notes: file.total_mismatches, imported_by: userId,
}));
await rest('saz_registration_batches?on_conflict=organization_id%2Cbranch_id%2Csource_file', {
  method: 'POST', body: batchRows, prefer: 'resolution=merge-duplicates,return=minimal',
});

const flatRows = await allRows('inventory_items?select=item_key,estilo,color,talla,saz_cargado');
const officialKeys = new Set(payload.variants.map(row => row.lookup_key));
const matchingFlat = flatRows.filter(row => officialKeys.has(`${normalize(row.estilo)}|${normalize(row.color)}|${normalize(row.talla)}`));
const markedAt = new Date().toISOString();
for (const row of matchingFlat) {
  await rest(`inventory_items?user_id=eq.${userId}&item_key=eq.${encodeURIComponent(row.item_key)}`, {
    method: 'PATCH', body: { saz_cargado: true, saz_cargado_at: markedAt }, prefer: 'return=minimal',
  });
}

console.log(JSON.stringify({
  completed: true,
  organization: organization.name,
  branch: branch.name,
  registered_products: payload.union.products,
  registered_variants: payload.union.variants,
  registered_pairs: payload.union.pairs_using_max_per_variant,
  product_resolution: { registry: resolvedRegistry, unique: resolvedUnique, provider: resolvedProvider, new: newProducts.length, created_for_ambiguity: createdForAmbiguity },
  flat_rows_marked_loaded: matchingFlat.length,
}, null, 2));
