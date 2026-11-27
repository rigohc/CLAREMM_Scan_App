'use strict';

const assert = require('node:assert/strict');
const core = require('../lib/corridas-core.js');

const valid = core.validateCorrida({ linea: 'niñas', inicial: 15, final: 17.5, incremento: 0.5 });
assert.equal(valid.valid, true);
assert.equal(valid.linea, 'NIÑAS');
assert.equal(valid.nombre, '15.0 al 17.5 inc 0.5');
assert.equal(core.corridaContainsSize(valid, 16.5), true);
assert.equal(core.corridaContainsSize(valid, 17.8), false);
assert.equal(core.parseCorridaText('18.00-21.50', 'niños').nombre, '18.0 al 21.5 inc 0.5');

assert.equal(core.validateCorrida({ linea: 'NIÑAS', inicial: 15, final: 17.8, incremento: 0.5 }).valid, false);
assert.equal(core.validateCorrida({ linea: 'NIÑAS', inicial: 108, final: 21.5, incremento: 0.5 }).valid, false);
assert.equal(core.validateCorrida({ linea: 'NIÑOS', inicial: 15, final: 17.7, incremento: 0.5 }).valid, false);

const catalog = [
  { id: 'ninas-15', linea: 'NIÑAS', inicial: 15, final: 17.5, incremento: 0.5, activa: true },
  { id: 'ninas-18', linea: 'NIÑAS', inicial: 18, final: 21.5, incremento: 0.5, activa: true },
  { id: 'joven-21', linea: 'JOVEN', inicial: 21.5, final: 27, incremento: 0.5, activa: true },
  { id: 'whole-sizes', linea: 'NIÑAS', inicial: 15, final: 21, incremento: 1, activa: true },
  { id: 'too-broad', linea: 'NIÑOS', inicial: 9, final: 21.5, incremento: 0.5, activa: true },
];

const cos901 = core.recommendCorridas({ sizes: [15, 15.5, 17.5, 18, 20.5, 21, 22, 26.5], corridas: catalog, preferredLines: ['NIÑAS'] });
assert.equal(cos901.completa, true);
assert.deepEqual(cos901.corridas.map(item => item.id), ['ninas-15', 'ninas-18', 'joven-21']);

const style435501 = core.recommendCorridas({ sizes: [18, 18.5, 21, 22, 22.5, 26.5, 27], corridas: catalog.slice(1), preferredLines: ['NIÑAS'] });
assert.equal(style435501.completa, true);
assert.deepEqual(style435501.corridas.map(item => item.id), ['ninas-18', 'joven-21']);

const missing = core.recommendCorridas({ sizes: [8.5, 27], corridas: catalog });
assert.equal(missing.completa, false);
assert.deepEqual(missing.tallas_sin_corrida, ['8.5']);

console.log('corridas-core: OK');
