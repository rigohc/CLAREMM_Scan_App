#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceDir = path.resolve(scriptDir, '../..');

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
const apply = cli.apply === true;
const outputPath = path.resolve(cli.output || path.join(workspaceDir, 'entregables/estilo-color-consolidacion.json'));
const env = { ...readEnv(path.resolve(scriptDir, '../.env.local')), ...process.env };
const url = String(env.SUPABASE_URL || '').replace(/\/$/, '');
const apiKey = env.SUPABASE_PUBLISHABLE_KEY || '';
const email = String(env.SUPABASE_MIGRATION_EMAIL || '').trim();
const password = String(env.SUPABASE_MIGRATION_PASSWORD || '').trim();
if (!url || !apiKey || !email || !password) throw new Error('Faltan credenciales de Supabase.');

const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase().replace(/\s+/g, ' ');
const compactEstilo = value => normalize(value).replace(/^0+(?=\d)/, '');
const compactKey = (estilo, color) => `${compactEstilo(estilo)}|${normalize(color)}`;
const blank = value => !normalize(value) || normalize(value) === 'NAN';
const genericBrand = value => blank(value) || normalize(value) === 'CLAREMM';
const sizeKey = value => {
  const number = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(number) ? number.toFixed(1) : String(value ?? '').trim();
};
const chunks = (values, size = 150) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));

const authResponse = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: apiKey, 'Content-Type': 'application/json' },
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
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
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

const memberships = await rest(`organization_members?select=organization_id&user_id=eq.${encodeURIComponent(userId)}`);
const organization = (await rest(`organizations?select=id,name&id=in.(${memberships.map(row => row.organization_id).join(',')})`)).find(row => normalize(row.name) === 'CLAREMM');
if (!organization) throw new Error('No se encontró la organización CLAREMM.');
const branches = await allRows(`branches?select=id,code,name,active&organization_id=eq.${organization.id}`);
const juarez = branches.find(row => row.code === 'JUAREZ') || branches[0];
const [products, variants, registry] = await Promise.all([
  allRows(`products?select=id,estilo,color,marca,proveedor,linea,acabado,corrida,precio,imagen,source_system,source_id,match_key,activo&organization_id=eq.${organization.id}`),
  allRows('product_variants?select=id,product_id,size'),
  allRows(`saz_product_registry?select=id,product_id,lookup_key,estilo,color&organization_id=eq.${organization.id}`),
]);
const productIds = new Set(products.map(product => product.id));
const orgVariants = variants.filter(variant => productIds.has(variant.product_id));
const levels = [];
for (const group of chunks(orgVariants.map(variant => variant.id), 200)) {
  if (!group.length) continue;
  levels.push(...await rest(`inventory_levels?select=branch_id,variant_id,quantity&variant_id=in.(${group.join(',')})`));
}

const variantsByProduct = new Map();
for (const variant of orgVariants) {
  if (!variantsByProduct.has(variant.product_id)) variantsByProduct.set(variant.product_id, []);
  variantsByProduct.get(variant.product_id).push(variant);
}
const levelKey = (branchId, variantId) => `${branchId}|${variantId}`;
const levelsByVariant = new Map(levels.map(level => [levelKey(level.branch_id, level.variant_id), Number(level.quantity || 0)]));

function stockBySize(productId, branchId = juarez.id) {
  const result = new Map();
  for (const variant of variantsByProduct.get(productId) || []) {
    const quantity = levelsByVariant.get(levelKey(branchId, variant.id)) || 0;
    if (quantity <= 0) continue;
    const key = sizeKey(variant.size);
    result.set(key, (result.get(key) || 0) + quantity);
  }
  return result;
}

function pairsOf(productId, branchId = juarez.id) {
  return [...stockBySize(productId, branchId).values()].reduce((sum, quantity) => sum + quantity, 0);
}

function findVariant(productId, size) {
  const key = sizeKey(size);
  return (variantsByProduct.get(productId) || []).find(variant => sizeKey(variant.size) === key) || null;
}

