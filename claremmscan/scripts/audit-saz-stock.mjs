import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../..', import.meta.url));
const xlsx = require(path.join(root, 'CLAREMM Zapateria/backend/node_modules/xlsx'));
const { parseMatrix, normalize, compactEstilo, sizeKey } = require('../saz-reconcile.js');
const prep = require('../saz-prep-excel.js');
const [input, output, planPath, apply] = process.argv.slice(2);
if (!input || !output || !planPath || (apply && apply !== '--apply')) {
  throw new Error('Uso: node audit-saz-stock.mjs origen.xls reporte.xlsx plan.json [--apply]');
}

const colorAliases = new Map([
  ['N/B', 'NEGRO BLANCO'], ['NB', 'NEGRO BLANCO'], ['B/N', 'BLANCO NEGRO'], ['BN', 'BLANCO NEGRO'],
  ['FUCSIA', 'FIUSHA'], ['FUCHSIA', 'FIUSHA'],
]);
const colorKey = value => colorAliases.get(normalize(value)) || normalize(value);
const keyFor = ({ estilo, color }) => `${compactEstilo(estilo)}|${colorKey(color)}`;
const sum = values => values.reduce((total, value) => total + value, 0);
const digest = value => createHash('sha256').update(value).digest('hex');
const pending = 'PENDIENTE EN SAZ';
const preloadedPending = 'PRECARGADO SIN STOCK';
const isPreloaded = product => product.source_system === 'saz_precargado' || product.estado === 'YA PRECARGADO EN SAZ' || product.estado === preloadedPending;

const bytes = fs.readFileSync(input);
const sourceHash = digest(bytes);
const wb = xlsx.read(bytes, { type: 'buffer' });
if (wb.SheetNames.length !== 1) throw new Error('Se esperaba una sola hoja de existencias.');
const matrix = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', blankrows: true });
const columns = matrix[0].map(normalize);
const detailRows = matrix.slice(1).filter(row => row[0]);
if (!detailRows.length || detailRows.some(row => !/CLAREMM ZAPATERIA JUAREZ$/.test(normalize(row[0])))) {
  throw new Error('El Excel debe corresponder exclusivamente a CLAREMM ZAPATERÍA JUÁREZ.');
}
const totalIndex = columns.indexOf('TOTAL');
const footer = matrix.at(-1);
if (Number(footer[1]) !== detailRows.length || Number(footer[totalIndex]) !== sum(detailRows.map(row => Number(row[totalIndex])))) {
  throw new Error('El número de filas o el total general no cuadra con el pie del Excel.');
}
for (const row of detailRows) {
  for (const value of row.slice(columns.indexOf('FORRO') + 1, totalIndex + 1)) {
    if (value !== '' && !Number.isSafeInteger(Number(value))) throw new Error('El Excel contiene una cantidad inválida.');
  }
}
const saz = parseMatrix(matrix, path.basename(input), colorKey);
if (saz.sourceRows !== detailRows.length || saz.blockedRows.some(row => !row.estilo || !row.color)) {
  throw new Error('Hay filas de SAZ sin identidad o sin sucursal verificable.');
}
const sazByKey = new Map(saz.products.map(row => [row.key, row]));
const blocked = new Set(saz.blockedRows.map(keyFor));

