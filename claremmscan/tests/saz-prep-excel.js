'use strict';

const fs = require('node:fs');
const path = require('node:path');
const excel = require('../saz-prep-excel.js');

const assert = (condition, message) => { if (!condition) throw new Error(message); };

const expectedFixed = [
  'Estilo', 'Color', 'Precio de venta', 'Marca', 'Proveedor', 'Temporada', 'Sublinea',
  'Departamento', 'Clasificacion', 'Linea', 'Corrida de tallas', 'Material/Acabado',
  'Suela', 'Plantillas', 'Tacon', 'Forro', 'Catalogo', 'Status', 'Observaciones', 'Costo',
];
assert(JSON.stringify(excel.FIXED_HEADERS) === JSON.stringify(expectedFixed), 'encabezados fijos igual al Excel Mirlo/Wildcat');
assert(excel.SIZE_HEADERS[0] === '10.0' && excel.SIZE_HEADERS.at(-1) === '31.0', 'corrida 10.0 a 31.0');
assert(excel.SIZE_HEADERS.length === 43, '43 columnas de talla');
assert(excel.INVENTORY_HEADERS.at(-1) === 'Total Existencia', 'cierra con Total Existencia');
assert(excel.INVENTORY_HEADERS.length === 64, '64 columnas de inventario');
assert(JSON.stringify(excel.RESUMEN_HEADERS) === JSON.stringify(['Marca', 'Línea', 'Sublínea', 'Modelos / Estilos', 'Total Pares en Existencia']), 'resumen igual al Excel de referencia');
assert(excel.INVENTORY_SHEET === 'Inventario', 'primera hoja es inventario');
assert(excel.RESUMEN_SHEET === 'Resumen Inventario', 'segunda hoja es resumen');

assert(excel.isJuarezBranch('CLAREMM ZAPATERIA JUAREZ'), 'sucursal base JUÁREZ');
assert(excel.isJuarezBranch('JUÁREZ'), 'acento JUÁREZ');
assert(excel.isJuarezBranch('MATRIZ'), 'MATRIZ es JUÁREZ');
assert(!excel.isJuarezBranch('NUEVO LEON'), 'Nuevo León no entra');
assert(!excel.isJuarezBranch('NUEVO_LEON'), 'código NL no entra');

const row = excel.toInventoryRow({
  estilo: 'MI4425',
  color: 'NEGRO',
  precio: 759,
  marca: 'MIRLO',
  proveedor: 'MIRLO',
  temporada: 'CLAREMM 26',
  sublinea: 'ZAPATILLA',
  departamento: 'CALZADO',
  clasificacion: 'CASUAL',
  linea: 'DAMA',
  corrida: '21.5-27.0',
  acabado: 'SINTETICO',
  suela: 'SUELAS',
  plantilla: 'PLANTILLAS',
  tacon: 'PISO',
  forro: 'FORRO',
  catalogo: 'DEPARTAMENTO',
  status: 1,
  observaciones: '16/11/26',
  costo: 736.23,
  qtyBySize: { '22.0': 1, '22.5': 2, '23.0': 1, '23.5': 1, '24.0': 1, '24.5': 1, '25.0': 2, '25.5': 1, '26.5': 1, '27.0': 1 },
}, '16/11/26');

assert(Object.keys(row).join('|') === excel.INVENTORY_HEADERS.join('|'), 'orden de columnas idéntico al formato del bot');
assert(row['Corrida de tallas'] === '21.5-27.0', 'corrida editable en la misma hoja');
assert(row['Precio de venta'] === '$759.00', 'precio con formato de referencia');
assert(row['22.5'] === 2 && row['21.0'] === '' && row['Total Existencia'] === 12, 'tallas vacías y total de pares');

const nlSkipped = excel.mergeGapRows([], [{
  estilo: 'ZZTEST', color: 'NEGRO', precio: 0, qtyBySize: { '22.0': 1 }, sin_imagen: true, sin_precio: true,
}], [excel.fichaKey('ZZTEST', 'NEGRO')]);
assert(!nlSkipped.length, 'no reintroduce fichas que ya están en SAZ o completas');

const merged = excel.mergeGapRows(
  [{ estilo: '000034', color: 'NEGRO BLANCO', precio: 0, corrida: '22-26', qtyBySize: { '23.0': 1 }, sin_imagen: true, sin_precio: true, origen: 'catalogo' }],
  [{ estilo: '34', color: 'NEGRO BLANCO', precio: 0, qtyBySize: { '24.0': 2 }, sin_imagen: true, sin_precio: true, origen: 'escaner' }],
);
assert(merged.length === 1 && merged[0].corrida === '22-26', 'identidad compacta conserva corrida');
assert(merged[0].qtyBySize['23.0'] === 1 && merged[0].qtyBySize['24.0'] === 2, 'tallas se unen sin duplicar');