function score(product) {
  const stock = pairsOf(product.id);
  return (
    (Number(product.precio) > 0 ? 1000 : 0) +
    (String(product.imagen || '').trim() ? 400 : 0) +
    (product.source_system === 'saz_registered' ? 220 : 0) +
    (/^0+\d/.test(String(product.estilo || '')) ? 80 : 0) +
    (product.activo === false ? -800 : 0) +
    (!genericBrand(product.marca) ? 25 : 0) +
    (!blank(product.linea) ? 10 : 0) +
    (!blank(product.acabado) ? 10 : 0) +
    Math.min(stock, 80)
  );
}

function pickCanonical(group) {
  const active = group.filter(product => product.activo !== false);
  const pool = active.length ? active : group;
  return [...pool].sort((left, right) => score(right) - score(left) || String(left.id).localeCompare(String(right.id)))[0];
}

function preferredText(current, incoming) {
  if (!blank(incoming) && (blank(current) || (genericBrand(current) && !genericBrand(incoming)))) return incoming;
  return null;
}

const groups = new Map();
for (const product of products) {
  const key = compactKey(product.estilo, product.color);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(product);
}

const plans = [];
for (const [key, group] of groups) {
  if (group.length < 2) continue;
  const canonical = pickCanonical(group);
  const duplicates = group.filter(product => product.id !== canonical.id);
  const prices = [...new Set(group.map(product => Number(product.precio)).filter(price => price > 0))];
  const patch = {};
  const donorPrice = duplicates.map(product => Number(product.precio)).find(price => price > 0);
  if (!(Number(canonical.precio) > 0) && donorPrice > 0) patch.precio = donorPrice;
  const donorImage = duplicates.find(product => String(product.imagen || '').trim());
  if (!String(canonical.imagen || '').trim() && donorImage) patch.imagen = donorImage.imagen;
  for (const field of ['marca', 'linea', 'acabado', 'proveedor']) {
    const incoming = duplicates.map(product => product[field]).find(value => !blank(value) && (field !== 'marca' || !genericBrand(value)));
    const next = preferredText(canonical[field], incoming);
    if (next) patch[field] = next;
  }
  if (/^0+\d/.test(String(canonical.estilo || '')) === false) {
    const padded = group.find(product => /^0+\d/.test(String(product.estilo || '')) && compactEstilo(product.estilo) === compactEstilo(canonical.estilo));
    if (padded) patch.estilo = padded.estilo;
  }
  patch.match_key = key;
  const sizeMoves = [];
  const running = stockBySize(canonical.id);
  for (const duplicate of duplicates) {
    const duplicateStock = stockBySize(duplicate.id);
    const inactive = duplicate.activo === false;
    const sameSource = duplicate.source_system === canonical.source_system;
    for (const [size, quantity] of duplicateStock) {
      const already = running.get(size) || 0;
      const ghost = inactive && already > 0;
      let add = 0;
      let rule = 'zero';
      if (!ghost) {
        if (already <= 0) {
          add = quantity;
          rule = 'new_size';
        } else if (sameSource) {
          add = quantity;
          rule = 'sum_same_source';
        } else {
          add = Math.max(0, quantity - already);
          rule = 'max_mixed_source';
        }
      } else {
        rule = 'ghost_inactive';
      }
      sizeMoves.push({
        duplicate_id: duplicate.id,
        duplicate_estilo: duplicate.estilo,
        duplicate_source: duplicate.source_system,
        duplicate_activo: !inactive,
        size,
        from_quantity: quantity,
        canonical_before: already,
        add,
        canonical_after: already + add,
        ghost,
        rule,
      });
      if (add) running.set(size, already + add);
    }
  }
  plans.push({
    key,
    color: normalize(canonical.color),
    conflict: prices.length > 1,
    prices,
    canonical: {
      id: canonical.id,
      estilo: canonical.estilo,
      marca: canonical.marca,
      linea: canonical.linea,
      acabado: canonical.acabado,
      precio: Number(canonical.precio),
      imagen: Boolean(String(canonical.imagen || '').trim()),
      source_system: canonical.source_system,
      pairs: pairsOf(canonical.id),
    },
    duplicates: duplicates.map(product => ({
      id: product.id,
      estilo: product.estilo,
      marca: product.marca,
      linea: product.linea,
      acabado: product.acabado,
      precio: Number(product.precio),
      source_system: product.source_system,
      activo: product.activo !== false,
      pairs: pairsOf(product.id),
    })),
    patch,
    sizeMoves,
    added_pairs: sizeMoves.reduce((sum, row) => sum + row.add, 0),
    ghost_pairs: sizeMoves.filter(row => row.ghost).reduce((sum, row) => sum + row.from_quantity, 0),
  });
}

