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

const cli = argsFrom(process.argv.slice(2));
const apply = cli.apply === true;
const excelPath = path.resolve(cli.xlsx || '/Users/laclavees12345/Downloads/carga.xlsx');
const outputPath = path.resolve(cli.output || path.join(workspaceDir, 'entregables/carga-cruce-supabase.json'));
const env = { ...readEnv(path.resolve(scriptDir, '../.env.local')), ...process.env };
const url = String(env.SUPABASE_URL || '').replace(/\/$/, '');
const apiKey = env.SUPABASE_PUBLISHABLE_KEY || '';
const email = String(env.SUPABASE_MIGRATION_EMAIL || '').trim();
const password = String(env.SUPABASE_MIGRATION_PASSWORD || '').trim();
if (!fs.existsSync(excelPath)) throw new Error(`No existe: ${excelPath}`);
if (!url || !apiKey || !email || !password) throw new Error('Faltan credenciales de Supabase.');

const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase().replace(/\s+/g, ' ');
const number = value => Number(String(value ?? '').replace(/[^0-9.-]/g, '')) || 0;
const estiloText = value => (typeof value === 'number' && Number.isFinite(value) ? String(Math.trunc(value)) : String(value ?? '').trim());
const compactEstilo = value => normalize(value).replace(/^0+(?=\d)/, '');
const lookupKey = (estilo, color) => `${normalize(estilo)}|${normalize(color)}`;
const compactKey = (estilo, color) => `${compactEstilo(estilo)}|${normalize(color)}`;
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
const organizationIds = memberships.map(row => row.organization_id);
const organizations = await rest(`organizations?select=id,name&id=in.(${organizationIds.join(',')})`);
const organization = organizations.find(row => normalize(row.name) === 'CLAREMM');
if (!organization) throw new Error('No se encontró la organización CLAREMM.');
const branches = await allRows(`branches?select=id,code,name,active&organization_id=eq.${organization.id}`);
const juarez = branches.find(row => row.code === 'JUAREZ') || branches[0];
if (!juarez) throw new Error('No se encontró sucursal JUAREZ.');

const [products, variants, registry] = await Promise.all([
  allRows(`products?select=id,estilo,color,marca,proveedor,linea,acabado,precio,imagen,source_system,source_id,activo&organization_id=eq.${organization.id}`),
  allRows('product_variants?select=id,product_id,size'),
  allRows(`saz_product_registry?select=id,product_id,lookup_key,estilo,color&organization_id=eq.${organization.id}`),
]);
const productIdSet = new Set(products.map(product => product.id));
const orgVariants = variants.filter(variant => productIdSet.has(variant.product_id));
const levels = [];
for (const group of chunks(orgVariants.map(variant => variant.id), 200)) {
  if (!group.length) continue;
  levels.push(...await rest(`inventory_levels?select=branch_id,variant_id,quantity&variant_id=in.(${group.join(',')})`));
}

const workbook = XLSX.readFile(excelPath, { cellDates: true, raw: true });
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
const headersRow = matrix[0] || [];
const totalIndex = headersRow.findIndex(value => normalize(value) === 'TOTAL EXISTENCIA');
if (totalIndex <= 20) throw new Error('El Excel no tiene la columna Total Existencia esperada.');
const firstSize = Number(headersRow[20]);
if (!Number.isFinite(firstSize)) throw new Error('El Excel no tiene una primera talla válida.');
const sizes = Array.from({ length: totalIndex - 20 }, (_, index) => (firstSize + index * 0.5).toFixed(1));

const excelRows = [];
const totalMismatches = [];
for (let index = 1; index < matrix.length; index++) {
  const row = matrix[index];
  const estilo = estiloText(row[0]);
  const color = String(row[1] ?? '').trim();
  if (!estilo && !color) continue;
  if (!estilo || !color) throw new Error(`Fila ${index + 1} sin estilo o color.`);
  const qtyBySize = {};
  let calculated = 0;
  sizes.forEach((size, sizeIndex) => {
    const quantity = Math.trunc(number(row[20 + sizeIndex]));
    if (quantity <= 0) return;
    calculated += quantity;
    qtyBySize[size] = (qtyBySize[size] || 0) + quantity;
  });
  const declared = Math.trunc(number(row[totalIndex]));
  if (calculated !== declared) totalMismatches.push({ row: index + 1, estilo, color: normalize(color), calculated, declared });
  excelRows.push({
    source_row: index + 1,
    estilo_raw: estilo,
    color: normalize(color),
    precio: number(row[2]),
    marca: normalize(row[3]),
    proveedor: normalize(row[4]),
    sublinea: normalize(row[6]),
    linea: normalize(row[9]),
    acabado: normalize(row[11]),
    qtyBySize,
    pairs: calculated,
    declared,
  });
}

function mergeRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = lookupKey(row.estilo_raw, row.color);
    if (!map.has(key)) {
      map.set(key, { ...row, source_rows: [row.source_row], qtyBySize: { ...row.qtyBySize } });
      continue;
    }
    const current = map.get(key);
    current.source_rows.push(row.source_row);
    current.pairs += row.pairs;
    current.declared += row.declared;
    for (const [size, quantity] of Object.entries(row.qtyBySize)) current.qtyBySize[size] = (current.qtyBySize[size] || 0) + quantity;
    if (!current.precio && row.precio) current.precio = row.precio;
    if ((!current.marca || current.marca === 'NAN') && row.marca && row.marca !== 'NAN') current.marca = row.marca;
  }
  return [...map.values()];
}

const excelProducts = mergeRows(excelRows);
const productsByExact = new Map();
const productsByCompact = new Map();
for (const product of products) {
  const exact = lookupKey(product.estilo, product.color);
  const compact = compactKey(product.estilo, product.color);
  if (!productsByExact.has(exact)) productsByExact.set(exact, []);
  productsByExact.get(exact).push(product);
  if (!productsByCompact.has(compact)) productsByCompact.set(compact, []);
  productsByCompact.get(compact).push(product);
}
const registryByKey = new Map(registry.map(row => [normalize(row.lookup_key), row]));
const variantsByProduct = new Map();
for (const variant of orgVariants) {
  if (!variantsByProduct.has(variant.product_id)) variantsByProduct.set(variant.product_id, []);
  variantsByProduct.get(variant.product_id).push(variant);
}
const levelsByVariant = new Map(levels.map(level => [`${level.branch_id}|${level.variant_id}`, Number(level.quantity || 0)]));
function stockFor(productId, branchId) {
  const result = {};
  for (const variant of variantsByProduct.get(productId) || []) {
    const quantity = levelsByVariant.get(`${branchId}|${variant.id}`) || 0;
    if (quantity > 0) result[String(variant.size)] = quantity;
  }
  return result;
}

const matches = [];
const skippedNoPrice = [];
const unmatched = [];
const ambiguous = [];
const leadingZeroFixes = [];
for (const row of excelProducts) {
  const exactKey = lookupKey(row.estilo_raw, row.color);
  const compact = compactKey(row.estilo_raw, row.color);
  let candidates = productsByExact.get(exactKey) || [];
  let matchType = candidates.length ? 'exact' : '';
  if (!candidates.length) {
    candidates = productsByCompact.get(compact) || [];
    if (candidates.length) matchType = 'leading_zero';
  }
  const registryHit = registryByKey.get(exactKey) || [...registryByKey.values()].find(item => compactKey(item.estilo, item.color) === compact);
  if (registryHit) {
    const registeredProduct = products.find(product => product.id === registryHit.product_id);
    if (registeredProduct && !candidates.some(candidate => candidate.id === registeredProduct.id)) {
      candidates = [registeredProduct, ...candidates];
      matchType = matchType || 'registry';
    }
  }
  let unique = [...new Map(candidates.map(candidate => [candidate.id, candidate])).values()];
  if (!unique.length) {
    unmatched.push(row);
    continue;
  }
  if (unique.length > 1) {
    const priced = unique.filter(product => Number(product.precio) > 0);
    const withImage = priced.filter(product => String(product.imagen || '').trim());
    const sameProvider = unique.filter(product => product.proveedor && normalize(product.proveedor) === row.proveedor);
    const score = product => (
      (Number(product.precio) > 0 ? 1000 : 0) +
      (String(product.imagen || '').trim() ? 400 : 0) +
      (product.source_system === 'saz_registered' ? 220 : 0) +
      (/^0+\d/.test(String(product.estilo || '')) ? 80 : 0)
    );
    const narrowed = withImage.length === 1 ? withImage
      : priced.length === 1 ? priced
      : sameProvider.length === 1 ? sameProvider
      : [...unique].sort((left, right) => score(right) - score(left));
    unique = [narrowed[0]];
    matchType = matchType || 'canonical_estilo_color';
  }
  const product = unique[0];
  if (!(Number(product.precio) > 0)) {
    skippedNoPrice.push({
      excel_estilo: row.estilo_raw, catalog_estilo: product.estilo, color: row.color,
      excel_pairs: row.pairs, catalog_precio: Number(product.precio),
    });
    continue;
  }
  if (normalize(product.estilo) !== normalize(row.estilo_raw)) {
    leadingZeroFixes.push({ excel: row.estilo_raw, catalog: product.estilo, color: row.color, precio: Number(product.precio) });
    matchType = 'leading_zero';
  }
  const currentStock = stockFor(product.id, juarez.id);
  const currentPairs = Object.values(currentStock).reduce((sum, quantity) => sum + quantity, 0);
  matches.push({
    matchType,
    product,
    excel: row,
    currentStock,
    currentPairs,
    excelPairs: row.pairs,
    stockDelta: row.pairs - currentPairs,
  });
}

