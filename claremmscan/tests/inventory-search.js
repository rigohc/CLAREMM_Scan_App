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
assert(search.plan('R').wait && search.plan('RI').wait, '1-2 letras no vacían el catálogo: hay que seguir escribiendo');

const scientific = search.plan('4e0');
assert(scientific.ready && scientific.mode === 'exact-estilo', '4e0 es lookup exacto, no prefijo');
assert(scientific.allowPrefix === false, '4e0 nunca hace ilike');
assert(scientific.keys.includes('4E0'), '4e0 busca el literal 4E0');
assert(!scientific.keys.includes('4'), '4e0 no se convierte a 4 por notación científica');
assert(search.plan('1e3').allowPrefix === false, '1e3 tampoco es prefijo');
assert(search.isScientificToken('4E0'), '4E0 es token científico');
assert(!search.looksLikeEstiloToken('4e0'), '4e0 no es prefijo PI/COM');

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
million.push({ estilo: '4E0', color: 'NEGRO', saz_cargado: false });
index.rebuild(million);
const sciHits = index.lookup('4e0');
assert(sciHits.length === 1 && sciHits[0].item.estilo === '4E0', 'índice encuentra 4E0 sin barrer');

const forbidden = ['00', '0', '000', '000034', '34', '034', '4e0', '4E0', '1e3'];
for (const query of forbidden) {
  assert(search.plan(query).allowPrefix === false, `${query} no puede disparar prefijo numérico`);
}

assert(search.plan('RIK').mode === 'text' && search.plan('RIK').allowPrefix === false, 'RIK es texto de marca, no prefijo de estilo');
const brands = Array.from({ length: 50000 }, (_, i) => ({
  estilo: String(i + 200000),
  color: 'NEGRO',
  marca: i < 80 ? 'RIKO' : 'OTRA',
  linea: 'ZAPATO',
  sucursal: 'CLAREMM ZAPATERIA JUAREZ',
  saz_cargado: false,
}));
const brandIndex = search.createLocalIndex();
brandIndex.rebuild(brands);
const rikStart = Date.now();
const rikHits = brandIndex.lookup('RIK', 'all');
const rikElapsed = Date.now() - rikStart;
assert(rikHits.length === 40, `RIK respeta tope 40, fueron ${rikHits.length}`);
assert(rikHits.every(hit => hit.item.marca === 'RIKO'), 'RIK no barre el inventario completo');
assert(rikElapsed < 200, `lookup RIK en 50k debe ser <200ms, fue ${rikElapsed}ms`);
assert(brandIndex.lookup('RIK', 'all', { scope: 'style' }).length === 0, 'RIK en solo estilo no recorre marcas');

console.log(JSON.stringify({
  ok: true,
  elapsed_50k_ms: elapsed,
  keys_000034: full.keys,
  mode_00: zeros.mode,
  mode_pi40: prefix.mode,
  mode_rik: search.plan('RIK').mode,
  rik_hits: rikHits.length,
  rik_ms: rikElapsed,
}, null, 2));
