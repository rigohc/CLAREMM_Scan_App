'use strict';

const core = require('../lib/branch-upload-core.js');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const grouped = core.groupRows([
  { estilo: 'PI4031', color: 'MARINO BLANCO', talla: '24.0', cantidad: 1 },
  { estilo: 'PI4031', color: 'MARINO BLANCO', talla: '24', cantidad: 1 },
  { estilo: 'PI1609', color: 'NEGRO', talla: '22.0', cantidad: 1 },
  { estilo: 'PI1609', color: 'NEGRO', talla: '22.0', cantidad: 1 },
  { estilo: '', color: 'NEGRO', talla: '24.0', cantidad: 1 },
  { estilo: 'PI1', color: 'NEGRO', talla: 'veinticuatro', cantidad: 1 },
  { estilo: 'PI1', color: 'NEGRO', talla: '24.0', cantidad: 0 },
]);
assert(grouped.filas === 2, 'agrupa duplicados estilo+color+talla');
assert(grouped.rows.find(row => row.estilo === 'PI4031').cantidad === 2, 'PI4031 MARINO BLANCO 24.0 = 2');
assert(grouped.rows.find(row => row.estilo === 'PI1609').cantidad === 2, 'PI1609 NEGRO 22.0 = 2');
assert(grouped.invalid.length === 3, 'filas inválidas se reportan');

const products = [
  { id: 'a', estilo: 'PI4031', color: 'MARINO BLANCO', precio: 759, linea: 'DAMA', corrida: '21.5-27.0', acabado: 'SINTETICO', activo: true },
  { id: 'b', estilo: 'PI4037', color: 'AZUL REY', precio: 799, linea: 'DAMA', corrida: '21.5-27.0', acabado: 'PIEL', activo: true },
  { id: 'c', estilo: 'PI4037', color: 'MARINO', precio: 799, linea: 'DAMA', corrida: '21.5-27.0', acabado: 'PIEL', activo: true },
  { id: 'd', estilo: '018004', color: 'NEGRO', precio: 549, linea: 'DAMA', corrida: '21.5-27.0', acabado: 'SINTETICO', activo: true },
  { id: 'e', estilo: 'X1', color: 'NEGRO BLANCO', precio: 100, linea: 'DAMA', activo: true },
  { id: 'f', estilo: 'PI0795', color: 'BEIGE NEGRO', precio: 899, linea: 'DAMA', acabado: 'PIEL', activo: true },
];
const classified = core.classifyRows({
  rows: [
    { estilo: 'PI4031', color: 'MARINO BLANCO', talla: '24.0', cantidad: 1 },
    { estilo: 'PI4037', color: 'MARINO NARANJA', talla: '24.0', cantidad: 1 },
    { estilo: '18004', color: 'NEGRO', talla: '24.0', cantidad: 1 },
    { estilo: 'X1', color: 'BLANCO NEGRO', talla: '24.0', cantidad: 1 },
    { estilo: 'NUEVO1', color: 'ROJO', talla: '24.0', cantidad: 1, marca: 'PIRMA' },
  ],
  products,
  createUnknowns: false,
});
assert(classified.encontradas.some(row => row.estilo === 'PI4031'), 'color exacto encontrado');
assert(classified.encontradas.some(row => row.product.id === 'd'), 'ceros a la izquierda coinciden');
assert(classified.desconocidas.some(row => /MARINO NARANJA/.test(row.motivo) && /AZUL REY/.test(row.motivo) && /MARINO/.test(row.motivo)), 'motivo lista colores existentes');
assert(classified.desconocidas.some(row => row.color === 'BLANCO NEGRO'), 'NEGRO BLANCO no es BLANCO NEGRO');
assert(classified.creables.length === 0, 'sin create_unknowns no crea');

const authorized = core.classifyRows({
  rows: [{ estilo: 'NUEVO1', color: 'ROJO', talla: '24.0', cantidad: 1, marca: 'PIRMA' }],
  products,
  createUnknowns: true,
});
assert(authorized.creables.length === 1, 'create_unknowns autoriza el alta');

const inherited = core.inheritPrice({ estilo: 'PI4037', size: '24.0', products, explicitPrice: 0 });
assert(inherited.precio === 799 && inherited.precio_origen === 'heredado', 'hereda precio de la misma corrida');
const excelPrice = core.inheritPrice({ estilo: 'PI4037', size: '24.0', products, explicitPrice: 1200 });
assert(excelPrice.precio_origen === 'excel' && excelPrice.precio === 1200, 'precio del excel gana');
const zero = core.inheritPrice({ estilo: 'SINPRECIO', size: '24.0', products: [], explicitPrice: 0 });
assert(zero.precio === 0 && zero.precio_origen === 'cero', 'sin de dónde heredar queda en cero');

const inferred = core.inferTipo({ size: '24.0' });
assert(inferred.tipo === 'DAMA' && inferred.tipo_inferido === true, 'talla < 25 es DAMA');
const caballero = core.inferTipo({ size: '26.0' });
assert(caballero.tipo === 'CABALLERO' && caballero.tipo_inferido === true, 'talla >= 25 es CABALLERO');
const explicit = core.inferTipo({ tipo: 'NIÑOS', size: '26.0' });
assert(explicit.tipo_inferido === false, 'tipo enviado no se infiere');