const catalogDupes = excel.mergeGapRows([
  { estilo: 'NI2001', color: 'LATE', precio: 0, corrida: '21.50-27.00', qtyBySize: { '23.5': 1, '24.5': 1, '25.0': 1, '25.5': 1, '26.0': 1 }, sin_precio: true, sin_imagen: true },
  { estilo: 'NI2001', color: 'LATE', precio: 0, corrida: '21.50-27.00', qtyBySize: { '24.0': 1 }, sin_precio: true, sin_imagen: true },
], []);
assert(catalogDupes.length === 1, 'dos productos iguales se unen en una ficha');
assert(catalogDupes[0].qtyBySize['24.0'] === 1, 'talla 24.0 se agrega al unir');
assert(catalogDupes[0].pares === 6, 'pares de ambas fichas se conservan');

const sameSizeDupes = excel.collapseFichaRows([
  { estilo: 'NI2001', color: 'LATE', qtyBySize: { '24.0': 1 }, sin_precio: true, sin_imagen: true },
  { estilo: 'NI2001', color: 'LATE', qtyBySize: { '24.0': 1 }, sin_precio: true, sin_imagen: true },
]);
assert(sameSizeDupes.length === 1 && sameSizeDupes[0].qtyBySize['24.0'] === 2, 'si las dos fichas tienen la misma talla, se suma');

const excelRows = excel.toInventoryRows([
  { estilo: 'NI2001', color: 'LATE', precio: 1199, corrida: '21.50-27.00', qtyBySize: { '23.5': 1, '24.5': 1, '25.0': 1, '25.5': 1, '26.0': 1 } },
  { estilo: 'NI2001', color: 'LATE', precio: 1199, corrida: '21.50-27.00', qtyBySize: { '24.0': 1 } },
]);
assert(excelRows.length === 1, 'Excel SAZ no duplica la ficha');
assert(excelRows[0]['24.0'] === 1 && excelRows[0]['23.5'] === 1, 'Excel incluye 24.0 y el resto de la corrida');
assert(excelRows[0]['Total Existencia'] === 6, 'Total Existencia es la suma real, no dos filas');

const ordered = excel.sortPrepRows([
  { estilo: 'ZZIMG', color: 'NEGRO', sin_precio: false, sin_imagen: true },
  { estilo: 'AAAMBOS', color: 'NEGRO', sin_precio: true, sin_imagen: true },
  { estilo: 'MMPRECIO', color: 'NEGRO', sin_precio: true, sin_imagen: false },
  { estilo: 'BBPRECIO', color: 'NEGRO', sin_precio: true, sin_imagen: false },
]);
assert(ordered.map(row => row.estilo).join(',') === 'BBPRECIO,MMPRECIO,AAAMBOS,ZZIMG', 'faltantes: precio, luego precio+foto, luego imagen');
assert(excel.prepRank({ sin_precio: true, sin_imagen: false }) === 0, 'solo precio primero');
assert(excel.prepRank({ sin_precio: true, sin_imagen: true }) === 1, 'precio e imagen en medio');
assert(excel.prepRank({ sin_precio: false, sin_imagen: true }) === 2, 'solo imagen al final');

const resumen = excel.toResumenRows([row]);
assert(resumen[0].Marca === 'MIRLO' && resumen[0]['Modelos / Estilos'] === 1 && resumen[0]['Total Pares en Existencia'] === 12, 'resumen por marca/línea/sublínea');

assert(JSON.stringify(excel.TABLE_HEADERS) === JSON.stringify(['Estilo', 'Color', 'Marca', 'Corrida', 'Precio', 'Pares', 'Imagen', 'Falta', 'Estado SAZ', 'Acciones']), 'tabla inventario alineada al Excel');
assert(excel.gapLabel({ sin_precio: true, sin_imagen: true }) === 'Precio e imagen', 'etiqueta de faltante');

const localGrouped = excel.groupLocalGaps([
  { sucursal: 'CLAREMM ZAPATERIA JUAREZ', estilo: '34', color: 'NEGRO', talla: '23.0', cantidad: 1, precio: '', saz_cargado: false, material: 'PIEL' },
  { sucursal: 'NUEVO LEON', estilo: '99', color: 'ROJO', talla: '24.0', cantidad: 2, precio: '', saz_cargado: false },
], { imageNames: new Set(), imageNameFor: row => `${row.estilo}-${row.color}.png`, priceOf: value => Number(value) || 0 });
assert(localGrouped.length === 1 && localGrouped[0].estilo === '34', 'tabla local solo JUÁREZ');
assert(localGrouped[0].sin_precio && localGrouped[0].sin_imagen && localGrouped[0].qtyBySize['23.0'] === 1, 'ficha agrupada por estilo+color');