const env = { ...Object.fromEntries(fs.readFileSync(path.join(root, 'claremmscan/.env.local'), 'utf8')
  .split(/\r?\n/).map(line => line.match(/^\s*(\w+)\s*=\s*(.*?)\s*$/)).filter(Boolean)
  .map(([, key, value]) => [key, value.replace(/^(['"])(.*)\1$/, '$2')])), ...process.env };
const base = env.SUPABASE_URL;
const apikey = env.SUPABASE_PUBLISHABLE_KEY;
const auth = await fetch(`${base}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: env.SUPABASE_MIGRATION_EMAIL, password: env.SUPABASE_MIGRATION_PASSWORD }),
});
if (!auth.ok) throw new Error(`Autenticación HTTP ${auth.status}`);
const account = await auth.json();
const headers = { apikey, Authorization: `Bearer ${account.access_token}` };

async function rest(resource, query, patch) {
  const result = await fetch(`${base}/rest/v1/${resource}?${new URLSearchParams(query)}`, patch ? {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  } : { headers });
  if (!result.ok) throw new Error(`${resource} HTTP ${result.status}: ${(await result.json()).message}`);
  return result.json();
}

async function readAll(resource, query) {
  const rows = [];
  const limit = 1000;
  for (let offset = 0; ; offset += 4 * limit) {
    const pages = await Promise.all(Array.from({ length: 4 }, (_, i) => rest(resource, { ...query, limit, offset: offset + i * limit })));
    for (const page of pages) {
      rows.push(...page);
      if (page.length < limit) return rows;
    }
  }
}

const branches = await rest('branches', { select: 'id,organization_id,organizations!inner(name)', code: 'eq.JUAREZ', active: 'eq.true' });
const branchesInClaremm = branches.filter(row => normalize(row.organizations.name) === 'CLAREMM');
if (branchesInClaremm.length !== 1) throw new Error('No se identificó una sola sucursal JUÁREZ en CLAREMM.');
const [{ id: branchId, organization_id: org }] = branchesInClaremm;
const [products, stocks] = await Promise.all([
  readAll('products', {
    select: 'id,estilo,color,marca,precio,proveedor,temporada,sublinea,departamento,clasificacion,linea,corrida,acabado,suela,plantilla,tacon,forro,catalogo,status,costo,estado,source_system,updated_at',
    organization_id: `eq.${org}`, activo: 'eq.true', order: 'id',
  }),
  readAll('inventory_levels', { select: 'variant_id,quantity,product_variants!inner(product_id,size)', branch_id: `eq.${branchId}`, quantity: 'gt.0', order: 'variant_id' }),
]);
if (!products.length || !stocks.length || new Set(products.map(row => row.id)).size !== products.length
  || new Set(stocks.map(row => row.variant_id)).size !== stocks.length) throw new Error('Lectura de inventario incompleta o duplicada.');
console.log(`Leídas ${products.length} fichas activas y ${stocks.length} tallas con stock en JUÁREZ.`);

const byProduct = new Map(products.map(product => [product.id, product]));
const groups = new Map();
const appIncidents = [];
for (const product of products) {
  const key = keyFor(product);
  if (!groups.has(key)) groups.set(key, { products: [], quantities: new Map(), stockedProducts: new Set() });
  groups.get(key).products.push(product);
}
for (const { quantity, product_variants: variant } of stocks) {
  const product = byProduct.get(variant.product_id);
  if (!product) continue;
  if (!compactEstilo(product.estilo) || !colorKey(product.color) || !String(variant.size).trim() || !Number.isSafeInteger(quantity)) {
    if (compactEstilo(product.estilo) && colorKey(product.color)) blocked.add(keyFor(product));
    appIncidents.push({
      ficha: product.id, estilo: product.estilo, color: product.color, talla: variant.size, cantidad: quantity,
      reason: 'identidad_o_cantidad_invalida_en_aplicativo',
    });
    continue;
  }
  const group = groups.get(keyFor(product));
  const size = sizeKey(variant.size);
  group.stockedProducts.add(product.id);
  group.quantities.set(size, (group.quantities.get(size) || 0) + quantity);
}

const compareSize = (a, b) => a.localeCompare(b, 'es', { numeric: true });
const changes = [];
const lines = [];
const details = [];
const gaps = [];
let zeroInBoth = 0;
let preloadedZeroAndAbsent = 0;

for (const key of new Set([...groups.keys(), ...sazByKey.keys(), ...blocked])) {
  const group = groups.get(key);
  const official = sazByKey.get(key);
  const app = group?.quantities || new Map();
  const candidates = group?.products.filter(row => group.stockedProducts.has(row.id)) || [];
  const product = candidates.find(row => row.precio > 0) || candidates[0] || group?.products[0] || official;
  if (blocked.has(key)) continue;
  if (!app.size && !official) {
    zeroInBoth++;
    if (group?.products.some(isPreloaded)) preloadedZeroAndAbsent++;
    continue;
  }
  const qtyToLoad = {};
  let surplus = 0;
  let missingSizes = 0;
  let shortSizes = 0;
  const sizes = [...new Set([...app.keys(), ...Object.keys(official?.quantities || {})])].sort(compareSize);
  for (const size of sizes) {
    const application = app.get(size) || 0;
    const inSaz = official?.quantities[size] || 0;
    const missing = Math.max(0, application - inSaz);
    const extra = Math.max(0, inSaz - application);
    if (missing) qtyToLoad[size] = missing;
    if (missing && !inSaz) missingSizes++;
    if (missing && inSaz) shortSizes++;
    surplus += extra;
    details.push({
      Estilo: product.estilo, Color: colorKey(product.color), Talla: size, Aplicativo: application, SAZ: inSaz,
      'Pares por cargar': missing, 'Pares de más en SAZ': extra,
      Resultado: missing ? (inSaz ? 'CANTIDAD INFERIOR EN SAZ' : 'TALLA SIN STOCK EN SAZ') : extra ? 'MAYOR EN SAZ' : 'IGUAL',
    });
  }
  const due = sum(Object.values(qtyToLoad));
  const result = !group ? 'SOLO EN SAZ' : !official ? 'FICHA AUSENTE EN EXCEL'
    : !official.pairs && due ? 'FICHA EN EXCEL SIN STOCK'
    : due ? 'FALTANTE PARCIAL' : surplus ? 'MAYOR EN SAZ' : 'COINCIDE';
  const statuses = new Set();
  if (due) {
    // If legacy records share this identity, update explicit SAZ statuses for all
    // of them so a registered duplicate cannot hide a pending ficha.
    for (const row of group.products) {
      const preloaded = isPreloaded(row);
      const loaded = /^(REGISTRADO EN SAZ|CARGADO EN SAZ|YA PRECARGADO EN SAZ)$/i.test(row.estado);
      const target = preloaded ? preloadedPending : pending;
      if (loaded || group.stockedProducts.has(row.id)) statuses.add(target);
      if (!loaded || row.estado === target) continue;
      changes.push({ id: row.id, key, before: row.estado, after: target, updatedAt: row.updated_at });
    }
    gaps.push({ product, result, qtyToLoad, due, current: sum([...app.values()]), confirmed: official?.pairs || 0 });
  }
  lines.push({
    Estilo: product.estilo, Color: colorKey(product.color), Marca: product.marca || '',
    Resultado: result, 'Pares aplicativo': sum([...app.values()]), 'Pares SAZ': official?.pairs || 0,
    'Tallas aplicativo': app.size, 'Tallas SAZ': Object.keys(official?.quantities || {}).length,
    'Tallas sin stock SAZ': missingSizes, 'Tallas con cantidad menor': shortSizes, 'Pares por cargar': due,
    'Pares de más en SAZ': surplus, 'Estado actual': [...new Set(group?.products.map(row => row.estado) || [])].join(' / '),
    'Estado de la ficha pendiente': [...statuses].join(' / '), 'Registros del aplicativo agrupados': group?.products.length || 0,
  });
}

const orderedChanges = changes.sort((a, b) => a.id.localeCompare(b.id));
const summary = {
  archivo: saz.fileName, sucursal: 'JUÁREZ', filasExcel: saz.sourceRows, paresExcel: Number(footer[totalIndex]),
  fichasActivasAplicativo: products.length, fichasConStockAplicativo: [...groups.values()].filter(group => group.quantities.size).length,
  fichasSinStockEnAmbos: zeroInBoth, precargadasSinStockEnAmbos: preloadedZeroAndAbsent,
  fichasAusentesConStock: lines.filter(row => row.Resultado === 'FICHA AUSENTE EN EXCEL').length,
  paresDeFichasAusentes: sum(lines.filter(row => row.Resultado === 'FICHA AUSENTE EN EXCEL').map(row => row['Pares por cargar'])),
  fichasPresentesConFaltantes: lines.filter(row => row.Resultado === 'FALTANTE PARCIAL' || row.Resultado === 'FICHA EN EXCEL SIN STOCK').length,
  fichasCoincidentes: lines.filter(row => row.Resultado === 'COINCIDE').length, fichasPorCargar: gaps.length,
  tallasSinStockSaz: sum(lines.map(row => row['Tallas sin stock SAZ'])),
  tallasCantidadMenor: sum(lines.map(row => row['Tallas con cantidad menor'])),
  paresPorCargar: sum(gaps.map(row => row.due)), paresDeMasEnSaz: sum(lines.map(row => row['Pares de más en SAZ'])),
  registrosAPendiente: changes.filter(row => row.after === pending).length,
  registrosAPrecargadoSinStock: changes.filter(row => row.after === preloadedPending).length,
  fichasBloqueadas: blocked.size, incidenciasAplicativo: appIncidents.length,
};
const plan = {
  sourceHash, summary, changes: orderedChanges,
  comparisonHash: digest(JSON.stringify(details.sort((a, b) => keyFor({ estilo: a.Estilo, color: a.Color })
    .localeCompare(keyFor({ estilo: b.Estilo, color: b.Color })) || compareSize(a.Talla, b.Talla)))),
};

if (!apply) {
  const book = xlsx.utils.book_new();
  const addSheet = (name, rows) => xlsx.utils.book_append_sheet(book, xlsx.utils.json_to_sheet(rows), name);
  addSheet('Resumen', [
    ...Object.entries(summary).map(([Indicador, Valor]) => ({ Indicador, Valor })),
    { Indicador: 'Por cargar', Valor: 'Contiene únicamente diferencias positivas por talla. Revisar ventas o movimientos posteriores al corte antes de subir.' },
    { Indicador: 'Incidencias', Valor: 'Se excluye la ficha completa si una fila del Excel es inválida.' },
  ]);
  const sizeCols = [...new Set([...prep.SIZE_HEADERS, ...gaps.flatMap(row => Object.keys(row.qtyToLoad))])].sort(compareSize);
  const inventoryRows = gaps.map(({ product, result, qtyToLoad, due, current, confirmed }) => {
    const row = prep.toInventoryRows([{ ...product, color: colorKey(product.color), qtyBySize: qtyToLoad, pares: due }])[0];
    delete row['Total Existencia'];
    return { ...row, ...qtyToLoad, 'Existencia JUÁREZ': current, 'Existencia SAZ al corte': confirmed, 'Total por cargar': due, Resultado: result };
  });
  const loadHeaders = ['Estilo', 'Color', 'Existencia JUÁREZ', 'Existencia SAZ al corte', 'Total por cargar', 'Resultado', ...prep.FIXED_HEADERS.slice(2), ...sizeCols];
  const loadSheet = xlsx.utils.json_to_sheet(inventoryRows, { header: loadHeaders });
  xlsx.utils.book_append_sheet(book, loadSheet, 'Por cargar');
  addSheet('Comparativo por ficha', lines);
  addSheet('Comparativo por talla', details);
  addSheet('Cambios de estado', orderedChanges.map(({ id, key, before, after }) => ({
    Ficha: key, 'Estado anterior': before, 'Estado corregido': after, 'ID aplicativo': id,
  })));
  addSheet('Incidencias', [
    ...saz.blockedRows.map(({ negatives, ...row }) => ({
      origen: 'SAZ', ...row, tallasNegativas: (negatives || []).map(item => `${item.size}: ${item.quantity}`).join(', '),
    })),
    ...appIncidents.map(row => ({ origen: 'Aplicativo', ...row })),
  ]);
  xlsx.writeFile(book, output, { compression: true });
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2), { flag: 'wx' });
} else {
  const saved = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  if (saved.sourceHash !== sourceHash || saved.comparisonHash !== plan.comparisonHash
    || JSON.stringify(saved.changes) !== JSON.stringify(orderedChanges)) {
    throw new Error('El Excel, las cantidades o los estados cambiaron desde el informe. Genera otro plan antes de aplicar.');
  }
  const roles = await rest('organization_members', { select: 'role', organization_id: `eq.${org}`, user_id: `eq.${account.user.id}` });
  if (!roles.some(({ role }) => ['admin', 'editor', 'operator'].includes(role))) {
    throw new Error('La cuenta no tiene un rol de edición en CLAREMM.');
  }
  for (let i = 0; i < orderedChanges.length; i += 12) {
    const batch = await Promise.allSettled(orderedChanges.slice(i, i + 12).map(async change => {
      const updated = await rest('products', {
        select: 'id,estado', organization_id: `eq.${org}`, id: `eq.${change.id}`,
        estado: `eq.${change.before}`, updated_at: `eq.${change.updatedAt}`, activo: 'eq.true',
      }, { estado: change.after });
      if (updated.length !== 1 || updated[0].estado !== change.after) throw new Error(`Conflicto en ${change.key} (${change.id})`);
    }));
    const failures = batch.filter(row => row.status === 'rejected');
    if (failures.length) throw new Error(`Lote parcial después de ${i} cambios verificados: ${failures.map(row => row.reason.message).join(', ')}`);
    console.log(`Estados verificados: ${Math.min(i + 12, changes.length)}/${changes.length}.`);
  }
}
console.log(JSON.stringify(summary, null, 2));