plans.sort((left, right) => Number(right.conflict) - Number(left.conflict) || left.key.localeCompare(right.key));
const juarezBefore = levels.filter(level => level.branch_id === juarez.id).reduce((sum, level) => sum + Number(level.quantity || 0), 0);
const report = {
  generated_at: new Date().toISOString(),
  mode: apply ? 'APPLY' : 'DRY_RUN',
  organization: { id: organization.id, name: organization.name },
  branch: { id: juarez.id, code: juarez.code, name: juarez.name },
  summary: {
    products: products.length,
    unique_estilo_color: groups.size,
    duplicate_groups: plans.length,
    price_conflicts_kept_canonical: plans.filter(plan => plan.conflict).length,
    fichas_to_deactivate: plans.reduce((sum, plan) => sum + plan.duplicates.length, 0),
    pairs_to_add: plans.reduce((sum, plan) => sum + plan.added_pairs, 0),
    ghost_pairs_zeroed_not_added: plans.reduce((sum, plan) => sum + plan.ghost_pairs, 0),
    juarez_pairs_before: juarezBefore,
    juarez_pairs_after_expected: juarezBefore + plans.reduce((sum, plan) => (
      sum + plan.sizeMoves.reduce((inner, row) => inner + Number(row.add || 0) - Number(row.from_quantity || 0), 0)
    ), 0),
  },
  conflicts: plans.filter(plan => plan.conflict).map(plan => ({
    key: plan.key, prices: plan.prices, keep_precio: plan.canonical.precio, canonical: plan.canonical, duplicates: plan.duplicates,
  })),
  plans: plans.map(plan => ({
    key: plan.key,
    conflict: plan.conflict,
    keep: `${plan.canonical.estilo} ${plan.color} ${plan.canonical.marca} $${plan.canonical.precio} ${plan.canonical.source_system} ${plan.canonical.pairs}p`,
    merge: plan.duplicates.map(product => `${product.estilo} ${product.marca || '—'} $${product.precio} ${product.source_system} ${product.pairs}p${product.activo ? '' : ' inactivo'}`),
    patch: plan.patch,
    added_pairs: plan.added_pairs,
    ghost_pairs: plan.ghost_pairs,
    sizeMoves: plan.sizeMoves,
  })),
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output: outputPath, mode: report.mode, summary: report.summary, conflict_keys: report.conflicts.map(row => `${row.key} ${row.prices.join('/')}`) }, null, 2));

if (!apply) {
  console.log('\nSimulación lista. No se escribió en Supabase. Identidad canónica: estilo+color. Talla nueva se agrega; talla existente se suma; copias inactivas iguales no se vuelven a sumar.');
  process.exit(0);
}

async function ensureVariant(productId, size) {
  const existing = findVariant(productId, size);
  if (existing) return existing;
  const [saved] = await rest('product_variants?on_conflict=product_id%2Csize', {
    method: 'POST',
    body: [{ product_id: productId, size }],
    prefer: 'resolution=merge-duplicates,return=representation',
  });
  if (!variantsByProduct.has(productId)) variantsByProduct.set(productId, []);
  variantsByProduct.get(productId).push(saved);
  return saved;
}