const catalogPairs = levels.filter(level => level.branch_id === juarez.id).reduce((sum, level) => sum + Number(level.quantity || 0), 0);
const report = {
  generated_at: new Date().toISOString(),
  mode: apply ? 'APPLY' : 'DRY_RUN',
  organization: { id: organization.id, name: organization.name },
  branch: { id: juarez.id, code: juarez.code, name: juarez.name },
  excel: {
    file: path.basename(excelPath),
    rows: excelRows.length,
    products_after_merge: excelProducts.length,
    consolidated: excelProducts.filter(row => row.source_rows.length > 1).length,
    pairs: excelProducts.reduce((sum, row) => sum + row.pairs, 0),
    with_price: excelProducts.filter(row => row.precio > 0).length,
    without_price: excelProducts.filter(row => !(row.precio > 0)).length,
    total_mismatches: totalMismatches,
  },
  supabase: {
    products: products.length,
    priced: products.filter(product => Number(product.precio) > 0).length,
    priced_with_image: products.filter(product => Number(product.precio) > 0 && String(product.imagen || '').trim()).length,
    variants: orgVariants.length,
    inventory_level_rows: levels.length,
    juarez_pairs: catalogPairs,
    registry: registry.length,
    source_systems: Object.fromEntries([...products.reduce((map, product) => {
      map.set(product.source_system, (map.get(product.source_system) || 0) + 1);
      return map;
    }, new Map())]),
  },
  cruzado: {
    matched_with_price: matches.length,
    matched_pairs_excel: matches.reduce((sum, row) => sum + row.excelPairs, 0),
    matched_pairs_current: matches.reduce((sum, row) => sum + row.currentPairs, 0),
    stock_same: matches.filter(row => row.stockDelta === 0).length,
    stock_would_change: matches.filter(row => row.stockDelta !== 0).length,
    matched_currently_empty: matches.filter(row => row.currentPairs === 0 && row.excelPairs > 0).length,
    skipped_no_price_in_catalog: skippedNoPrice.length,
    unmatched: unmatched.length,
    unmatched_with_price: unmatched.filter(row => row.precio > 0).length,
    unmatched_pairs: unmatched.reduce((sum, row) => sum + row.pairs, 0),
    ambiguous: ambiguous.length,
    leading_zero_fixes: leadingZeroFixes,
  },
  matches: matches.map(row => ({
    matchType: row.matchType,
    excel_estilo: row.excel.estilo_raw,
    catalog_estilo: row.product.estilo,
    color: row.excel.color,
    catalog_precio: Number(row.product.precio),
    excel_precio: row.excel.precio,
    has_image: Boolean(String(row.product.imagen || '').trim()),
    source_system: row.product.source_system,
    excel_pairs: row.excelPairs,
    current_pairs: row.currentPairs,
    stock_delta: row.stockDelta,
    excel_sizes: row.excel.qtyBySize,
    current_sizes: row.currentStock,
    product_id: row.product.id,
  })),
  skipped_no_price: skippedNoPrice,
  unmatched: unmatched.map(row => ({
    estilo: row.estilo_raw, color: row.color, precio: row.precio, marca: row.marca, pairs: row.pairs, rows: row.source_rows,
  })),
  unmatched_with_price: unmatched.filter(row => row.precio > 0).map(row => ({
    estilo: row.estilo_raw, color: row.color, precio: row.precio, marca: row.marca, pairs: row.pairs,
  })),
  ambiguous,
  consolidated: excelProducts.filter(row => row.source_rows.length > 1).map(row => ({
    estilo: row.estilo_raw, color: row.color, rows: row.source_rows, pairs: row.pairs,
  })),
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output: outputPath, mode: report.mode, excel: report.excel, supabase: report.supabase, cruzado: report.cruzado }, null, 2));

