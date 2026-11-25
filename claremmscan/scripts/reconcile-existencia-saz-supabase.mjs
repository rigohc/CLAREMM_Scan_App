#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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

const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase().replace(/\s+/g, ' ');
const canonicalColor = value => {
  const color = normalize(value);
  if (color === 'N/B' || color === 'NB') return 'NEGRO BLANCO';
  if (color === 'B/N' || color === 'BN') return 'BLANCO NEGRO';
  if (color === 'FUCSIA' || color === 'FUCHSIA') return 'FIUSHA';
  return color;
};
const estiloText = value => (typeof value === 'number' && Number.isFinite(value) ? String(Math.trunc(value)) : String(value ?? '').trim());
const compactEstilo = value => normalize(value).replace(/^0+(?=\d)/, '');
const compactKey = (estilo, color) => `${compactEstilo(estilo)}|${canonicalColor(color)}`;
const lookupKey = (estilo, color) => `${normalize(estilo)}|${canonicalColor(color)}`;
const chunks = (values, size = 100) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
const integer = value => Math.trunc(Number(value) || 0);
const sizeKey = value => {
  const raw = normalize(value);
  const numeric = Number(raw.replace(',', '.'));
  return Number.isFinite(numeric) ? numeric.toFixed(1) : raw;
};

function parseWorkbook(file) {
  const workbook = XLSX.readFile(file, { raw: true });
  const sheetName = workbook.SheetNames[0];
  const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: true });
  const headers = matrix[0] || [];
  const columns = Object.fromEntries(headers.map((header, index) => [normalize(header), index]));
  const required = ['TIENDA', 'ESTILO', 'COLOR', 'TOTAL'];
  for (const header of required) if (columns[header] === undefined) throw new Error(`Falta la columna ${header}.`);
  const firstSizeIndex = columns.FORRO + 1;
  const totalIndex = columns.TOTAL;
  if (!Number.isInteger(firstSizeIndex) || firstSizeIndex <= 0 || totalIndex <= firstSizeIndex) {
    throw new Error('No se pudo identificar el bloque de tallas entre Forro y Total.');
  }
  const sizeColumns = [];
  for (let index = firstSizeIndex; index < totalIndex; index++) {
    const header = String(headers[index] ?? '').trim();
    const match = header.match(/^(.+?)-(\d+)$/);
    const size = sizeKey(match ? match[1] : header);
    if (!size) throw new Error(`Columna de talla vacía en ${index + 1}.`);
    sizeColumns.push({ index, header, size });
  }

  const products = new Map();
  const mismatches = [];
  const skippedSummaryRows = [];
  let sourceRows = 0;
  for (let index = 1; index < matrix.length; index++) {
    const row = matrix[index];
    const tienda = normalize(row[columns.TIENDA]);
    const estilo = estiloText(row[columns.ESTILO]);
    const color = canonicalColor(row[columns.COLOR]);
    const declaredRaw = row[totalIndex];
    if (!tienda && (!color || /SUM\s*=|TOTAL/i.test(String(declaredRaw)))) {
      if (estilo || color || declaredRaw) skippedSummaryRows.push(index + 1);
      continue;
    }
    if (!estilo && !color) continue;
    if (!estilo || !color) throw new Error(`Fila ${index + 1} sin estilo o color.`);
    sourceRows++;
    const quantities = new Map();
    let calculated = 0;
    for (const column of sizeColumns) {
      const quantity = integer(row[column.index]);
      if (quantity < 0) throw new Error(`Fila ${index + 1}, ${column.header}: existencia negativa.`);
      if (!quantity) continue;
      quantities.set(column.size, (quantities.get(column.size) || 0) + quantity);
      calculated += quantity;
    }
    const declared = integer(declaredRaw);
    if (declared !== calculated) mismatches.push({ row: index + 1, estilo, color, declared, calculated });
    const key = compactKey(estilo, color);
    if (!products.has(key)) {
      products.set(key, {
        key,
        estilo,
        color,
        tienda,
        acabado: normalize(row[columns.ACABADO]),
        marca: normalize(row[columns.MARCA]),
        temporada: normalize(row[columns.TEMPORADA]),
        clasificacion: normalize(row[columns.CLASIFICACION]),
        linea: normalize(row[columns.LINEA]),
        sublinea: normalize(row[columns.SUBLINEA]),
        departamento: normalize(row[columns.DEPARTAMENTO]),
        catalogo: normalize(row[columns.CATALOGO]),
        forro: normalize(row[columns.FORRO]),
        quantities: new Map(),
        pairs: 0,
        sourceRows: [],
      });
    }
    const product = products.get(key);
    product.pairs += calculated;
    product.sourceRows.push(index + 1);
    for (const [size, quantity] of quantities) product.quantities.set(size, (product.quantities.get(size) || 0) + quantity);
  }
  if (mismatches.length) throw new Error(`Hay ${mismatches.length} fila(s) cuyo Total no cuadra: ${JSON.stringify(mismatches.slice(0, 5))}`);
  const rows = [...products.values()];
  return {
    sheetName,
    sourceRows,
    skippedSummaryRows,
    sizeColumns: sizeColumns.length,
    products: rows,
    variants: rows.reduce((sum, row) => sum + row.quantities.size, 0),
    pairs: rows.reduce((sum, row) => sum + row.pairs, 0),
    duplicateProducts: rows.filter(row => row.sourceRows.length > 1).length,
  };
}