async function setLevel(variantId, quantity, reason, importKey, previous = levelsByVariant.get(levelKey(juarez.id, variantId)) || 0) {
  await rest('inventory_levels?on_conflict=branch_id%2Cvariant_id', {
    method: 'POST',
    body: [{ branch_id: juarez.id, variant_id: variantId, quantity, updated_by: userId }],
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
  levelsByVariant.set(levelKey(juarez.id, variantId), quantity);
  await rest('inventory_movements_relational?on_conflict=import_key', {
    method: 'POST',
    body: [{
      organization_id: organization.id, branch_id: juarez.id, variant_id: variantId,
      operation: 'adjustment', previous_quantity: previous, quantity: quantity - previous, new_quantity: quantity,
      reason, import_key: importKey, created_by: userId,
    }],
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
}

const applied = [];
for (const plan of plans) {
  const canonical = products.find(product => product.id === plan.canonical.id);
  if (Object.keys(plan.patch).length) {
    await rest(`products?id=eq.${canonical.id}`, { method: 'PATCH', body: plan.patch, prefer: 'return=minimal' });
    Object.assign(canonical, plan.patch);
  }
  for (const move of plan.sizeMoves) {
    const duplicateVariant = findVariant(move.duplicate_id, move.size);
    if (!duplicateVariant) continue;
    if (move.add > 0) {
      const canonicalVariant = await ensureVariant(canonical.id, move.size);
      const previous = levelsByVariant.get(levelKey(juarez.id, canonicalVariant.id)) || 0;
      await setLevel(
        canonicalVariant.id,
        previous + move.add,
        `Fusión estilo-color ${move.duplicate_estilo} → ${canonical.estilo} talla ${move.size}`,
        `estilo-color-merge:${canonical.id}:${move.duplicate_id}:${move.size}:add`,
        previous,
      );
    }
    const duplicatePrevious = levelsByVariant.get(levelKey(juarez.id, duplicateVariant.id)) || 0;
    if (duplicatePrevious > 0) {
      await setLevel(
        duplicateVariant.id,
        0,
        `Stock absorbido en ${canonical.estilo} ${plan.color} talla ${move.size}`,
        `estilo-color-merge:${canonical.id}:${move.duplicate_id}:${move.size}:zero`,
        duplicatePrevious,
      );
    }
  }
  for (const duplicate of plan.duplicates) {
    await rest(`products?id=eq.${duplicate.id}`, { method: 'PATCH', body: { activo: false }, prefer: 'return=minimal' });
    const registryRows = registry.filter(row => row.product_id === duplicate.id);
    for (const row of registryRows) {
      await rest(`saz_product_registry?id=eq.${row.id}`, {
        method: 'PATCH',
        body: { product_id: canonical.id, estilo: canonical.estilo, color: canonical.color },
        prefer: 'return=minimal',
      });
      row.product_id = canonical.id;
    }
  }
  applied.push({ key: plan.key, canonical: canonical.estilo, deactivated: plan.duplicates.map(product => product.estilo), added_pairs: plan.added_pairs, ghost_pairs: plan.ghost_pairs, conflict: plan.conflict });
}

await rest('inventory_migration_runs', {
  method: 'POST',
  body: {
    organization_id: organization.id,
    branch_id: juarez.id,
    source_summary: {
      mode: 'estilo_color_consolidate',
      groups: applied.length,
      added_pairs: applied.reduce((sum, row) => sum + row.added_pairs, 0),
      ghost_pairs: applied.reduce((sum, row) => sum + row.ghost_pairs, 0),
      conflicts_kept_canonical_price: applied.filter(row => row.conflict).length,
    },
    product_count: applied.length,
    variant_count: plans.reduce((sum, plan) => sum + plan.sizeMoves.filter(row => row.add > 0).length, 0),
    pair_count: applied.reduce((sum, row) => sum + row.added_pairs, 0),
    created_by: userId,
  },
  prefer: 'return=minimal',
});

console.log(JSON.stringify({
  completed: true,
  identity: 'estilo+color',
  groups_merged: applied.length,
  added_pairs: applied.reduce((sum, row) => sum + row.added_pairs, 0),
  ghost_pairs_not_double_counted: applied.reduce((sum, row) => sum + row.ghost_pairs, 0),
  price_conflicts_kept: applied.filter(row => row.conflict).length,
}, null, 2));
