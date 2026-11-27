'use strict';

const assert = require('node:assert/strict');
const coverage = require('../lib/saz-catalog-coverage.js');

const master = [
  { linea: 'NIÑAS', inicial: 18, final: 21, incremento: 1 },
  { linea: 'NIÑAS', inicial: 18, final: 21, incremento: 0.5 },
  { linea: 'DAMA', inicial: 21.5, final: 27, incremento: 0.5 },
];
const base = { Estilo: '000034', Color: 'NEGRO BLANCO', Marca: 'COSHI', Acabado: 'SINTETICO', Status: 1, __rowNum__: 5 };
const index = coverage.indexCatalog([
  { ...base, Linea: 'NIÑAS', Corrida: '18.00-21.00' },
  { ...base, Linea: 'DAMA', Corrida: '21.50-27.00' },
], master);
const ficha = { Estilo: '34', Color: 'NEGRO BLANCO', Marca: 'COSHI', 'Material/Acabado': 'SINTÉTICO', Linea: 'NIÑAS' };
const entries = index.get(coverage.identity(ficha));
assert.ok(entries);
assert.ok(!index.has('34|BLANCO NEGRO'));
const presentation = coverage.choosePresentation(entries, ficha);
const classify = (size, confirmed = 0, keepForControl = false) =>
  coverage.classifySize({ ficha, size, confirmed, presentation, keepForControl }).kind;
assert.equal(classify('20.0'), 'stock');
assert.equal(classify('20.5'), 'review');
assert.equal(classify('20.0', 1, true), 'control');
assert.equal(classify('15.5'), 'new');
assert.equal(classify('15.5', 1), 'review');
assert.equal(coverage.choosePresentation(entries, { ...ficha, Marca: 'OTRA' }).conflict, true);
assert.deepEqual(coverage.proposeRuns({
  pending: ['15.5', '18.0'], registered: coverage.registeredSizes(entries),
  line: 'NIÑAS', master, assigned: [],
}), []);
const split = coverage.proposeRuns({
  pending: ['17.0', '17.5', '18.5', '19.0'], registered: new Set(['18.0']),
  line: 'NIÑAS', master, assigned: [],
});
assert.deepEqual(split.map(coverage.range), ['17.00-17.50', '18.50-19.00']);

const existing = coverage.registeredSizes([entries[0]]);
const extension = coverage.proposeRuns({
  pending: ['22.5', '26.5'], registered: existing, line: 'NIÑAS', master,
  assigned: [master[2]],
});
assert.deepEqual(extension.map(coverage.range), ['21.50-27.00']);
console.log('saz-catalog-coverage: OK');