function catalogScore(product) {
  return (
    (product.activo !== false ? 2000 : 0) +
    (Number(product.precio) > 0 ? 1000 : 0) +
    (String(product.imagen || '').trim() ? 400 : 0) +
    (product.source_system === 'saz_registered' ? 220 : 0) +
    (product.source_system === 'saz_precargado' ? 180 : 0) +
    (/^0+\d/.test(String(product.estilo || '')) ? 80 : 0)
  );
}

function pickCanonical(candidates, registeredProductId) {
  if (registeredProductId) {
    const registered = candidates.find(product => product.id === registeredProductId);
    if (registered) return registered;
  }
  return [...candidates].sort((left, right) => catalogScore(right) - catalogScore(left) || String(left.id).localeCompare(String(right.id)))[0] || null;
}

const cli = argsFrom(process.argv.slice(2));
const apply = cli.apply === true;
const analyzeOnly = cli['analyze-only'] === true;
const excelPath = path.resolve(cli.xlsx || '/Users/laclavees12345/Downloads/EXISTENCIA SAZ.xlsx');
const outputPath = path.resolve(cli.output || path.join(workspaceDir, 'entregables/existencia-saz-reconciliation.json'));
if (!fs.existsSync(excelPath)) throw new Error(`No existe: ${excelPath}`);
const parsed = parseWorkbook(excelPath);
const fileHash = crypto.createHash('sha256').update(fs.readFileSync(excelPath)).digest('hex');
const localSummary = {
  file: path.basename(excelPath),
  sha256: fileHash,
  sheet: parsed.sheetName,
  source_rows: parsed.sourceRows,
  unique_products: parsed.products.length,
  duplicate_product_groups: parsed.duplicateProducts,
  variants: parsed.variants,
  pairs: parsed.pairs,
  size_columns: parsed.sizeColumns,
  skipped_summary_rows: parsed.skippedSummaryRows,
};
if (analyzeOnly) {
  console.log(JSON.stringify(localSummary, null, 2));
  process.exit(0);
}

const env = { ...readEnv(path.resolve(scriptDir, '../.env.local')), ...process.env };
const url = String(env.SUPABASE_URL || '').replace(/\/$/, '');
const apiKey = env.SUPABASE_PUBLISHABLE_KEY || '';
const email = String(env.SUPABASE_MIGRATION_EMAIL || '').trim();
const password = String(env.SUPABASE_MIGRATION_PASSWORD || '').trim();
if (!url || !apiKey || !email || !password) throw new Error('Faltan credenciales de Supabase.');

const authResponse = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: apiKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const auth = await authResponse.json();
if (!authResponse.ok || !auth.access_token || !auth.user?.id) throw new Error(`Auth: ${auth.error_description || auth.message || authResponse.status}`);
const token = auth.access_token;
const userId = auth.user.id;

