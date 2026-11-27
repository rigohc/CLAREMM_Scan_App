import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../..', import.meta.url));
const xlsx = require(path.join(root, 'CLAREMM Zapateria/backend/node_modules/xlsx'));
const { supabaseSession } = require('../api/v1.js');
const { compactEstilo } = require('../lib/branch-upload-core.js');
const core = require('../lib/corridas-core.js');
const coverage = require('../lib/saz-catalog-coverage.js');
const [catalogFile, comparisonFile, outputFile, ...controlStyles] = process.argv.slice(2);
if (!catalogFile || !comparisonFile || !outputFile) {
  throw new Error('Uso: node --env-file=claremmscan/.env.local claremmscan/scripts/plan-saz-catalog-coverage.mjs catalogo.xlsx comparativo.xlsx salida.xlsx [estilos para control]');
}

const styleKey = value => compactEstilo(value).replace(/-/g, '');
const controls = new Set(controlStyles.map(styleKey));
const quantity = row => row['Pares según corte'];
const pairs = rows => rows.reduce((total, row) => total + quantity(row), 0);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sorted = rows => rows.sort((a, b) => String(a.Estilo).localeCompare(String(b.Estilo), 'es', { numeric: true })
  || String(a.Color).localeCompare(String(b.Color), 'es') || Number(a.Talla) - Number(b.Talla));
const catalogBytes = fs.readFileSync(catalogFile);
const comparisonBytes = fs.readFileSync(comparisonFile);
const session = await supabaseSession();

async function readAll(table, query) {
  const all = [];
  const limit = 1000;
  for (let offset = 0; ; offset += limit) {
    const params = new URLSearchParams({ ...query, limit, offset });
    const response = await fetch(`${session.url}/rest/v1/${table}?${params}`, {
      headers: { apikey: session.apiKey, Authorization: `Bearer ${session.token}` },
    });
    if (!response.ok) throw new Error(`${table}: HTTP ${response.status}`);
    const page = await response.json();
    all.push(...page);
    if (page.length < limit) return all;
  }
}

const organizations = await readAll('organizations', { select: 'id', name: 'eq.CLAREMM', order: 'id' });
assert.equal(organizations.length, 1, 'No se encontró una sola organización CLAREMM');
const organization_id = `eq.${organizations[0].id}`;
const [master, relations] = await Promise.all([
  readAll('corridas', { organization_id, select: 'id,linea,talla_inicial,talla_final,incremento,activa', activa: 'eq.true', order: 'id' }),
  readAll('estilo_corridas', { organization_id, select: 'estilo_key,corrida_id,orden,fuente', order: 'estilo_key,orden,corrida_id' }),
]);
assert.ok(master.length > 0, 'Sin tabla maestra de corridas');
const masterById = new Map(master.map(run => [run.id, run]));
const runsByStyle = new Map();
for (const relation of relations) {
  const run = masterById.get(relation.corrida_id);
  if (!run) continue;
  const list = runsByStyle.get(relation.estilo_key) || [];
  list.push({ ...run, fuente: relation.fuente });
  runsByStyle.set(relation.estilo_key, list);
}

const official = xlsx.read(catalogBytes, { type: 'buffer', dense: true });
assert.equal(official.SheetNames.length, 1, 'El catálogo debe tener una sola hoja de registros');
const sheet = official.Sheets[official.SheetNames[0]];
const [header] = xlsx.utils.sheet_to_json(sheet, { header: 1, range: { s: { r: 0, c: 0 }, e: { r: 0, c: 30 } } });
assert.ok(['Estilo', 'Color', 'Corrida', 'Linea', 'Marca', 'Acabado', 'Status'].every(field => header.includes(field)), 'Encabezados de catálogo incompletos');
const catalogRows = xlsx.utils.sheet_to_json(sheet, { defval: '' });
const catalog = coverage.indexCatalog(catalogRows, master);
const comparison = xlsx.read(comparisonBytes, { type: 'buffer', dense: true });
function rows(name) {
  const sheet = comparison.Sheets[name];
  if (!sheet) throw new Error(`Falta la hoja ${name} del comparativo.`);
  return xlsx.utils.sheet_to_json(sheet, { defval: '' });
}

