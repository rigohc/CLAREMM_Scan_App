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
const prep = require(path.join(scriptDir, '../saz-prep-excel.js'));

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
const compactEstilo = value => normalize(value).replace(/^0+(?=\d)/, '');
const productKey = (estilo, color) => `${compactEstilo(estilo)}|${canonicalColor(color)}`;
const sizeKey = value => {
  const numeric = Number(String(value ?? '').trim().replace(',', '.'));
  return Number.isFinite(numeric) ? numeric.toFixed(1) : normalize(value);
};
const integer = value => Math.trunc(Number(value) || 0);
const chunks = (values, size = 100) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
const isJuarez = value => {
  const branch = normalize(value);
  return !branch || branch === 'MATRIZ' || branch.includes('JUAREZ');
};

function parseRun(value) {
  const raw = normalize(value).replace(/[–—]/g, '-').replace(/\s+/g, '').replace(/,/g, '.');
  const numbers = raw.match(/\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite) || [];
  if (numbers.length < 2) return null;
  const min = Math.min(numbers[0], numbers.at(-1));
  const max = Math.max(numbers[0], numbers.at(-1));
  return { raw, min, max };
}

function parseSazExistence(file) {
  const workbook = XLSX.readFile(file, { raw: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
  const headers = matrix[0] || [];
  const columns = Object.fromEntries(headers.map((header, index) => [normalize(header), index]));
  for (const required of ['TIENDA', 'ESTILO', 'COLOR', 'FORRO', 'TOTAL']) {
    if (columns[required] === undefined) throw new Error(`Falta la columna ${required}.`);
  }
  const sizeColumns = [];
  for (let index = columns.FORRO + 1; index < columns.TOTAL; index++) {
    const header = String(headers[index] ?? '').trim();
    const match = header.match(/^(.+?)-(\d+)$/);
    sizeColumns.push({ index, size: sizeKey(match ? match[1] : header) });
  }
  const products = new Map();
  for (let index = 1; index < matrix.length; index++) {
    const row = matrix[index];
    const tienda = normalize(row[columns.TIENDA]);
    const estilo = String(row[columns.ESTILO] ?? '').trim();
    const color = canonicalColor(row[columns.COLOR]);
    const declaredRaw = row[columns.TOTAL];
    if (!tienda && (!color || /SUM\s*=|TOTAL/i.test(String(declaredRaw)))) continue;
    if (!estilo && !color) continue;
    if (!estilo || !color) throw new Error(`Fila ${index + 1} sin estilo o color.`);
    const key = productKey(estilo, color);
    if (!products.has(key)) products.set(key, { estilo, color, qtyBySize: {}, rows: [] });
    const product = products.get(key);
    product.rows.push(index + 1);
    let calculated = 0;
    for (const column of sizeColumns) {
      const quantity = integer(row[column.index]);
      if (quantity < 0) throw new Error(`Fila ${index + 1}: existencia negativa.`);
      if (!quantity) continue;
      product.qtyBySize[column.size] = (product.qtyBySize[column.size] || 0) + quantity;
      calculated += quantity;
    }
    const declared = integer(declaredRaw);
    if (declared !== calculated) throw new Error(`Fila ${index + 1}: Total ${declared} no coincide con ${calculated}.`);
  }
  return { sheet: workbook.SheetNames[0], products };
}

const cli = argsFrom(process.argv.slice(2));
const apply = cli.apply === true;
const excelPath = path.resolve(cli.xlsx || '/Users/laclavees12345/Downloads/EXISTENCIA SAZ.xlsx');
const dateMx = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const outputXlsx = path.resolve(cli.output || path.join(workspaceDir, `entregables/CLAREMM_Pendientes_SAZ_Existencia_${dateMx}.xlsx`));
const reportPath = path.resolve(cli.report || path.join(workspaceDir, 'entregables/pendientes-saz-existencia.json'));
if (!fs.existsSync(excelPath)) throw new Error(`No existe: ${excelPath}`);
const saz = parseSazExistence(excelPath);

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
if (!juarez) throw new Error('No se encontró JUAREZ.');

const estiloValues = [...new Set([...saz.products.values()].flatMap(item => {
  const raw = normalize(item.estilo);
  const compact = compactEstilo(raw);
  return /^\d+$/.test(compact)
    ? [raw, compact, compact.padStart(3, '0'), compact.padStart(4, '0'), compact.padStart(5, '0'), compact.padStart(6, '0')]
    : [raw];
}).filter(Boolean))];
const products = [];
const productSelect = 'id,source_system,estilo,color,precio,marca,proveedor,temporada,sublinea,departamento,clasificacion,linea,corrida,acabado,suela,plantilla,tacon,forro,catalogo,status,observaciones,costo,estado,activo';
for (const group of chunks(estiloValues, 50)) {
  const encoded = group.map(value => encodeURIComponent(value)).join(',');
  products.push(...await allRows(`products?select=${productSelect}&organization_id=eq.${organization.id}&precio=gt.0&activo=eq.true&estilo=in.(${encoded})`));
}
const productIds = products.map(row => row.id);
const variants = [];
for (const group of chunks(productIds, 100)) {
  if (!group.length) continue;
  variants.push(...await allRows(`product_variants?select=id,product_id,size&product_id=in.(${group.join(',')})`));
}
const variantIds = variants.map(row => row.id);
const levels = [];
for (const group of chunks(variantIds, 100)) {
  if (!group.length) continue;
  levels.push(...await allRows(`inventory_levels?select=variant_id,quantity&branch_id=eq.${juarez.id}&variant_id=in.(${group.join(',')})`));
}
const quantityByVariant = new Map(levels.map(row => [row.variant_id, Number(row.quantity || 0)]));
const variantsByProduct = new Map();
for (const variant of variants) {
  if (!variantsByProduct.has(variant.product_id)) variantsByProduct.set(variant.product_id, []);
  variantsByProduct.get(variant.product_id).push(variant);
}

const gaps = [];
const skippedNoRun = [];
const skippedUnsupportedSizes = [];
for (const product of products) {
  const key = productKey(product.estilo, product.color);
  const sazProduct = saz.products.get(key);
  if (!sazProduct) continue;
  const run = parseRun(product.corrida);
  if (!run) {
    skippedNoRun.push({ id: product.id, estilo: product.estilo, color: product.color, corrida: product.corrida || '' });
    continue;
  }
  const supabaseBySize = {};
  for (const variant of variantsByProduct.get(product.id) || []) {
    const size = sizeKey(variant.size);
    const numeric = Number(size);
    const quantity = quantityByVariant.get(variant.id) || 0;
    if (quantity <= 0) continue;
    if (!Number.isFinite(numeric) || numeric < run.min || numeric > run.max) continue;
    if (!prep.SIZE_HEADERS.includes(size)) {
      skippedUnsupportedSizes.push({ estilo: product.estilo, color: product.color, size, quantity });
      continue;
    }
    supabaseBySize[size] = (supabaseBySize[size] || 0) + quantity;
  }
  const missingBySize = Object.fromEntries(Object.entries(supabaseBySize).filter(([size]) => Number(sazProduct.qtyBySize[size] || 0) === 0));
  const missingPairs = Object.values(missingBySize).reduce((sum, quantity) => sum + quantity, 0);
  if (!missingPairs) continue;
  gaps.push({
    product,
    key,
    run,
    missingBySize,
    missingPairs,
    supabasePairs: Object.values(supabaseBySize).reduce((sum, quantity) => sum + quantity, 0),
    sazPairsInRun: Object.entries(sazProduct.qtyBySize).reduce((sum, [size, quantity]) => {
      const numeric = Number(size);
      return sum + (Number.isFinite(numeric) && numeric >= run.min && numeric <= run.max ? Number(quantity || 0) : 0);
    }, 0),
  });
}
const isPreloadedProduct = product => product.source_system === 'saz_precargado' || /PRECARGADO EN SAZ/i.test(String(product.estado || ''));
const pendingStatusGaps = gaps.filter(row => !isPreloadedProduct(row.product));
const preloadedStatusGaps = gaps.filter(row => isPreloadedProduct(row.product));

const registry = await allRows(`saz_product_registry?select=id,product_id&organization_id=eq.${organization.id}`);
const registryByProduct = new Map(registry.map(row => [row.product_id, row]));
const flatRows = await allRows('inventory_items?select=user_id,item_key,sucursal,estilo,color,talla,cantidad,saz_cargado');
const missingFlatKeys = new Set(gaps.flatMap(row => Object.keys(row.missingBySize).map(size => `${row.key}|${size}`)));
const flatToReopen = flatRows.filter(row => isJuarez(row.sucursal)
  && row.saz_cargado
  && missingFlatKeys.has(`${productKey(row.estilo, row.color)}|${sizeKey(row.talla)}`));

const exportRows = gaps.map(({ product, missingBySize, missingPairs }) => ({
  ...product,
  qtyBySize: missingBySize,
  pares: missingPairs,
  observaciones: `PENDIENTE EXISTENCIA SAZ ${dateMx.split('-').reverse().join('/')}`,
}));
const inventoryRows = prep.toInventoryRows(exportRows, new Date());
const resumenRows = prep.toResumenRows(inventoryRows);
const report = {
  generated_at: new Date().toISOString(),
  mode: apply ? 'APPLY' : 'DRY_RUN',
  source_file: path.basename(excelPath),
  organization: organization.name,
  branch: juarez.name,
  active_priced_products_checked: products.length,
  products_present_in_saz_with_missing_stock: gaps.length,
  products_to_set_pending: pendingStatusGaps.filter(row => !/PENDIENTE DE SAZ/i.test(String(row.product.estado || ''))).length,
  products_already_pending: pendingStatusGaps.filter(row => /PENDIENTE DE SAZ/i.test(String(row.product.estado || ''))).length,
  preloaded_products_status_preserved: preloadedStatusGaps.length,
  missing_variants: gaps.reduce((sum, row) => sum + Object.keys(row.missingBySize).length, 0),
  missing_pairs: gaps.reduce((sum, row) => sum + row.missingPairs, 0),
  local_rows_to_reopen: flatToReopen.length,
  local_pairs_to_reopen: flatToReopen.reduce((sum, row) => sum + Number(row.cantidad || 0), 0),
  registry_products_retained_as_partial_saz: gaps.filter(row => registryByProduct.has(row.product.id)).length,
  skipped_without_numeric_corrida: skippedNoRun,
  skipped_unsupported_sizes: skippedUnsupportedSizes,
  gaps: gaps.map(row => ({
    product_id: row.product.id,
    estilo: row.product.estilo,
    color: row.product.color,
    corrida: row.product.corrida,
    supabase_pairs_in_run: row.supabasePairs,
    saz_pairs_in_run: row.sazPairsInRun,
    missing_pairs: row.missingPairs,
    missing_by_size: row.missingBySize,
  })),
  output_xlsx: outputXlsx,
  safeguards: [
    'Solo producto activo, precio > 0 y presente en el Excel de SAZ.',
    'Solo talla con Supabase > 0 y SAZ = 0 dentro de la corrida.',
    'No se modifica existencia, precio ni imagen.',
    'El registro y la proyección parcial de SAZ se conservan para no perder pares ya confirmados.',
    'YA PRECARGADO EN SAZ conserva su estatus aunque se incluya su existencia faltante.',
    'El Excel de salida contiene únicamente las tallas faltantes para evitar duplicar pares existentes.',
  ],
};
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ report: reportPath, ...report, gaps: report.gaps.slice(0, 20) }, null, 2));
if (!apply) {
  console.log('\nSimulación lista. Usa --apply para reabrir estatus y generar el Excel SAZ.');
  process.exit(0);
}