assert(excel.fichaMatchesQuery({ estilo: '000034', color: 'NEGRO' }, '34', 'style', { mode: 'exact-estilo', keys: ['000034', '034', '34'] }), 'búsqueda 34 actualiza 000034');
assert(!excel.fichaMatchesQuery({ estilo: 'PI4031', color: 'NEGRO' }, '34', 'style', { mode: 'exact-estilo', keys: ['34'] }), 'no mezcla otros estilos');

const patched = excel.applyFichaPatch(
  [{ estilo: '000034', color: 'NEGRO', precio: 0, sin_precio: true, sin_imagen: true, qtyBySize: { '23.0': 1 } }],
  { estilo: '34', color: 'NEGRO', precio: 770, talla: '24.0', cantidad: 1 },
);
assert(patched.length === 1 && patched[0].precio === 770 && patched[0].sin_precio === false, 'al encontrar el producto se actualiza el precio');
assert(patched[0].qtyBySize['24.0'] === 1 && patched[0].sin_imagen, 'suma talla y sigue en la lista si falta imagen');
assert(!excel.applyFichaPatch(patched, { estilo: '34', color: 'NEGRO', sin_imagen: false }).length, 'sale de faltantes cuando ya tiene precio e imagen');

const card = excel.toRelationalResult({
  ficha_id: '61d4f1c7-db48-426d-a64e-64dfb3e3d1df',
  estilo: '000034',
  color: 'NEGRO BLANCO',
  marca: 'MIRLO',
  proveedor: 'MIRLO',
  corrida: '22-26',
  precio: 0,
  imagen: 'org/products/000034-NEGRO-BLANCO.png',
  qtyBySize: { '23.0': 2 },
  pares: 2,
  sin_precio: true,
  sin_imagen: false,
}, { id: 'juarez', code: 'JUAREZ', name: 'CLAREMM ZAPATERIA JUAREZ' });
assert(card.product.id === '61d4f1c7-db48-426d-a64e-64dfb3e3d1df', 'ficha de catálogo conserva UUID');
assert(card.product.estilo === '000034' && card.product.color === 'NEGRO BLANCO', 'identidad estilo+color en la tarjeta');
assert(card.product.marca === 'MIRLO' && card.product.corrida === '22-26', 'campos editables llegan a la tarjeta');
assert(card.sizes[0].size === '23.0' && card.totalQuantity === 2, 'pares y tallas en la misma tarjeta que la búsqueda');
assert(/Toca un dato/.test(card.notice), 'misma indicación de edición que al buscar por estilo');
['precio', 'marca', 'proveedor', 'temporada', 'sublinea', 'departamento', 'clasificacion', 'linea', 'corrida', 'acabado'].forEach(field => {
  assert(Object.prototype.hasOwnProperty.call(card.product, field), `tarjeta incluye ${field} editable`);
});
const localCard = excel.toRelationalResult({ estilo: 'PI40', color: 'NEGRO', precio: 0, qtyBySize: { '24.0': 1 } });
assert(String(localCard.product.id).startsWith('local:'), 'ficha solo local no inventa UUID');
const patchedFields = excel.applyFichaPatch(
  [{ estilo: 'MI4425', color: 'NEGRO', precio: 0, sin_precio: true, sin_imagen: true, qtyBySize: { '23.0': 1 } }],
  { estilo: 'MI4425', color: 'NEGRO', proveedor: 'MIRLO', temporada: 'CLAREMM 26' },
);
assert(patchedFields[0].proveedor === 'MIRLO' && patchedFields[0].temporada === 'CLAREMM 26', 'editar proveedor o temporada actualiza la ficha');

const referencePath = '/Users/laclavees12345/Downloads/MIRLO Y WILDCAT 16_11_26 CORREGIDO POR SUBIR A SAZ.xlsx';
const xlsxPath = path.join(__dirname, '../../CLAREMM Zapateria/backend/node_modules/xlsx');
if (fs.existsSync(referencePath) && fs.existsSync(xlsxPath)) {
  const XLSX = require(xlsxPath);
  const workbook = XLSX.readFile(referencePath);
  const inventory = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: '' });
  const resumenSheet = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[1]], { header: 1, defval: '' });
  assert(JSON.stringify(inventory[0]) === JSON.stringify(excel.INVENTORY_HEADERS), 'Excel de referencia: encabezados de inventario');
  assert(JSON.stringify(resumenSheet[0]) === JSON.stringify(excel.RESUMEN_HEADERS), 'Excel de referencia: encabezados de resumen');
  assert(workbook.SheetNames[1] === excel.RESUMEN_SHEET, 'Excel de referencia: nombre de hoja resumen');
}

console.log('saz-prep-excel ok');