const pending = rows('Por cargar');
const details = rows('Comparativo por talla');
const oldTotal = pending.reduce((sum, row) => sum + Number(row['Total por cargar']), 0);
const pendingByKey = new Map(pending.map(row => [coverage.identity(row), row]));
assert.equal(pendingByKey.size, pending.length, 'Hay fichas duplicadas en Por cargar.');
const groups = new Map();
for (const row of details) {
  const key = coverage.identity(row);
  if (!pendingByKey.has(key)) continue;
  const group = groups.get(key) || [];
  group.push(row);
  groups.set(key, group);
}

const stockOnly = [];
const review = [];
const control = [];
const altas = [];
const proofs = [];
const checks = new Set();
for (const [key, ficha] of pendingByKey) {
  const style = styleKey(ficha.Estilo);
  const evidence = catalog.get(key) || [];
  const presentation = coverage.choosePresentation(evidence, ficha);
  const assigned = runsByStyle.get(style) || [];
  const cross = groups.get(key) || [];
  const registered = coverage.registeredSizes(evidence, cross.filter(row => Number(row.SAZ) > 0).map(row => row.Talla));
  const unregistered = [];
  const cutAbsent = ficha.Resultado === 'FICHA AUSENTE EN EXCEL';
  for (const entry of evidence) proofs.push({
    Estilo: ficha.Estilo, Color: ficha.Color, Marca: entry.marca, Acabado: entry.acabado,
    'Línea SAZ': entry.linea, 'Corrida SAZ': entry.sourceRange, 'Incrementos posibles': entry.valid ? entry.steps.join(' / ') : '',
    'Precio de referencia SAZ': entry.price, Status: entry.status, 'Fila Excel': entry.row,
  });
  for (const data of cross) {
    const count = Number(data['Pares por cargar']);
    if (count <= 0) continue;
    const size = String(data.Talla);
    const check = `${key}|${size}`;
    assert.ok(!checks.has(check), `Saldo de talla duplicado: ${check}`);
    checks.add(check);
    const result = coverage.classifySize({ ficha, size, confirmed: Number(data.SAZ), presentation, keepForControl: controls.has(style) });
    const row = {
      Estilo: ficha.Estilo, Color: ficha.Color, Marca: ficha.Marca, Acabado: ficha['Material/Acabado'], Talla: size,
      'Pares JUÁREZ': Number(data.Aplicativo), 'Pares SAZ en el corte': cutAbsent ? '' : Number(data.SAZ),
      'Pares según corte': count, 'Corridas en catálogo': (result.runs || []).map(run => `${run.linea} ${coverage.range(run)}`).join(' / '),
      'Filas en catálogo': (result.runs || []).flatMap(run => run.files).join(', '),
    };
    if (result.kind === 'control') {
      control.push({ ...row, Acción: result.reason });
      continue;
    }
    if (result.kind === 'review') {
      review.push({ ...row, Acción: result.reason });
      continue;
    }
    if (result.kind === 'new') {
      if (registered.has(core.formatSize(size))) {
        review.push({ ...row, Acción: 'Hay una presentación de este estilo y color que ya abarca la talla. Confirmar el destino en SAZ.' });
      } else {
        unregistered.push(row);
      }
      continue;
    }
    const [actual] = result.runs;
    const confirmed = assigned.find(run => run.fuente?.startsWith('confirmado_negocio')
      && Number(run.talla_inicial) === actual.inicial && Number(run.talla_final) === actual.final);
    const lineConflict = confirmed && core.normalizeLine(confirmed.linea) !== actual.linea;
    const lineNote = lineConflict ? `El catálogo dice ${actual.linea}. El negocio confirmó ${confirmed.linea}. Verificar línea actual en SAZ.` : '';
    stockOnly.push({
      ...row, 'Línea según catálogo': actual.linea, 'Corrida según catálogo': coverage.range(actual),
      Acción: [lineNote, result.reason, cutAbsent ? 'Verificar el stock actual antes de cargar.' : 'Cargar solo la diferencia actual.'].filter(Boolean).join(' '),
    });
  }
  if (!unregistered.length) continue;
  const proposed = coverage.proposeRuns({ pending: unregistered.map(row => row.Talla), registered, line: ficha.Linea, master, assigned });
  for (const row of unregistered) {
    const run = proposed.find(run => core.corridaContainsSize(run, row.Talla));
    if (!run) {
      review.push({ ...row, Acción: 'Falta una corrida de calzado verificable para esta línea y talla.' });
      continue;
    }
    altas.push({
      ...row, 'Tipo de alta': evidence.length ? 'Talla adicional' : 'Ficha y tallas',
      'Línea propuesta': run.linea, 'Corrida propuesta': coverage.range(run), Incremento: run.incremento,
      'Origen de la corrida': run.source, 'Sublínea': ficha.Sublinea, Proveedor: ficha.Proveedor,
      'Temporada': ficha.Temporada, 'Clasificación': ficha.Clasificacion, 'Catálogo': ficha.Catalogo,
      'Costo en aplicativo': ficha.Costo, 'Precio en aplicativo': ficha['Precio de venta'],
      Acción: 'Confirmar el alta en SAZ y después cargar la diferencia de existencia.',
    });
  }
}