function chooseCanonical(candidates, excelEstilo) {
  const padded = candidates.filter(product => /^0+\d/.test(String(product.estilo || '')) && compactEstilo(product.estilo) === compactEstilo(excelEstilo));
  if (padded.length === 1) return padded[0];
  const exact = candidates.filter(product => normalize(product.estilo) === normalize(excelEstilo));
  if (exact.length === 1) return exact[0];
  return null;
}

const pricedExcelRows = excelProducts.filter(row => row.precio > 0);
const priceUpdates = [];
const priceSkipped = [];
for (const row of pricedExcelRows) {
  const exact = productsByExact.get(lookupKey(row.estilo_raw, row.color)) || [];
  const compact = productsByCompact.get(compactKey(row.estilo_raw, row.color)) || [];
  const candidates = [...new Map([...exact, ...compact].map(product => [product.id, product])).values()];
  if (candidates.length !== 1 && !chooseCanonical(candidates, row.estilo_raw)) {
    priceSkipped.push({ estilo: row.estilo_raw, color: row.color, precio: row.precio, reason: candidates.length ? 'ambiguous' : 'not_found', candidates: candidates.length });
    continue;
  }
  const product = candidates.length === 1 ? candidates[0] : chooseCanonical(candidates, row.estilo_raw);
  if (Number(product.precio) > 0) {
    priceSkipped.push({ estilo: row.estilo_raw, color: row.color, catalog_estilo: product.estilo, excel_precio: row.precio, catalog_precio: Number(product.precio), reason: Number(product.precio) === row.precio ? 'already_priced' : 'price_conflict' });
    continue;
  }
  priceUpdates.push({ product, excel: row });
}

const excelCompactKeys = new Set(excelProducts.map(row => compactKey(row.estilo_raw, row.color)));
const duplicateNumeric = [];
const seenCompact = new Map();
for (const product of products) {
  if (!/^\d+$/.test(compactEstilo(product.estilo))) continue;
  const key = compactKey(product.estilo, product.color);
  if (!seenCompact.has(key)) seenCompact.set(key, []);
  seenCompact.get(key).push(product);
}
for (const [key, group] of seenCompact) {
  if (!excelCompactKeys.has(key)) continue;
  const canonical = group.find(product => /^0+\d/.test(String(product.estilo || ''))) || null;
  const duplicates = group.filter(product => canonical && product.id !== canonical.id && compactEstilo(product.estilo) === compactEstilo(canonical.estilo));
  const safeDuplicates = duplicates.filter(product => !(Number(product.precio) > 0 && Number(canonical.precio) > 0 && Number(product.precio) !== Number(canonical.precio)));
  if (canonical && safeDuplicates.length) duplicateNumeric.push({ key, canonical, duplicates: safeDuplicates });
}

if (!apply) {
  console.log('\nSimulación lista. No se escribió en Supabase.');
  console.log(JSON.stringify({
    safe_apply: {
      fill_missing_prices: priceUpdates.map(row => ({
        from_excel: row.excel.estilo_raw, to_catalog: row.product.estilo, color: row.excel.color, precio: row.excel.precio, product_id: row.product.id,
      })),
      price_skipped: priceSkipped.filter(row => row.reason !== 'already_priced'),
      leading_zero_merges: duplicateNumeric.map(row => ({
        canonical: { id: row.canonical.id, estilo: row.canonical.estilo, color: row.canonical.color, precio: Number(row.canonical.precio) },
        duplicates: row.duplicates.map(product => ({ id: product.id, estilo: product.estilo, color: product.color, precio: Number(product.precio) })),
      })),
      will_not: [
        'No se reemplaza inventory_levels: el Excel tiene menos pares que JUAREZ y borrarían existencias ya cargadas.',
        'No se pisa un precio relacional que ya sea mayor a 0.',
        'No se toca imagen ni inventory_items.',
      ],
    },
  }, null, 2));
  process.exit(0);
}

