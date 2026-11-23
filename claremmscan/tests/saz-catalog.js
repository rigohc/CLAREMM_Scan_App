'use strict';

const fs = require('node:fs');
const path = require('node:path');
const catalog = require('../saz-catalog.js');

const product = JSON.parse(fs.readFileSync(path.join(__dirname, '../saz-catalog/product-option-values.json'), 'utf8'));
const providers = JSON.parse(fs.readFileSync(path.join(__dirname, '../saz-catalog/provider-option-values.json'), 'utf8'));
catalog.loadFromData(product, providers);

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

assert(catalog.DEFAULT_TEMPORADA === 'CLAREMM 26', 'temporada fija CLAREMM 26');
assert(catalog.resolve('departamento', 'calzado') === 'CALZADO', 'departamento fijo CALZADO');
assert(catalog.resolve('departamento', 'ROPA') === 'ROPA', 'departamento fijo ROPA');
assert(catalog.getOptions('suela')[0] === 'SUELAS', 'suela fija');
assert(catalog.getOptions('tacon')[0] === 'PISO', 'tacon fijo');
assert(catalog.getOptions('forro')[0] === 'FORRO', 'forro fijo');
assert(catalog.resolve('color', 'N/B') === 'NEGRO BLANCO', 'N/B es NEGRO BLANCO');
assert(catalog.resolve('color', 'NB') === 'NEGRO BLANCO', 'NB es NEGRO BLANCO');
assert(catalog.resolve('color', 'B/N') === 'BLANCO NEGRO', 'B/N es BLANCO NEGRO');
assert(catalog.resolve('color', 'negro blanco') === 'NEGRO BLANCO', 'minúsculas al valor SAZ');
assert(catalog.resolve('color', 'NEGRO/BLANCO') === 'NEGRO BLANCO', 'slash al valor SAZ');
assert(catalog.resolve('color', 'FUCSIA') === 'FIUSHA', 'FUCSIA se registra FIUSHA');
assert(catalog.matches('color', 'N/B', 'NEGRO BLANCO'), 'N/B coincide con NEGRO BLANCO');
assert(!catalog.matches('color', 'NEGRO BLANCO', 'BLANCO NEGRO'), 'SAZ distingue el orden del color');
assert(catalog.resolve('color', 'NEGRO AMBAR') === 'NEGRO AMBAR', 'color compuesto exacto');
assert(catalog.formatCorrida('22-26') === '22.00-26.00', 'corrida al formato SAZ');
assert(catalog.canonicalize({ color: 'n/b', marca: 'pirma' }).color === 'NEGRO BLANCO', 'canonicalize color');
assert(catalog.canonicalize({ color: 'n/b', marca: 'pirma' }).marca === 'PIRMA', 'canonicalize marca');
assert(catalog.getOptions('color').length >= 800, 'catálogo de color SAZ');
assert(catalog.getOptions('marca').includes('PIRMA'), 'marcas SAZ');
assert(providers.includes('FLEXI'), 'proveedores SAZ');
assert(catalog.resolve('proveedor', 'flexi') === 'FLEXI', 'proveedor conocido toma el nombre SAZ');
assert(catalog.resolve('proveedor', 'Proveedor Nuevo Leon XYZ') === 'Proveedor Nuevo Leon XYZ', 'proveedor no dado de alta se conserva');

console.log(JSON.stringify({
  ok: true,
  colors: catalog.getOptions('color').length,
  marcas: catalog.getOptions('marca').length,
  proveedores: catalog.getOptions('proveedor').length,
  sample: {
    nb: catalog.resolve('color', 'N/B'),
    fucsia: catalog.resolve('color', 'FUCSIA'),
    temporada: catalog.DEFAULT_TEMPORADA,
  },
}));