const allWork = [...stockOnly, ...altas, ...review, ...control];
assert.equal(pairs(allWork), oldTotal, 'Las hojas operativas deben conservar el saldo del comparativo');
assert.equal(allWork.length, checks.size, 'Cada talla pendiente debe aparecer una sola vez');
assert.equal(oldTotal, details.reduce((total, row) => total + Number(row['Pares por cargar']), 0), 'El detalle por talla no cuadra');
const byRun = new Map();
for (const row of sorted(altas)) {
  const key = `${coverage.identity(row)}|${row['Línea propuesta']}|${row['Corrida propuesta']}|${row.Incremento}`;
  const group = byRun.get(key) || {
    Estilo: row.Estilo, Color: row.Color, Marca: row.Marca, Acabado: row.Acabado,
    'Tipo de alta': row['Tipo de alta'], 'Línea propuesta': row['Línea propuesta'], 'Corrida propuesta': row['Corrida propuesta'],
    Incremento: row.Incremento, 'Origen de la corrida': row['Origen de la corrida'],
    'Tallas pendientes': [], 'Pares según corte': 0,
  };
  group['Tallas pendientes'].push(`${row.Talla} (${quantity(row)})`);
  group['Pares según corte'] += quantity(row);
  byRun.set(key, group);
}

const out = xlsx.utils.book_new();
function add(name, entries) {
  const sheet = xlsx.utils.json_to_sheet(entries);
  if (sheet['!ref']) {
    sheet['!autofilter'] = { ref: sheet['!ref'] };
    sheet['!cols'] = Object.keys(entries[0]).map(key => ({ wch: ['Acción', 'Corridas en catálogo', 'Valor'].includes(key) ? 72 : Math.max(14, key.length + 2) }));
  }
  xlsx.utils.book_append_sheet(out, sheet, name);
}
const source = rows('Resumen').find(row => row.Indicador === 'archivo')?.Valor || '';
add('Resumen', [
  ['Catálogo de SAZ', path.basename(catalogFile)],
  ['Corte de existencias SAZ', source],
  ['Registros del catálogo', catalogRows.length],
  ['Pares con diferencia según el corte', oldTotal],
  ['Pares en tallas ya dadas de alta', pairs(stockOnly)],
  ['Pares en posibles nuevas tallas', pairs(altas)],
  ['Pares con ficha o corrida por confirmar', pairs(review)],
  ['Pares apartados para control', pairs(control)],
  ['Comparación', 'Una talla se da de alta una vez por estilo y color. Solo existencia registra el saldo, incluso si el catálogo confirma la talla y el corte no la trae.'],
  ['Control de tamaños', 'El Excel de catálogo trae rangos. Para calzado se usa el incremento de la tabla maestra cuando coincide el rango y medio número como referencia si el archivo omite el incremento.'],
  ['SHA-256 catálogo', sha256(catalogBytes)],
  ['SHA-256 comparativo', sha256(comparisonBytes)],
].map(([Indicador, Valor]) => ({ Indicador, Valor })));
add('Solo existencia', sorted(stockOnly));
add('Corridas para alta', [...byRun.values()].map(row => ({ ...row, 'Tallas pendientes': row['Tallas pendientes'].join(', ') })));
add('Altas de tallas', sorted(altas));
add('Verificar', sorted(review));
add('Control', sorted(control));
add('Evidencia catálogo SAZ', sorted(proofs));
add('Incidencias del corte', rows('Incidencias'));

fs.writeFileSync(outputFile, xlsx.write(out, { type: 'buffer', bookType: 'xlsx', compression: true }), { flag: 'wx' });
console.log(JSON.stringify({
  catalogRows: catalogRows.length, pendingPairs: oldTotal, pendingSizes: checks.size,
  soloExistencia: { tallas: stockOnly.length, pares: pairs(stockOnly) },
  altas: { tallas: altas.length, pares: pairs(altas) },
  revisar: { tallas: review.length, pares: pairs(review) },
  control: { tallas: control.length, pares: pairs(control) },
}));