const now = new Date().toISOString();
for (const group of chunks(pendingStatusGaps.map(row => row.product.id), 80)) {
  if (!group.length) continue;
  await rest(`products?id=in.(${group.join(',')})&organization_id=eq.${organization.id}`, {
    method: 'PATCH', body: { estado: 'PENDIENTE DE SAZ' }, prefer: 'return=minimal',
  });
}
for (const group of chunks(flatToReopen, 16)) {
  await Promise.all(group.map(row => rest(`inventory_items?user_id=eq.${encodeURIComponent(row.user_id)}&item_key=eq.${encodeURIComponent(row.item_key)}`, {
    method: 'PATCH', body: { saz_cargado: false, saz_cargado_at: null }, prefer: 'return=minimal',
  })));
}

const workbook = XLSX.utils.book_new();
const inventorySheet = XLSX.utils.json_to_sheet(inventoryRows, { header: prep.INVENTORY_HEADERS });
const resumenSheet = XLSX.utils.json_to_sheet(resumenRows, { header: prep.RESUMEN_HEADERS });
inventorySheet['!cols'] = prep.INVENTORY_HEADERS.map(header => ({ wch: /^\d+\.\d$/.test(header) ? 7 : Math.min(28, Math.max(11, header.length + 2)) }));
resumenSheet['!cols'] = prep.RESUMEN_HEADERS.map(header => ({ wch: Math.max(16, header.length + 2) }));
XLSX.utils.book_append_sheet(workbook, inventorySheet, prep.INVENTORY_SHEET);
XLSX.utils.book_append_sheet(workbook, resumenSheet, prep.RESUMEN_SHEET);
fs.mkdirSync(path.dirname(outputXlsx), { recursive: true });
XLSX.writeFile(workbook, outputXlsx);

