'use strict';

const catalog = require('./corridas-core.js');
const { normalize, lookupKey } = require('./branch-upload-core.js');

const range = run => `${run.inicial.toFixed(2)}-${run.final.toFixed(2)}`;
const sizeLabel = n => n.toFixed(1);
const identity = row => lookupKey(row.Estilo, row.Color);
const contains = (run, size, step) => size >= run.inicial && size <= run.final
  && Number.isInteger((size - run.inicial) / step);

function indexCatalog(rows, master) {
  const masterByRange = new Map();
  for (const definition of master) {
    const run = catalog.validateCorrida(definition);
    if (!run.valid || definition.activa === false) continue;
    const key = `${run.linea}|${range(run)}`;
    const steps = masterByRange.get(key) || new Set();
    steps.add(run.incremento);
    masterByRange.set(key, steps);
  }
  const byIdentity = new Map();
  for (const row of rows) {
    if (!String(row.Estilo ?? '').trim() || !String(row.Color ?? '').trim()) continue;
    const key = identity(row);
    const parsed = catalog.parseCorridaText(row.Corrida, row.Linea);
    const steps = parsed.valid ? [...(masterByRange.get(`${parsed.linea}|${range(parsed)}`) || [])] : [];
    const entry = {
      ...parsed, steps: steps.length ? steps : [0.5],
      marca: normalize(row.Marca), acabado: normalize(row.Acabado),
      sourceRange: String(row.Corrida ?? '').trim(), price: row.Precio,
      status: Number(row.Status), row: row.__rowNum__ + 1,
    };
    const group = byIdentity.get(key) || [];
    group.push(entry);
    byIdentity.set(key, group);
  }
  return byIdentity;
}

function choosePresentation(entries, ficha) {
  const brand = normalize(ficha.Marca);
  const finish = normalize(ficha['Material/Acabado']);
  const matches = entries.filter(entry => (!brand || !entry.marca || entry.marca === brand)
    && (!finish || !entry.acabado || entry.acabado === finish));
  const conflict = new Set(matches.map(entry => `${entry.marca}|${entry.acabado}`)).size > 1;
  return { matches, conflict: Boolean(entries.length && (!matches.length || conflict)) };
}

function eligibleRuns(entries, size) {
  const runs = new Map();
  for (const entry of entries) {
    if (!entry.valid || !entry.steps.some(step => contains(entry, size, step))) continue;
    const key = `${entry.linea}|${range(entry)}`;
    if (!runs.has(key)) runs.set(key, []);
    runs.get(key).push(entry);
  }
  return [...runs.values()].map(entries => ({
    ...entries[0],
    files: entries.map(entry => entry.row),
    certain: entries.some(entry => entry.status === 1 && entry.steps.every(step => contains(entry, size, step))),
    conflictingPrices: new Set(entries.map(entry => entry.price)).size > 1,
  }));
}

function classifySize({ ficha, size: rawSize, confirmed, presentation, keepForControl }) {
  const size = catalog.halfSize(rawSize);
  if (size == null) return { kind: 'review', reason: 'Talla fuera de la escala numérica de calzado.' };
  const runs = eligibleRuns(presentation.matches, size);
  if (keepForControl && (confirmed > 0 || runs.some(run => run.certain))) {
    return { kind: 'control', runs, reason: 'Talla dada de alta. Verificar si el saldo del corte ya se atendió.' };
  }
  if (presentation.conflict) return { kind: 'review', runs, reason: 'El estilo y color figuran, con marca o acabado por confirmar.' };
  if (runs.length !== 1 && (runs.length || confirmed > 0)) {
    return { kind: 'review', runs, reason: runs.length ? 'Más de una corrida en SAZ incluye la talla.' : 'La existencia SAZ confirma la talla, falta identificar su corrida.' };
  }
  if (runs.length) {
    const [run] = runs;
    if (!run.certain) return { kind: 'review', runs, reason: 'Verificar Status o incremento de la corrida en SAZ.' };
    return { kind: 'stock', runs, reason: run.conflictingPrices ? 'Verificar ficha de destino por diferencia histórica de precio.' : '' };
  }
  if (presentation.matches.some(run => !run.valid || run.status !== 1)) {
    return { kind: 'review', runs, reason: 'Hay registros de catálogo con corrida o Status por confirmar.' };
  }
  if (/ROPA|TEXTIL/.test(normalize(ficha.Linea) + ' ' + normalize(ficha['Material/Acabado']))) {
    return { kind: 'review', runs, reason: 'Verificar la escala de ropa en SAZ.' };
  }
  return { kind: 'new', runs, reason: '' };
}

function proposeRuns({ pending, registered, line, master, assigned }) {
  const wanted = [...new Set(pending.map(catalog.halfSize).filter(size => size != null))].sort((a, b) => a - b);
  const existing = [...registered].map(catalog.halfSize).filter(size => size != null);
  if (!wanted.length || wanted.some(size => existing.includes(size))) return [];
  const available = (run, size) => contains(run, size, run.incremento);
  const canAdd = run => run.valid && wanted.some(size => available(run, size))
    && existing.every(size => !available(run, size));
  const preferred = assigned.map(catalog.validateCorrida).filter(canAdd);
  const standard = master.filter(run => run.activa !== false).map(catalog.validateCorrida)
    .filter(run => run.linea === catalog.normalizeLine(line) && canAdd(run));
  const options = [...new Map([...preferred, ...standard].map(run => [catalog.canonicalKey(run), run])).values()];
  const selected = catalog.recommendCorridas({ sizes: wanted, corridas: options });
  const overlaps = selected.corridas.some((run, index) => selected.corridas.slice(index + 1)
    .some(other => run.inicial <= other.final && other.inicial <= run.final));
  if (selected.completa && selected.corridas.length <= 3 && !overlaps) {
    return selected.corridas.map(run => ({ ...run, source: 'Corrida maestra disponible' }));
  }
  if (!catalog.normalizeLine(line) || wanted.some(size => size < 9 || size > 34)) return [];
  // Split only where extending a range would recreate an already registered size.
  const drafts = [];
  for (const size of wanted) {
    const last = drafts.at(-1);
    if (last && !existing.some(already => already >= last.inicial && already <= size)) last.final = size;
    else drafts.push({ linea: line, inicial: size, final: size, incremento: 0.5 });
  }
  return drafts.map(run => ({ ...catalog.validateCorrida(run), source: 'Propuesta de nueva corrida exacta' }));
}

function registeredSizes(entries, fromStock = []) {
  const registered = new Set(fromStock.filter(size => catalog.halfSize(size) != null).map(size => sizeLabel(catalog.halfSize(size))));
  for (const entry of entries.filter(run => run.valid)) {
    // A range with an uncertain increment still reserves every possible size.
    for (const step of entry.steps) {
      if (entry.final > 999) continue;
      for (let size = entry.inicial; size <= entry.final; size += step) registered.add(sizeLabel(size));
    }
  }
  return registered;
}

module.exports = { classifySize, choosePresentation, identity, indexCatalog, proposeRuns, range, registeredSizes };
