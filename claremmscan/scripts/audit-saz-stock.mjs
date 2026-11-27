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
const { createWorklistPlanner, range } = require('../lib/saz-run-worklist.js');
const { corridaContainsSize, normalizeLine, parseCorridaText } = require('../lib/corridas-core.js');
const [input, output, planPath, ...flags] = process.argv.slice(2);
const apply = flags.includes('--apply');
const withRuns = flags.includes('--corridas');
if (!input || !output || !planPath || flags.some(flag => !['--apply', '--corridas'].includes(flag))) {
  throw new Error('Uso: node audit-saz-stock.mjs origen.xls reporte.xlsx plan.json [--corridas] [--apply]');
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
let planRuns;
const registryKeys = new Set();
if (withRuns) {
  const [master, relations, registry] = await Promise.all([
    readAll('corridas', { select: 'id,linea,talla_inicial,talla_final,incremento,activa', organization_id: `eq.${org}`, activa: 'eq.true', order: 'id' }),
    readAll('estilo_corridas', { select: 'estilo_key,corrida_id,orden', organization_id: `eq.${org}`, order: 'estilo_key,orden,corrida_id' }),
    readAll('saz_product_registry', { select: 'estilo,color', organization_id: `eq.${org}`, order: 'id' }),
  ]);
  if (!master.length) throw new Error('CLAREMM todavía no tiene corridas activas.');
  planRuns = createWorklistPlanner(master, relations);
  for (const entry of registry) registryKeys.add(keyFor(entry));
}
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
const worklist = [];
const runIssues = [];
const runChanges = [];
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
  const presence = official ? 'Figura en el corte' : registryKeys.has(key) ? 'Registrada en SAZ, ausente del corte' : 'Por confirmar';
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
      const unclassified = withRuns && !String(row.estado || '').trim() && group.stockedProducts.has(row.id);
      if ((!loaded && !unclassified) || row.estado === target) continue;
      changes.push({ id: row.id, key, before: row.estado, after: target, updatedAt: row.updated_at });
    }
    gaps.push({ product, result, presence, qtyToLoad, due, current: sum([...app.values()]), confirmed: official?.pairs || 0 });
  }
  if (planRuns && app.size) {
    const confirmed = Object.fromEntries(Object.entries(official?.quantities || {}).filter(([, qty]) => qty > 0));
    const planned = planRuns({
      product, application: Object.fromEntries(app), confirmed, due: qtyToLoad, stockRecordCount: candidates.length,
    });
    const base = {
      Estilo: product.estilo, Color: product.color, Marca: product.marca, Proveedor: product.proveedor,
      'Línea actual': product.linea, 'Corrida actual': product.corrida, Resultado: result, 'Presencia SAZ': presence,
    };
    if (planned.issue) {
      runIssues.push({
        ...base, Motivo: planned.issue, 'Propuesta por tallas': planned.suggested || '', Opciones: planned.options?.join(' / ') || '',
        'Tallas observadas': [...new Set([...app.keys(), ...Object.keys(confirmed)])].sort(compareSize).join(', '),
        'Total por cargar': due, Detalle: Object.entries(qtyToLoad).map(([size, qty]) => `${size}: ${qty}`).join(', '),
      });
    } else {
      const label = run => `${run.linea} ${range(run)} (+${Number(run.incremento)})`;
      const original = parseCorridaText(product.corrida, product.linea);
      const matchesOriginal = run => normalizeLine(run.linea) === normalizeLine(product.linea)
        && Number(run.talla_inicial) === original.inicial && Number(run.talla_final) === original.final;
      if (planned.runs.length > 1 || planned.runs.some(run => !matchesOriginal(run))) {
        runChanges.push({ ...base, 'Corridas de trabajo': planned.runs.map(label).join(' / '), 'Relación en Supabase': planned.assigned ? 'Sí' : 'Por validar', 'Total por cargar': due });
      }
      for (const { run, quantities } of planned.groups) {
        const sourceIdentifiesRun = Object.keys(confirmed).some(size => corridaContainsSize(run, size)
          && !planned.runs.some(other => other.id !== run.id && corridaContainsSize(other, size)));
        const needsPrice = planned.runs.length > 1 && !matchesOriginal(run);
        worklist.push({
          ...base,
          'Línea SAZ': run.linea, Corrida: range(run), Incremento: Number(run.incremento),
          'Acción SAZ': !official ? (registryKeys.has(key) ? 'Verificar existencia actual del tramo en SAZ' : 'Buscar ficha y dar de alta si falta')
            : planned.runs.length === 1 || sourceIdentifiesRun ? 'Confirmar destino y cargar diferencia'
              : 'Confirmar si existe el tramo antes de cargar',
          'Precio actual de ficha': Number(product.precio) || null,
          'Precio de corrida': needsPrice ? 'Validar precio del tramo' : Number(product.precio) || 'Validar precio',
          Acabado: product.acabado, Temporada: product.temporada, Sublínea: product.sublinea,
          Clasificación: product.clasificacion, Departamento: product.departamento, Catálogo: product.catalogo,
          'Total por cargar': sum(Object.values(quantities)), ...quantities,
        });
      }
      if (Object.keys(planned.ambiguous).length) {
        runIssues.push({ ...base, Motivo: 'El corte ya contiene stock en una talla compartida; confirmar el tramo de destino',
          'Propuesta por tallas': '',
          'Total por cargar': sum(Object.values(planned.ambiguous)), Detalle: Object.entries(planned.ambiguous).map(([size, qty]) => `${size}: ${qty}`).join(', ') });
      }
    }
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
  const inventoryRows = gaps.map(({ product, result, presence, qtyToLoad, due, current, confirmed }) => {
    const row = prep.toInventoryRows([{ ...product, color: colorKey(product.color), qtyBySize: qtyToLoad, pares: due }])[0];
    delete row['Total Existencia'];
    return { ...row, ...qtyToLoad, 'Existencia JUÁREZ': current, 'Existencia SAZ al corte': confirmed, 'Total por cargar': due, Resultado: result,
      ...(withRuns ? { 'Presencia SAZ': presence } : {}) };
  });
  const loadHeaders = ['Estilo', 'Color', 'Existencia JUÁREZ', 'Existencia SAZ al corte', 'Total por cargar', 'Resultado',
    ...(withRuns ? ['Presencia SAZ'] : []), ...prep.FIXED_HEADERS.slice(2), ...sizeCols];
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
  if (planRuns) {
    const assignedPairs = sum(worklist.map(row => row['Total por cargar']));
    const reviewPairs = sum(runIssues.map(row => row['Total por cargar']));
    if (assignedPairs + reviewPairs !== summary.paresPorCargar) throw new Error('Los pares del reporte por corrida no cuadran con el saldo.');
    addSheet('Resumen corridas', [
      { Indicador: 'Pares distribuidos por corrida', Valor: assignedPairs },
      { Indicador: 'Pares pendientes de validar corrida', Valor: reviewPairs },
      { Indicador: 'Hojas operativas', Valor: 'Por corrida y Revisar corridas. Por cargar conserva el comparativo sin dividir.' },
      { Indicador: 'Media talla compartida', Valor: 'Si el corte no tiene stock en la talla, su saldo se asigna al primer tramo. Con stock en SAZ, el tramo queda por confirmar.' },
      { Indicador: 'Corte SAZ', Valor: saz.fileName },
    ]);
    const sorted = rows => rows.sort((a, b) => String(a.Estilo).localeCompare(String(b.Estilo), 'es', { numeric: true })
      || String(a.Color).localeCompare(String(b.Color), 'es') || String(a.Corrida || '').localeCompare(String(b.Corrida || ''), 'es', { numeric: true }));
    const runSizes = [...new Set(worklist.flatMap(row => Object.keys(row).filter(key => /^\d+\.\d+$/.test(key))))].sort(compareSize);
    const firstRow = worklist[0] || {};
    const header = [...Object.keys(firstRow).filter(key => !runSizes.includes(key)), ...runSizes];
    xlsx.utils.book_append_sheet(book, xlsx.utils.json_to_sheet(sorted(worklist), { header }), 'Por corrida');
    addSheet('Revisar corridas', sorted(runIssues));
    addSheet('Cambios de corrida sugeridos', sorted(runChanges));
    console.log(JSON.stringify({ paresPorCorrida: assignedPairs, paresPorRevisar: reviewPairs, filasPorCorrida: worklist.length, filasParaRevisar: runIssues.length }));
  }
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
