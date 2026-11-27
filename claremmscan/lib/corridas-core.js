'use strict';

const LINE_ALIASES = Object.freeze({
  NINA: 'NIÑAS',
  NINAS: 'NIÑAS',
  NIÑA: 'NIÑAS',
  NIÑAS: 'NIÑAS',
  NINO: 'NIÑOS',
  NINOS: 'NIÑOS',
  NIÑO: 'NIÑOS',
  NIÑOS: 'NIÑOS',
  DAMA: 'DAMA',
  JOVEN: 'JOVEN',
});

function text(value) {
  return String(value ?? '').trim();
}

function normalize(value) {
  return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ');
}

function normalizeLine(value) {
  const normalized = normalize(value);
  return LINE_ALIASES[normalized] || text(value).toUpperCase();
}

function halfSize(value) {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  const doubled = Math.round(parsed * 2);
  return Math.abs(parsed * 2 - doubled) < 1e-8 ? doubled / 2 : null;
}

function formatSize(value) {
  const parsed = halfSize(value);
  if (parsed == null) return '';
  return parsed.toFixed(1);
}

function parseCorridaText(value, linea = '') {
  const match = text(value).replace(/[–—]/g, '-').replace(/\s+/g, '').replace(/,/g, '.').match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
  if (!match) return { valid: false, errors: ['La corrida debe ser un rango inicial-final.'], linea: normalizeLine(linea) };
  return validateCorrida({ linea: normalizeLine(linea) || 'SIN LINEA', inicial: match[1], final: match[2], incremento: 0.5 });
}

function validateCorrida(input = {}) {
  const linea = normalizeLine(input.linea);
  const inicial = halfSize(input.inicial ?? input.talla_inicial ?? input.start);
  const final = halfSize(input.final ?? input.talla_final ?? input.end);
  const incremento = halfSize(input.incremento ?? input.increment ?? input.step);
  const errors = [];
  if (!linea) errors.push('La línea es obligatoria.');
  if (inicial == null) errors.push('La talla inicial debe caer en un entero o medio número.');
  if (final == null) errors.push('La talla final debe caer en un entero o medio número.');
  if (incremento == null || ![0.5, 1].includes(incremento)) errors.push('El incremento debe ser 0.5 o 1.0.');
  if (inicial != null && final != null && final < inicial) errors.push('La talla final no puede ser menor que la inicial.');
  if (inicial != null && final != null && incremento != null && [0.5, 1].includes(incremento)) {
    const steps = (final - inicial) / incremento;
    if (Math.abs(steps - Math.round(steps)) > 1e-8) errors.push('El rango no termina en la cuadrícula del incremento.');
  }
  const nombre = inicial == null || final == null || incremento == null
    ? text(input.nombre)
    : `${inicial.toFixed(1)} al ${final.toFixed(1)} inc ${incremento.toFixed(1)}`;
  return { valid: errors.length === 0, errors, linea, inicial, final, incremento, nombre };
}

function corridaContainsSize(corrida, size) {
  const parsed = halfSize(size);
  const checked = validateCorrida(corrida);
  if (parsed == null || !checked.valid) return false;
  if (parsed < checked.inicial || parsed > checked.final) return false;
  const steps = (parsed - checked.inicial) / checked.incremento;
  return Math.abs(steps - Math.round(steps)) < 1e-8;
}

function canonicalKey(corrida) {
  const checked = validateCorrida(corrida);
  if (!checked.valid) return '';
  return [normalize(checked.linea), checked.inicial.toFixed(1), checked.final.toFixed(1), checked.incremento.toFixed(1)].join('|');
}

function recommendCorridas({ sizes = [], corridas = [], preferredLines = [] } = {}) {
  const wanted = [...new Set(sizes.map(halfSize).filter(value => value != null))].sort((a, b) => a - b);
  const preferred = new Set(preferredLines.map(normalizeLine).filter(Boolean));
  const candidates = corridas.map((corrida, index) => ({ corrida, index, checked: validateCorrida(corrida) }))
    .filter(item => item.checked.valid && item.corrida.activa !== false);
  const memo = new Map();

  function score(plan) {
    const nonHalf = plan.filter(item => item.checked.incremento !== 0.5).length;
    const nonPreferred = preferred.size ? plan.filter(item => !preferred.has(item.checked.linea) && item.checked.linea !== 'JOVEN').length : 0;
    const slots = plan.reduce((sum, item) => sum + Math.round((item.checked.final - item.checked.inicial) / item.checked.incremento) + 1, 0);
    return [nonHalf, nonPreferred, slots, plan.length];
  }

  function better(left, right) {
    if (!right) return true;
    const a = score(left);
    const b = score(right);
    for (let index = 0; index < a.length; index += 1) {
      if (a[index] !== b[index]) return a[index] < b[index];
    }
    return left.map(item => item.index).join(',') < right.map(item => item.index).join(',');
  }

  function visit(remaining) {
    if (!remaining.length) return [];
    const key = remaining.join(',');
    if (memo.has(key)) return memo.get(key);
    const first = remaining[0];
    let best = null;
    for (const candidate of candidates) {
      if (!corridaContainsSize(candidate.checked, first)) continue;
      const next = remaining.filter(size => !corridaContainsSize(candidate.checked, size));
      if (next.length === remaining.length) continue;
      const tail = visit(next);
      if (tail == null) continue;
      const plan = [candidate, ...tail];
      if (better(plan, best)) best = plan;
    }
    memo.set(key, best);
    return best;
  }

  const selected = visit(wanted);
  if (!selected) {
    const uncovered = wanted.filter(size => !candidates.some(candidate => corridaContainsSize(candidate.checked, size)));
    return {
      corridas: [],
      tallas_cubiertas: [],
      tallas_sin_corrida: (uncovered.length ? uncovered : wanted).map(formatSize),
      completa: wanted.length === 0,
    };
  }
  const unique = [...new Map(selected.map(item => [canonicalKey(item.checked), item])).values()];
  return {
    corridas: unique.map(item => item.corrida),
    tallas_cubiertas: wanted.map(formatSize),
    tallas_sin_corrida: [],
    completa: true,
  };
}

module.exports = {
  canonicalKey,
  corridaContainsSize,
  formatSize,
  halfSize,
  normalizeLine,
  parseCorridaText,
  recommendCorridas,
  validateCorrida,
};