async function rest(resource, { method = 'GET', body, prefer = '' } = {}) {
  const response = await fetch(`${url}/rest/v1/${resource}`, {
    method,
    headers: { apikey: apiKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  const data = raw ? JSON.parse(raw) : null;
  if (!response.ok) throw new Error(`${method} ${resource}: ${data?.message || data?.details || raw || response.status}`);
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
const organizations = await rest(`organizations?select=id,name&id=in.(${memberships.map(row => row.organization_id).join(',')})`);
const organization = organizations.find(row => normalize(row.name) === 'CLAREMM');
if (!organization) throw new Error('No se encontró la organización CLAREMM.');
const branches = await allRows(`branches?select=id,code,name&organization_id=eq.${organization.id}`);
const juarez = branches.find(row => row.code === 'JUAREZ');
if (!juarez) throw new Error('No se encontró la sucursal JUAREZ.');

const registry = await allRows(`saz_product_registry?select=id,product_id,lookup_key,estilo,color,source_files&organization_id=eq.${organization.id}`);
const registryByCompact = new Map(registry.map(row => [compactKey(row.estilo || String(row.lookup_key).split('|')[0], row.color || String(row.lookup_key).split('|')[1]), row]));
const estiloValues = [...new Set(parsed.products.flatMap(item => {
  const raw = normalize(item.estilo);
  const compact = compactEstilo(raw);
  return /^\d+$/.test(compact) ? [raw, compact, compact.padStart(3, '0'), compact.padStart(4, '0'), compact.padStart(5, '0'), compact.padStart(6, '0')] : [raw];
}).filter(Boolean))];
const products = [];
for (const group of chunks(estiloValues, 50)) {
  const encoded = group.map(value => encodeURIComponent(value)).join(',');
  products.push(...await allRows(`products?select=id,estilo,color,precio,imagen,source_system,source_id,estado,observaciones,activo&organization_id=eq.${organization.id}&estilo=in.(${encoded})`));
}
const productsByCompact = new Map();
for (const product of products) {
  const key = compactKey(product.estilo, product.color);
  if (!productsByCompact.has(key)) productsByCompact.set(key, []);
  productsByCompact.get(key).push(product);
}

const flatRows = await allRows('inventory_items?select=user_id,item_key,sucursal,estilo,color,talla,cantidad,saz_cargado');
const isJuarez = value => {
  const branch = normalize(value);
  return !branch || branch === 'MATRIZ' || branch.includes('JUAREZ');
};
const flatProductKeys = new Set(flatRows.filter(row => isJuarez(row.sucursal)).map(row => compactKey(row.estilo, row.color)));

const resolved = [];
const missing = [];
for (const item of parsed.products) {
  const candidates = productsByCompact.get(item.key) || [];
  const registered = registryByCompact.get(item.key);
  const canonical = pickCanonical(candidates, registered?.product_id);
  if (!canonical) {
    missing.push(item);
    continue;
  }
  resolved.push({ item, candidates, canonical, registered });
}
const wasCreatedByThisReconcile = row => String(row.canonical.observaciones || '').startsWith(`Alta confirmada por ${path.basename(excelPath)};`);
const historicalPreloadedRows = resolved.filter(row => !wasCreatedByThisReconcile(row)
  && (row.canonical.source_system === 'saz_precargado' || row.canonical.estado === 'YA PRECARGADO EN SAZ'));
const reconciledCreateRows = resolved.filter(wasCreatedByThisReconcile);
// Regla de negocio: si estaba en el Excel de SAZ pero no existía en Supabase,
// fue un alta manual/antigua y siempre queda como YA PRECARGADO EN SAZ.
const reconciledManualRows = reconciledCreateRows;
const preloadedRows = [...historicalPreloadedRows, ...reconciledManualRows];
const preloadedIds = new Set(preloadedRows.map(row => row.canonical.id));
const scannerRows = resolved.filter(row => !preloadedIds.has(row.canonical.id));
const missingScanner = [];
const missingPreloaded = [...missing];
const preloadedSnapshot = historicalPreloadedRows.map(row => ({
  id: row.canonical.id,
  source_system: row.canonical.source_system,
  estado: row.canonical.estado,
}));

const matchedProductIds = [...new Set(resolved.map(row => row.canonical.id))];
const variants = [];
for (const group of chunks(matchedProductIds, 100)) {
  if (!group.length) continue;
  variants.push(...await allRows(`product_variants?select=id,product_id,size&product_id=in.(${group.join(',')})`));
}
const variantIds = variants.map(row => row.id);
const levels = [];
for (const group of chunks(variantIds, 100)) {
  if (!group.length) continue;
  levels.push(...await allRows(`inventory_levels?select=variant_id,quantity&branch_id=eq.${juarez.id}&variant_id=in.(${group.join(',')})`));
}
const levelByVariant = new Map(levels.map(row => [row.variant_id, Number(row.quantity || 0)]));
const variantsByProduct = new Map();
for (const variant of variants) {
  if (!variantsByProduct.has(variant.product_id)) variantsByProduct.set(variant.product_id, []);
  variantsByProduct.get(variant.product_id).push(variant);
}
const productStockTotal = productId => (variantsByProduct.get(productId) || [])
  .reduce((sum, variant) => sum + (levelByVariant.get(variant.id) || 0), 0);
const preloadedRowsWithoutStock = preloadedRows.filter(row => productStockTotal(row.canonical.id) === 0);
const registeredStock = await allRows(`saz_registered_stock?select=id,registry_id,variant_id,size,quantity&organization_id=eq.${organization.id}&branch_id=eq.${juarez.id}`);
const stockByRegistryVariant = new Map(registeredStock.map(row => [`${row.registry_id}|${row.variant_id}`, row]));
const projectedVariantIds = new Set(registeredStock.map(row => row.variant_id));
const variantGroups = new Map();
for (const variant of variants) {
  const key = `${variant.product_id}|${sizeKey(variant.size)}`;
  if (!variantGroups.has(key)) variantGroups.set(key, []);
  variantGroups.get(key).push(variant);
}
const variantByKey = new Map([...variantGroups].map(([key, rows]) => [key, [...rows].sort((left, right) => {
  const leftScore = (projectedVariantIds.has(left.id) ? 1000000 : 0) + (levelByVariant.get(left.id) || 0) * 100;
  const rightScore = (projectedVariantIds.has(right.id) ? 1000000 : 0) + (levelByVariant.get(right.id) || 0) * 100;
  return rightScore - leftScore || String(left.id).localeCompare(String(right.id));
})[0]]));
const desiredFlatKeys = new Set([...scannerRows.map(row => row.item), ...missingScanner].flatMap(row => [...row.quantities.keys()].map(size => `${row.key}|${size}`)));
const matchingFlatRows = flatRows.filter(row => isJuarez(row.sucursal) && desiredFlatKeys.has(`${compactKey(row.estilo, row.color)}|${sizeKey(row.talla)}`));
const pendingFlatRows = matchingFlatRows.filter(row => !row.saz_cargado);

let variantsToCreate = 0;
let physicalRowsToRaise = 0;
let physicalPairsToAdd = 0;
let statusRowsToUpdate = 0;
let registryRowsToInsert = 0;
let projectionRowsToUpsert = 0;
let staleProjectionRowsToZero = 0;
let preloadedStockRowsToFill = 0;
let preloadedPairsToFill = 0;
const desiredProjectionKeys = new Set();
const desiredProjectionSizeKeys = new Set();
const affectedRegistryIds = new Set();
const stockRaiseSample = [];
for (const row of scannerRows) {
  statusRowsToUpdate += row.candidates.filter(product => product.activo !== false && product.estado !== 'REGISTRADO EN SAZ').length;
  if (!row.registered || row.registered.product_id !== row.canonical.id) registryRowsToInsert++;
  if (row.registered) affectedRegistryIds.add(row.registered.id);
  for (const [size, quantity] of row.item.quantities) {
    const variant = variantByKey.get(`${row.canonical.id}|${size}`);
    if (!variant) {
      variantsToCreate++;
      physicalRowsToRaise++;
      physicalPairsToAdd += quantity;
      projectionRowsToUpsert++;
      continue;
    }
    const previous = levelByVariant.get(variant.id) || 0;
    if (previous < quantity) {
      physicalRowsToRaise++;
      physicalPairsToAdd += quantity - previous;
      if (stockRaiseSample.length < 12) stockRaiseSample.push({ estilo: row.item.estilo, color: row.item.color, size, previous, desired: quantity });
    }
    if (row.registered) {
      const projectionKey = `${row.registered.id}|${variant.id}`;
      desiredProjectionKeys.add(projectionKey);
      desiredProjectionSizeKeys.add(`${row.registered.id}|${size}`);
      const previousProjection = stockByRegistryVariant.get(projectionKey);
      if (!previousProjection || Number(previousProjection.quantity) !== quantity) projectionRowsToUpsert++;
    } else projectionRowsToUpsert++;
  }
}
for (const row of preloadedRowsWithoutStock) {
  for (const [size, quantity] of row.item.quantities) {
    const variant = variantByKey.get(`${row.canonical.id}|${size}`);
    if (!variant) {
      variantsToCreate++;
      preloadedStockRowsToFill++;
      preloadedPairsToFill += quantity;
      continue;
    }
    const previous = levelByVariant.get(variant.id) || 0;
    if (previous === 0) {
      preloadedStockRowsToFill++;
      preloadedPairsToFill += quantity;
    }
  }
}
variantsToCreate += missing.reduce((sum, row) => sum + row.quantities.size, 0);
physicalRowsToRaise += missingScanner.reduce((sum, row) => sum + row.quantities.size, 0);
physicalPairsToAdd += missingScanner.reduce((sum, row) => sum + row.pairs, 0);
preloadedStockRowsToFill += missingPreloaded.reduce((sum, row) => sum + row.quantities.size, 0);
preloadedPairsToFill += missingPreloaded.reduce((sum, row) => sum + row.pairs, 0);
projectionRowsToUpsert += missingScanner.reduce((sum, row) => sum + row.quantities.size, 0);
for (const stock of registeredStock) {
  if (affectedRegistryIds.has(stock.registry_id) && Number(stock.quantity) > 0 && !desiredProjectionSizeKeys.has(`${stock.registry_id}|${sizeKey(stock.size)}`)) staleProjectionRowsToZero++;
}

const report = {
  generated_at: new Date().toISOString(),
  mode: apply ? 'APPLY' : 'DRY_RUN',
  excel: localSummary,
  organization: organization.name,
  branch: { code: juarez.code, name: juarez.name },
  current: {
    registry_products: registry.length,
    registered_stock_rows: registeredStock.length,
    registered_pairs: registeredStock.reduce((sum, row) => sum + Number(row.quantity || 0), 0),
    scanner_rows_loaded: flatRows.filter(row => row.saz_cargado).length,
    scanner_pairs_loaded: flatRows.filter(row => row.saz_cargado).reduce((sum, row) => sum + Number(row.cantidad || 0), 0),
    scanner_rows_pending: flatRows.filter(row => !row.saz_cargado).length,
    scanner_pairs_pending: flatRows.filter(row => !row.saz_cargado).reduce((sum, row) => sum + Number(row.cantidad || 0), 0),
  },
  match: {
    matched_products: resolved.length,
    missing_products: missing.length,
    scanner_products_to_register: scannerRows.length + missingScanner.length,
    scanner_pairs_from_excel: [...scannerRows.map(row => row.item), ...missingScanner].reduce((sum, row) => sum + row.pairs, 0),
    preloaded_products_keep_status: preloadedRows.length + missingPreloaded.length,
    preloaded_products_with_zero_total_stock: preloadedRowsWithoutStock.length + missingPreloaded.length,
    historical_preloaded_untouched_status: historicalPreloadedRows.length,
    prior_creates_reclassified_as_preloaded: reconciledManualRows.length,
    missing_with_scanner_evidence: missingScanner.length,
    missing_without_scanner_evidence: missingPreloaded.length,
    duplicate_catalog_matches: resolved.filter(row => row.candidates.filter(product => product.activo !== false).length > 1).length,
    missing_sample: missing.slice(0, 20).map(row => ({ estilo: row.estilo, color: row.color, pairs: row.pairs })),
  },
  plan: {
    products_to_create_from_current_saz: missing.length,
    scanner_status_rows_to_set_registrado_en_saz: statusRowsToUpdate,
    prior_creates_to_set_ya_precargado: reconciledManualRows.filter(row => row.canonical.estado !== 'YA PRECARGADO EN SAZ' || row.canonical.source_system !== 'saz_precargado').length,
    registry_rows_to_upsert: registryRowsToInsert,
    registry_rows_to_remove_from_reclassified_manual: reconciledManualRows.filter(row => row.registered).length,
    variants_to_create: variantsToCreate,
    saz_projection_rows_to_upsert: projectionRowsToUpsert,
    stale_saz_projection_rows_to_zero: staleProjectionRowsToZero,
    juarez_stock_rows_to_raise: physicalRowsToRaise,
    juarez_pairs_to_add_without_decreases: physicalPairsToAdd,
    juarez_stock_raise_sample: stockRaiseSample,
    preloaded_stock_rows_to_fill_only_if_zero: preloadedStockRowsToFill,
    preloaded_pairs_to_fill_only_if_zero: preloadedPairsToFill,
    legacy_rows_to_mark_loaded: pendingFlatRows.length,
    legacy_pairs_to_mark_loaded: pendingFlatRows.reduce((sum, row) => sum + Number(row.cantidad || 0), 0),
    prices_to_change: 0,
    images_to_change: 0,
  },
  safeguards: [
    'StockSet solo al alza en JUAREZ; nunca se reduce inventory_levels.',
    'YA PRECARGADO EN SAZ conserva su estatus; solo se llena si su existencia total actual es cero.',
    'REGISTRADO EN SAZ se reserva para fichas con origen en el escáner.',
    'La proyección saz_registered_stock incluye solo fichas REGISTRADO EN SAZ.',
    'Precios e imágenes no se modifican.',
    'inventory_items no se borra ni se usa como destino.',
  ],
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output: outputPath, ...report }, null, 2));
if (!apply) {
  console.log('\nSimulación lista. Usa --apply para conciliar el estado y las existencias.');
  process.exit(0);
}
const now = new Date().toISOString();
if (missing.length) {
  const createRows = missing.map(row => ({
    organization_id: organization.id,
    source_system: 'saz_precargado',
    source_id: row.key,
    match_key: [row.estilo, row.color, row.marca].map(normalize).join('|'),
    estilo: normalize(row.estilo),
    color: row.color,
    precio: 0,
    marca: row.marca || '',
    proveedor: '',
    temporada: row.temporada || '',
    sublinea: row.sublinea || '',
    departamento: row.departamento || '',
    clasificacion: row.clasificacion || '',
    linea: row.linea || '',
    corrida: '',
    acabado: row.acabado || '',
    suela: '',
    plantilla: '',
    tacon: '',
    forro: row.forro || '',
    catalogo: row.catalogo || '',
    status: 1,
    observaciones: `Alta confirmada por ${path.basename(excelPath)}; precio e imagen pendientes de revision`,
    costo: 0,
    descripcion: '',
    estado: 'YA PRECARGADO EN SAZ',
    activo: true,
    imagen: '',
  }));
  const createdByCompact = new Map();
  for (const group of chunks(createRows, 80)) {
    const saved = await rest('products?on_conflict=organization_id%2Csource_system%2Csource_id', {
      method: 'POST', body: group, prefer: 'resolution=merge-duplicates,return=representation',
    });
    for (const product of saved) createdByCompact.set(compactKey(product.estilo, product.color), product);
  }
  for (const item of missing) {
    const canonical = createdByCompact.get(item.key);
    if (!canonical) throw new Error(`No se pudo crear ${item.estilo}|${item.color}.`);
    const target = { item, candidates: [canonical], canonical, registered: undefined };
    preloadedRows.push(target);
  }
}

for (const row of reconciledManualRows) {
  if (row.registered) {
    await rest(`saz_registered_stock?registry_id=eq.${row.registered.id}&branch_id=eq.${juarez.id}`, {
      method: 'DELETE', prefer: 'return=minimal',
    });
    await rest(`saz_product_registry?id=eq.${row.registered.id}`, {
      method: 'DELETE', prefer: 'return=minimal',
    });
  }
  await rest(`products?id=eq.${row.canonical.id}&organization_id=eq.${organization.id}`, {
    method: 'PATCH',
    body: { source_system: 'saz_precargado', estado: 'YA PRECARGADO EN SAZ' },
    prefer: 'return=minimal',
  });
  row.canonical.source_system = 'saz_precargado';
  row.canonical.estado = 'YA PRECARGADO EN SAZ';
  row.registered = undefined;
}

const allStatusIds = [...new Set(scannerRows.flatMap(row => row.candidates.filter(product => product.activo !== false).map(product => product.id)))];
for (const group of chunks(allStatusIds, 80)) {
  await rest(`products?id=in.(${group.join(',')})&organization_id=eq.${organization.id}`, {
    method: 'PATCH', body: { estado: 'REGISTRADO EN SAZ' }, prefer: 'return=minimal',
  });
}

const registryRows = scannerRows.map(row => ({
  organization_id: organization.id,
  product_id: row.canonical.id,
  lookup_key: lookupKey(row.canonical.estilo, row.canonical.color),
  estilo: normalize(row.canonical.estilo),
  color: normalize(row.canonical.color),
  source_files: [...new Set([...(row.registered?.source_files || []), path.basename(excelPath)])],
  last_registered_at: now,
}));
const registryAfterByCompact = new Map();
for (const row of scannerRows.filter(item => item.registered)) {
  const body = registryRows.find(item => compactKey(item.estilo, item.color) === row.item.key);
  await rest(`saz_product_registry?id=eq.${row.registered.id}`, {
    method: 'PATCH', body: { ...body, lookup_key: row.registered.lookup_key }, prefer: 'return=minimal',
  });
  registryAfterByCompact.set(row.item.key, { ...row.registered, ...body, lookup_key: row.registered.lookup_key });
}
for (const group of chunks(registryRows.filter(row => !registryByCompact.has(compactKey(row.estilo, row.color))), 80)) {
  const saved = await rest('saz_product_registry?on_conflict=organization_id%2Clookup_key', {
    method: 'POST', body: group, prefer: 'resolution=merge-duplicates,return=representation',
  });
  for (const row of saved) registryAfterByCompact.set(compactKey(row.estilo, row.color), row);
}

const variantRequests = [];
for (const row of [...scannerRows, ...preloadedRows.filter(row => productStockTotal(row.canonical.id) === 0)]) {
  for (const size of row.item.quantities.keys()) {
    if (!variantByKey.has(`${row.canonical.id}|${size}`)) variantRequests.push({ product_id: row.canonical.id, size });
  }
}
const variantAfterByKey = new Map(variantByKey);
for (const group of chunks(variantRequests, 100)) {
  const saved = await rest('product_variants?on_conflict=product_id%2Csize', {
    method: 'POST', body: group, prefer: 'resolution=merge-duplicates,return=representation',
  });
  for (const row of saved) variantAfterByKey.set(`${row.product_id}|${sizeKey(row.size)}`, row);
}

const levelUpserts = [];
const movementRows = [];
for (const row of scannerRows) {
  for (const [size, quantity] of row.item.quantities) {
    const variant = variantAfterByKey.get(`${row.canonical.id}|${size}`);
    const previous = levelByVariant.get(variant.id) || 0;
    if (previous >= quantity) continue;
    levelUpserts.push({ branch_id: juarez.id, variant_id: variant.id, quantity, updated_by: userId });
    movementRows.push({
      organization_id: organization.id,
      branch_id: juarez.id,
      variant_id: variant.id,
      operation: previous ? 'set' : 'initial_import',
      previous_quantity: previous,
      quantity: quantity - previous,
      new_quantity: quantity,
      reason: `StockSet al alza desde ${path.basename(excelPath)}; JUAREZ nunca baja`,
      import_key: `existencia-saz:${fileHash}:${juarez.id}:${variant.id}`,
      created_by: userId,
    });
  }
}
const preloadedApplyRows = preloadedRows.filter(row => productStockTotal(row.canonical.id) === 0);
for (const row of preloadedApplyRows) {
  for (const [size, quantity] of row.item.quantities) {
    const variant = variantAfterByKey.get(`${row.canonical.id}|${size}`);
    const previous = levelByVariant.get(variant.id) || 0;
    if (previous !== 0) continue;
    levelUpserts.push({ branch_id: juarez.id, variant_id: variant.id, quantity, updated_by: userId });
    movementRows.push({
      organization_id: organization.id,
      branch_id: juarez.id,
      variant_id: variant.id,
      operation: 'initial_import',
      previous_quantity: 0,
      quantity,
      new_quantity: quantity,
      reason: `StockIncreased: precargado sin existencia, confirmado por ${path.basename(excelPath)}`,
      import_key: `existencia-saz-preloaded:${fileHash}:${juarez.id}:${variant.id}`,
      created_by: userId,
    });
  }
}
for (const group of chunks(movementRows, 100)) {
  await rest('inventory_movements_relational?on_conflict=import_key', {
    method: 'POST', body: group, prefer: 'resolution=merge-duplicates,return=minimal',
  });
}
for (const group of chunks(levelUpserts, 100)) {
  await rest('inventory_levels?on_conflict=branch_id%2Cvariant_id', {
    method: 'POST', body: group, prefer: 'resolution=merge-duplicates,return=minimal',
  });
}

const projectionRows = [];
const desiredAfter = new Set();
const desiredAfterSizes = new Set();
for (const row of scannerRows) {
  const registered = registryAfterByCompact.get(row.item.key);
  for (const [size, quantity] of row.item.quantities) {
    const variant = variantAfterByKey.get(`${row.canonical.id}|${size}`);
    desiredAfter.add(`${registered.id}|${variant.id}`);
    desiredAfterSizes.add(`${registered.id}|${size}`);
    projectionRows.push({
      organization_id: organization.id,
      branch_id: juarez.id,
      registry_id: registered.id,
      variant_id: variant.id,
      size,
      quantity,
      source_files: [path.basename(excelPath)],
      registered_at: now,
    });
  }
}
for (const group of chunks(projectionRows, 100)) {
  await rest('saz_registered_stock?on_conflict=branch_id%2Cregistry_id%2Csize', {
    method: 'POST', body: group, prefer: 'resolution=merge-duplicates,return=minimal',
  });
}
const affectedRegistryIdsAfter = new Set(scannerRows.map(row => registryAfterByCompact.get(row.item.key)?.id).filter(Boolean));
const staleAfter = registeredStock.filter(row => affectedRegistryIdsAfter.has(row.registry_id) && Number(row.quantity) > 0 && !desiredAfterSizes.has(`${row.registry_id}|${sizeKey(row.size)}`));
for (const group of chunks(staleAfter.map(row => row.id), 80)) {
  if (!group.length) continue;
  await rest(`saz_registered_stock?id=in.(${group.join(',')})`, {
    method: 'PATCH', body: { quantity: 0, updated_at: now }, prefer: 'return=minimal',
  });
}

for (const group of chunks(pendingFlatRows, 16)) {
  await Promise.all(group.map(row => rest(`inventory_items?user_id=eq.${encodeURIComponent(row.user_id)}&item_key=eq.${encodeURIComponent(row.item_key)}`, {
    method: 'PATCH', body: { saz_cargado: true, saz_cargado_at: now }, prefer: 'return=minimal',
  })));
}

await rest('saz_registration_batches?on_conflict=organization_id%2Cbranch_id%2Csource_file', {
  method: 'POST',
  body: [{
    organization_id: organization.id,
    branch_id: juarez.id,
    source_file: path.basename(excelPath),
    registered_on: new Date().toISOString().slice(0, 10),
    product_count: scannerRows.length,
    variant_count: projectionRows.length,
    pair_count: projectionRows.reduce((sum, row) => sum + row.quantity, 0),
    validation_notes: { sha256: fileHash, source_rows: parsed.sourceRows, summary_rows_skipped: parsed.skippedSummaryRows, preloaded_stock_only: preloadedRows.length },
    imported_by: userId,
  }],
  prefer: 'resolution=merge-duplicates,return=minimal',
});

await rest('inventory_migration_runs', {
  method: 'POST',
  body: {
    organization_id: organization.id,
    branch_id: juarez.id,
    source_summary: {
      file: path.basename(excelPath), sha256: fileHash, mode: 'existencia_saz_reconciliation',
      domain_event: ['StockSet', 'StockIncreased'], juarez_decreases: 0, status: 'REGISTRADO EN SAZ',
      preloaded_status: 'YA PRECARGADO EN SAZ', preloaded_stock_only_if_zero: true,
    },
    product_count: scannerRows.length + preloadedRows.length,
    variant_count: projectionRows.length,
    pair_count: projectionRows.reduce((sum, row) => sum + row.quantity, 0),
    created_by: userId,
  },
  prefer: 'return=minimal',
});

const summary = await rest(`saz_registration_summary?select=registered_products,registered_variants,registered_pairs,last_registered_at&branch_id=eq.${juarez.id}`);
const afterLevels = [];
const usedVariantIds = [...new Set(projectionRows.map(row => row.variant_id))];
for (const group of chunks(usedVariantIds, 100)) {
  afterLevels.push(...await allRows(`inventory_levels?select=variant_id,quantity&branch_id=eq.${juarez.id}&variant_id=in.(${group.join(',')})`));
}
const afterLevelByVariant = new Map(afterLevels.map(row => [row.variant_id, Number(row.quantity || 0)]));
const lowerThanExcel = projectionRows.filter(row => (afterLevelByVariant.get(row.variant_id) || 0) < row.quantity);
if (lowerThanExcel.length) throw new Error(`Verificación falló: ${lowerThanExcel.length} existencias quedaron por debajo del Excel.`);
const flatAfter = await allRows('inventory_items?select=item_key,saz_cargado,cantidad');
const flatAfterByKey = new Map(flatAfter.map(row => [row.item_key, row]));
const flatNotMarked = pendingFlatRows.filter(row => !flatAfterByKey.get(row.item_key)?.saz_cargado);
if (flatNotMarked.length) throw new Error(`Verificación falló: ${flatNotMarked.length} fila(s) locales no quedaron cargadas.`);
const preloadedAfter = [];
for (const group of chunks(preloadedSnapshot.map(row => row.id), 80)) {
  if (!group.length) continue;
  preloadedAfter.push(...await allRows(`products?select=id,source_system,estado&id=in.(${group.join(',')})`));
}
const preloadedAfterById = new Map(preloadedAfter.map(row => [row.id, row]));
const preloadedChanged = preloadedSnapshot.filter(before => {
  const after = preloadedAfterById.get(before.id);
  return !after || after.source_system !== before.source_system || after.estado !== before.estado;
});
if (preloadedChanged.length) throw new Error(`Verificación falló: ${preloadedChanged.length} ficha(s) precargadas cambiaron.`);

report.applied = {
  completed: true,
  products_created: missing.length,
  status_products_marked: allStatusIds.length,
  registry_products_processed: registryRows.length,
  saz_projection_rows: projectionRows.length,
  saz_projection_pairs_from_file: projectionRows.reduce((sum, row) => sum + row.quantity, 0),
  stale_projection_rows_zeroed: staleAfter.length,
  juarez_stock_rows_raised: levelUpserts.length,
  juarez_pairs_added: movementRows.reduce((sum, row) => sum + row.quantity, 0),
  juarez_decreases: 0,
  legacy_rows_marked_loaded: pendingFlatRows.length,
  legacy_pairs_marked_loaded: pendingFlatRows.reduce((sum, row) => sum + Number(row.cantidad || 0), 0),
  preloaded_products_verified_untouched: preloadedSnapshot.length,
  summary_view: summary[0] || null,
};
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.applied, null, 2));