await rest('inventory_migration_runs', {
  method: 'POST',
  body: {
    organization_id: organization.id,
    branch_id: juarez.id,
    source_summary: {
      source_file: path.basename(excelPath),
      output_file: path.basename(outputXlsx),
      mode: 'priced_saz_missing_stock_reopened',
      domain_event: 'ReviewOpened',
      status: 'PENDIENTE DE SAZ',
      missing_pairs: report.missing_pairs,
    },
    product_count: gaps.length,
    variant_count: report.missing_variants,
    pair_count: report.missing_pairs,
    created_by: userId,
  },
  prefer: 'return=minimal',
});

const afterProducts = [];
for (const group of chunks(pendingStatusGaps.map(row => row.product.id), 80)) {
  if (!group.length) continue;
  afterProducts.push(...await allRows(`products?select=id,estado&id=in.(${group.join(',')})`));
}
const wrongStatus = afterProducts.filter(row => row.estado !== 'PENDIENTE DE SAZ');
if (wrongStatus.length) throw new Error(`${wrongStatus.length} producto(s) no quedaron PENDIENTE DE SAZ.`);
const preloadedAfter = [];
for (const group of chunks(preloadedStatusGaps.map(row => row.product.id), 80)) {
  if (!group.length) continue;
  preloadedAfter.push(...await allRows(`products?select=id,source_system,estado&id=in.(${group.join(',')})`));
}
const wrongPreloaded = preloadedAfter.filter(row => row.source_system !== 'saz_precargado' && !/PRECARGADO EN SAZ/i.test(String(row.estado || '')));
if (wrongPreloaded.length) throw new Error(`${wrongPreloaded.length} producto(s) precargado(s) perdieron su clasificación.`);
if (!fs.existsSync(outputXlsx)) throw new Error('No se generó el Excel de pendientes.');

report.applied = {
  completed: true,
  products_reopened: gaps.length,
  products_set_pending: pendingStatusGaps.length,
  preloaded_status_preserved: preloadedStatusGaps.length,
  variants_exported: report.missing_variants,
  pairs_exported: report.missing_pairs,
  local_rows_reopened: flatToReopen.length,
  local_pairs_reopened: report.local_pairs_to_reopen,
  output_xlsx: outputXlsx,
};
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.applied, null, 2));
