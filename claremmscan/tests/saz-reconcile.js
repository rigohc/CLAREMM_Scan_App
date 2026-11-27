'use strict';

const reconcile = require('../saz-reconcile.js');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const headers = ['Tienda', 'Estilo', 'Color', 'Acabado', 'Marca', 'Temporada', 'Clasificacion', 'Linea', 'Sublinea', 'Departamento', 'Catalogo', 'Forro', '23.0-3', '23.5-3', 'Total'];
const parsed = reconcile.parseMatrix([
  headers,
  ['JUAREZ', '000034', 'N/B', 'PIEL', 'MARCA', '26', 'CASUAL', 'DAMA', 'ZAPATO', 'CALZADO', 'DEP', 'FORRO', 1, 2, 3],
  ['JUAREZ', '000034', 'N/B', 'PIEL', 'MARCA', '26', 'CASUAL', 'DAMA', 'ZAPATO', 'CALZADO', 'DEP', 'FORRO', 1, 0, 1],
  ['JUAREZ', 'LEY601', 'NEGRO', 'CABRA', 'LEYDI', '26', 'CASUAL', 'DAMA', 'ZAPATILLA', 'CALZADO', 'DEP', 'FORRO', 4, -1, 3],
], 'existencias.xlsx');

assert(parsed.uniqueProducts === 1, 'bloquea por completo la ficha con existencia negativa');
assert(parsed.products[0].key === '34|NEGRO BLANCO', 'identidad compacta y alias de color');
assert(parsed.products[0].pairs === 4 && parsed.products[0].quantities['23.0'] === 2, 'consolida duplicados por talla');
assert(parsed.blockedRows.length === 1 && parsed.blockedRows[0].row === 4, 'reporta fila bloqueada');
assert(parsed.blockedRows[0].negatives[0].size === '23.5', 'reporta talla negativa');

console.log(JSON.stringify({ ok: true, products: parsed.uniqueProducts, pairs: parsed.pairs, blocked: parsed.blockedRows.length }));
