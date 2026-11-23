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

assert(core.blockedBranch('JUAREZ'), 'JUAREZ bloqueada para carga');
assert(!core.blockedBranch('NUEVO_LEON'), 'NUEVO_LEON permitida');
assert(core.colorKey('N/B') === 'NEGRO BLANCO', 'alias N/B');
assert(core.buildPreview(classified).filas === classified.filas, 'preview no inventa filas');

console.log(JSON.stringify({ ok: true, grouped: grouped.filas, encontradas: classified.encontradas.length, desconocidas: classified.desconocidas.length }, null, 2));
