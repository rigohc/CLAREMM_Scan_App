'use strict';

const { normalizeLine, halfSize, parseCorridaText, corridaContainsSize, validateCorrida, recommendCorridas } = require('./corridas-core.js');
const { compactEstilo } = require('./branch-upload-core.js');

const styleKey = value => compactEstilo(value).replace(/-/g, '');
const range = run => `${Number(run.talla_inicial).toFixed(2)}-${Number(run.talla_final).toFixed(2)}`;

function createWorklistPlanner(corridas, relations) {
  const active = corridas.filter(run => run.activa === true && validateCorrida(run).valid);
  const runsById = new Map(active.map(run => [run.id, run]));
  const byStyle = new Map();
  for (const relation of [...relations].sort((a, b) => a.orden - b.orden)) {
    const run = runsById.get(relation.corrida_id);
    if (!run) continue;
    const runs = byStyle.get(relation.estilo_key) || [];
    runs.push(run);
    byStyle.set(relation.estilo_key, runs);
  }

  return function plan({ product, application, confirmed, due, stockRecordCount }) {
    if (stockRecordCount > 1) return { issue: 'Varias fichas activas con stock para el mismo estilo y color' };
    const observed = [...new Set([...Object.keys(application), ...Object.keys(confirmed)])];
    if (observed.some(size => halfSize(size) == null)) return { issue: 'Hay tallas fuera de la escala de enteros y medios' };
    const assigned = byStyle.get(styleKey(product.estilo));
    const line = normalizeLine(product.linea);
    const parsed = parseCorridaText(product.corrida, line);
    const coveredBy = run => observed.every(size => corridaContainsSize(run, size));
    const sameLine = active.filter(run => normalizeLine(run.linea) === line);
    const covering = sameLine.filter(coveredBy);
    const exact = covering.filter(run => Number(run.talla_inicial) === parsed.inicial && Number(run.talla_final) === parsed.final);
    const compatible = parsed.valid ? covering.filter(run => Number(run.talla_inicial) <= parsed.inicial
      && Number(run.talla_final) >= parsed.final && Number(run.incremento) === 0.5) : covering;
    const selected = exact.find(run => Number(run.incremento) === 0.5) || exact[0]
      || (compatible.length === 1 ? compatible[0] : null);
    const runs = assigned || (selected ? [selected] : []);
    const options = sameLine.filter(run => observed.some(size => corridaContainsSize(run, size)));
    if (!runs.length) {
      const recommendation = recommendCorridas({ sizes: observed, corridas: covering.length ? covering : options });
      return {
        issue: sameLine.length ? 'Hace falta confirmar la corrida o combinación de corridas' : 'La línea aún no tiene corridas en la tabla maestra',
        options: (covering.length ? covering : options).map(range),
        suggested: recommendation.completa && recommendation.corridas.length <= 3
          ? recommendation.corridas.map(run => `${range(run)} (+${Number(run.incremento)})`).join(' / ') : '',
      };
    }
    const outside = observed.filter(size => !runs.some(run => corridaContainsSize(run, size)));
    if (outside.length) return { issue: `Tallas sin cobertura: ${outside.join(', ')}`, options: runs.map(range) };

    const groups = new Map();
    const ambiguous = {};
    for (const [size, quantity] of Object.entries(due)) {
      const matches = runs.filter(run => corridaContainsSize(run, size));
      // If the cut already counted this size, the aggregate does not identify which run owns it.
      if (matches.length > 1 && confirmed[size] > 0) {
        ambiguous[size] = quantity;
        continue;
      }
      const run = matches[0];
      if (!groups.has(run.id)) groups.set(run.id, { run, quantities: {} });
      groups.get(run.id).quantities[size] = quantity;
    }
    return { groups: [...groups.values()], runs, ambiguous, assigned: Boolean(assigned) };
  };
}

module.exports = { createWorklistPlanner, range };
