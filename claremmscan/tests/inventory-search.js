'use strict';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const search = require('../inventory-search.js');

const zeros = search.plan('00');
assert(!zeros.ready && zeros.wait, '00 no busca en red');
assert(zeros.allowPrefix === false, '00 nunca usa prefijo');
assert(search.plan('0').wait, '0 no busca');
assert(search.plan('000').wait, '000 no busca');

const full = search.plan('000034');
assert(full.ready && full.mode === 'exact-estilo', '000034 es lookup exacto');
assert(full.allowPrefix === false, 'numérico jamás hace ilike/prefijo');
assert(full.keys.includes('034') && full.keys.includes('34') && full.keys.includes('000034'), '000034 cubre 034');
assert(full.limit <= 40, 'tope de productos');
assert(full.cardLimit <= 40, 'tope de tarjetas');

assert(search.sameEstilo('000034', '034'), 'ceros no cambian la identidad');
assert(search.compactEstilo('000034') === '34', 'identidad compacta');

const prefix = search.plan('PI40');
assert(prefix.ready && prefix.allowPrefix, 'PI40 sí puede prefijo alfanumérico');
assert(search.plan('PI').wait, 'PI incompleto espera');

const color = search.plan('NEGRO');
assert(color.ready && color.allowPrefix === false && color.mode === 'text', 'color no barre estilos por prefijo');

const million = Array.from({ length: 50000 }, (_, i) => ({
  estilo: String(i + 100000),
  color: 'NEGRO',
  saz_cargado: false,
}));
million.push({ estilo: '034', color: 'ROJO', saz_cargado: false });
const index = search.createLocalIndex();
const t0 = Date.now();
index.rebuild(million);
const hits = index.lookup('000034');
const elapsed = Date.now() - t0;
assert(hits.length === 1 && hits[0].item.estilo === '034', 'índice local encuentra 034 entre 50k');
assert(elapsed < 200, `rebuild+lookup 50k debe ser <200ms, fue ${elapsed}ms`);
assert(index.lookup('00').length === 0, '00 no recorre el índice');

const forbidden = ['00', '0', '000', '000034', '34', '034'];
for (const query of forbidden) {
  assert(search.plan(query).allowPrefix === false, `${query} no puede disparar prefijo numérico`);
}

console.log(JSON.stringify({
  ok: true,
  elapsed_50k_ms: elapsed,
  keys_000034: full.keys,
  mode_00: zeros.mode,
  mode_pi40: prefix.mode,
}, null, 2));