const filledPrices = [];
for (const row of priceUpdates) {
  await rest(`products?id=eq.${row.product.id}`, {
    method: 'PATCH',
    body: { precio: row.excel.precio },
    prefer: 'return=minimal',
  });
  row.product.precio = row.excel.precio;
  filledPrices.push({ product_id: row.product.id, estilo: row.product.estilo, color: row.excel.color, precio: row.excel.precio, excel_estilo: row.excel.estilo_raw });
}

const merged = [];
for (const row of duplicateNumeric) {
  const excelPrice = pricedExcelRows.find(item => compactKey(item.estilo_raw, item.color) === compactKey(row.canonical.estilo, row.canonical.color));
  if (!(Number(row.canonical.precio) > 0) && excelPrice?.precio > 0) {
    await rest(`products?id=eq.${row.canonical.id}`, {
      method: 'PATCH',
      body: { precio: excelPrice.precio },
      prefer: 'return=minimal',
    });
    row.canonical.precio = excelPrice.precio;
    filledPrices.push({ product_id: row.canonical.id, estilo: row.canonical.estilo, color: row.canonical.color, precio: excelPrice.precio, excel_estilo: excelPrice.estilo_raw, reason: 'leading_zero_canonical' });
  }
  const canonicalVariants = variantsByProduct.get(row.canonical.id) || [];
  const canonicalSizes = new Set(canonicalVariants.map(variant => String(variant.size)));
  for (const duplicate of row.duplicates) {
    const extraSizes = Object.entries(stockFor(duplicate.id, juarez.id)).filter(([size]) => !canonicalSizes.has(String(size)));
    for (const [size, quantity] of extraSizes) {
      const [saved] = await rest('product_variants?on_conflict=product_id%2Csize', {
        method: 'POST',
        body: [{ product_id: row.canonical.id, size: String(size) }],
        prefer: 'resolution=merge-duplicates,return=representation',
      });
      await rest('inventory_levels?on_conflict=branch_id%2Cvariant_id', {
        method: 'POST',
        body: [{ branch_id: juarez.id, variant_id: saved.id, quantity, updated_by: userId }],
        prefer: 'resolution=merge-duplicates,return=minimal',
      });
      await rest('inventory_movements_relational?on_conflict=import_key', {
        method: 'POST',
        body: [{
          organization_id: organization.id, branch_id: juarez.id, variant_id: saved.id,
          operation: 'initial_import', previous_quantity: 0, quantity, new_quantity: quantity,
          reason: `Fusión estilo ${duplicate.estilo} → ${row.canonical.estilo}`,
          import_key: `carga-xlsx-merge:${juarez.id}:${row.canonical.id}:${size}`,
          created_by: userId,
        }],
        prefer: 'resolution=merge-duplicates,return=minimal',
      });
    }
    await rest(`products?id=eq.${duplicate.id}`, {
      method: 'PATCH',
      body: { activo: false },
      prefer: 'return=minimal',
    });
    merged.push({
      canonical: row.canonical.estilo, duplicate: duplicate.estilo, color: row.canonical.color,
      moved_sizes: extraSizes.map(([size, quantity]) => ({ size, quantity })),
    });
  }
}

await rest('inventory_migration_runs', {
  method: 'POST',
  body: {
    organization_id: organization.id,
    branch_id: juarez.id,
    source_summary: {
      file: path.basename(excelPath),
      mode: 'safe_prices_and_leading_zeros',
      filled_prices: filledPrices.length,
      merged: merged.length,
      skipped_stock_replace: true,
    },
    product_count: filledPrices.length,
    variant_count: merged.reduce((sum, row) => sum + row.moved_sizes.length, 0),
    pair_count: filledPrices.length,
    created_by: userId,
  },
  prefer: 'return=minimal',
});

console.log(JSON.stringify({
  completed: true,
  preserved: 'No se reemplazó stock existente ni se pisaron precios/imágenes ya cargados.',
  filled_prices: filledPrices,
  merged_leading_zeros: merged,
  price_conflicts_left: priceSkipped.filter(row => row.reason === 'price_conflict' || row.reason === 'ambiguous'),
}, null, 2));