const mismatch = core.resolveMaterial({ labelMaterial: 'SINTETICO', existingAcabado: 'PIEL' });
assert(mismatch.mismatch && mismatch.overwrite === false && mismatch.material === 'PIEL', 'no pisa PIEL; va a revisión');
const fresh = core.resolveMaterial({ labelMaterial: '', existingAcabado: '' });
assert(fresh.material === 'SINTETICO', 'material por defecto SINTETICO');
const piel = core.resolveMaterial({ labelMaterial: 'PIEL', existingAcabado: '' });
assert(piel.material === 'PIEL', 'PIEL solo si la etiqueta lo dice');
const don343 = core.resolveMaterial({ labelMaterial: '', existingAcabado: 'PIEL', labelSource: 'default' });
assert(!don343.mismatch && don343.label_source === 'default', 'T6: sin material en la fila no marca mismatch');
const su6550 = core.resolveMaterial({ labelMaterial: 'SINTETICO', existingAcabado: 'PIEL', labelSource: 'row' });
assert(su6550.mismatch && su6550.label_source === 'row', 'T7: material enviado SINTETICO vs PIEL sí marca mismatch');

const eightSizes = Array.from({ length: 8 }, (_, index) => ({
  estilo: 'PI4031', color: 'MARINO BLANCO', talla: (22 + index * 0.5).toFixed(1), cantidad: 1, marca: 'PIRMA', crear: true,
}));
const eightClassified = core.classifyRows({ rows: eightSizes, products: [], createUnknowns: true });
const eightSourceIds = core.dedupeByLookup(eightClassified.creables).map(row => core.productSourceId('t1', row.estilo, row.color));
assert(eightClassified.creables.length === 8, 'T1: 8 tallas de la misma ficha');
assert(eightSourceIds.length === 1, 'T1: un solo upsert de products por ficha');

const lote = [];
for (let ficha = 0; ficha < 52; ficha += 1) {
  for (let size = 0; size < 7; size += 1) {
    lote.push({ estilo: `ZZT${ficha}`, color: 'NEGRO', talla: (22 + size * 0.5).toFixed(1), cantidad: 1, marca: 'TEST', crear: true });
  }
}
const loteClassified = core.classifyRows({ rows: lote, products: [], createUnknowns: true });
assert(loteClassified.filas === 364, 'lote sintético 52 fichas × 7 tallas');
assert(core.dedupeByLookup(loteClassified.creables).length === 52, '52 upserts de products, no 364');

assert(core.estiloKeys('000034').includes('034'), '000034 también busca 034');
assert(core.estiloKeys('000034').includes('34'), '000034 también busca 34');
assert(core.sameEstilo('000034', '034'), 'ceros a la izquierda son el mismo estilo');
assert(core.blockedBranch('JUAREZ'), 'JUAREZ bloqueada para carga');
assert(!core.blockedBranch('NUEVO_LEON'), 'NUEVO_LEON permitida');
assert(core.juarezAllowsQuantity(1, 1) && core.juarezAllowsQuantity(1, 2) && !core.juarezAllowsQuantity(2, 1), 'JUÁREZ solo suma o deja');
assert(core.nextEstiloValue('000034') === '000034', 'estilo numérico se paddea');
assert(core.nextEstiloValue('NI 2001') === 'NI2001', 'estilo compacta espacios');
const planned = core.catalogPatchFromBody(
  { estilo: 'NI2001', color: 'LATE', precio: 1199 },
  { estilo: 'NI2001B', corrida: '21.50-27.00', motivo: 'corrección' },
);
assert(planned.patch.estilo === 'NI2001B' && planned.identityChanged, 'cambia el estilo de la ficha');
assert(planned.priceProtected === false, 'sin precio nuevo no pide confirmación');
const protectedPrice = core.catalogPatchFromBody(
  { estilo: 'NI2001', color: 'LATE', precio: 1199 },
  { precio: 999 },
);
assert(protectedPrice.priceProtected, 'precio > 0 queda protegido');
assert(!core.catalogPatchFromBody({ precio: 1199 }, { precio: 999, confirmar_precio: true }).priceProtected, 'confirmar_precio autoriza el cambio');
const sizeGroup = core.groupSizeRows([
  { estilo: 'NI2001', color: 'LATE', talla: '24.0', cantidad: 1 },
  { estilo: 'NI2001', color: 'LATE', talla: '24', cantidad: 1 },
  { ficha_id: '11111111-1111-4111-8111-111111111111', talla: '25.0', cantidad: 0 },
  { estilo: 'X', color: 'Y', talla: 'veinte', cantidad: 1 },
]);
assert(sizeGroup.filas === 2 && sizeGroup.rows.find(row => row.talla === '24.0').cantidad === 2, 'agrupa tallas y permite 0');
assert(sizeGroup.invalid.length === 1, 'talla inválida se reporta');
assert(core.colorKey('N/B') === 'NEGRO BLANCO', 'alias N/B');
assert(core.buildPreview(classified).filas === classified.filas, 'preview no inventa filas');
assert(core.dedupeByLookup(eightClassified.creables).length === 1, 'dedupe exportado');

console.log(JSON.stringify({ ok: true, grouped: grouped.filas, encontradas: classified.encontradas.length, desconocidas: classified.desconocidas.length }, null, 2));
