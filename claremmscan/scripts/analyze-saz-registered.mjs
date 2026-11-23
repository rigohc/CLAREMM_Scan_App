#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceDir = path.resolve(scriptDir, '../..');
const XLSX = require(path.join(workspaceDir, 'CLAREMM Zapateria/backend/node_modules/xlsx'));
const argv = process.argv.slice(2), outputIndex = argv.indexOf('--output');
const outputPath = outputIndex >= 0 ? path.resolve(argv[outputIndex + 1]) : '';
if (outputIndex >= 0) argv.splice(outputIndex, 2);
const files = argv;
if (!files.length) throw new Error('Indica al menos un Excel registrado en SAZ.');

const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase().replace(/\s+/g, ' ');
const number = value => Number(String(value ?? '').replace(/[^0-9.-]/g, '')) || 0;
const productKey = row => `${normalize(row.estilo)}|${normalize(row.color)}`;
const variantKey = row => `${productKey(row)}|${row.size}`;

function parseWorkbook(file) {
  const workbook = XLSX.readFile(file, { cellDates: true });
  const sheetName = workbook.SheetNames[0], sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
  const headers = matrix[0] || [];
  const totalIndex = headers.findIndex(value => normalize(value) === 'TOTAL EXISTENCIA');
  if (totalIndex <= 20) throw new Error(`${path.basename(file)} no tiene la columna Total Existencia esperada.`);
  const firstSize = Number(headers[20]);
  if (!Number.isFinite(firstSize)) throw new Error(`${path.basename(file)} no tiene una primera talla válida.`);
  const sizes = Array.from({ length: totalIndex - 20 }, (_, index) => (firstSize + index * 0.5).toFixed(1));
  const products = [], variants = [];
  const totalMismatches = [];
  for (let index = 1; index < matrix.length; index++) {
    const row = matrix[index], estilo = normalize(row[0]), color = normalize(row[1]);
    if (!estilo && !color) continue;
    if (!estilo || !color) throw new Error(`${path.basename(file)} fila ${index + 1} sin estilo o color.`);
    const product = {
      estilo, color, precio: number(row[2]), marca: normalize(row[3]), proveedor: normalize(row[4]), temporada: normalize(row[5]),
      sublinea: normalize(row[6]), departamento: normalize(row[7]), clasificacion: normalize(row[8]), linea: normalize(row[9]),
      corrida: normalize(row[10]), acabado: normalize(row[11]), suela: normalize(row[12]), plantilla: normalize(row[13]),
      tacon: normalize(row[14]), forro: normalize(row[15]), catalogo: normalize(row[16]), status: Math.trunc(number(row[17]) || 1),
      observaciones: String(row[18] ?? '').trim(), costo: number(row[19]), source_file: path.basename(file), source_row: index + 1,
    };
    products.push(product);
    let calculated = 0;
    sizes.forEach((size, sizeIndex) => {
      const quantity = Math.trunc(number(row[20 + sizeIndex]));
      if (quantity <= 0) return;
      calculated += quantity;
      variants.push({ ...product, size, quantity });
    });
    const declared = Math.trunc(number(row[totalIndex]));
    if (calculated !== declared) totalMismatches.push({ row: index + 1, estilo, color, calculated, declared });
  }
  const duplicateProducts = products.length - new Set(products.map(productKey)).size;
  const duplicateVariants = variants.length - new Set(variants.map(variantKey)).size;
  return {
    file: path.basename(file), sheet: sheetName, first_size: sizes[0], last_size: sizes.at(-1),
    products, variants, total_mismatches: totalMismatches, duplicate_products: duplicateProducts, duplicate_variants: duplicateVariants,
  };
}

const sources = files.map(file => parseWorkbook(path.resolve(file)));
const variantSources = new Map(), productSources = new Map();
for (const source of sources) {
  for (const product of source.products) {
    const key = productKey(product);
    if (!productSources.has(key)) productSources.set(key, []);
    productSources.get(key).push(product);
  }
  for (const variant of source.variants) {
    const key = variantKey(variant);
    if (!variantSources.has(key)) variantSources.set(key, []);
    variantSources.get(key).push(variant);
  }
}

const overlappingProducts = [...productSources.values()].filter(rows => new Set(rows.map(row => row.source_file)).size > 1);
const overlappingVariants = [...variantSources.values()].filter(rows => new Set(rows.map(row => row.source_file)).size > 1);
const conflictingVariantQuantities = overlappingVariants.filter(rows => new Set(rows.map(row => row.quantity)).size > 1);
const unionPairsMax = [...variantSources.values()].reduce((sum, rows) => sum + Math.max(...rows.map(row => row.quantity)), 0);
const mergedProducts = [...productSources.entries()].map(([key, rows]) => {
  const product = { ...rows[0] };
  for (const row of rows.slice(1)) {
    for (const field of ['precio','marca','proveedor','temporada','sublinea','departamento','clasificacion','linea','corrida','acabado','suela','plantilla','tacon','forro','catalogo','status','observaciones','costo']) {
      if ((product[field] === '' || product[field] === 0) && row[field] !== '' && row[field] !== 0) product[field] = row[field];
    }
  }
  return { ...product, lookup_key: key, source_files: [...new Set(rows.map(row => row.source_file))], source_rows: rows.map(row => row.source_row) };
});
const mergedVariants = [...variantSources.entries()].map(([key, rows]) => ({
  lookup_key: key,
  product_lookup_key: productKey(rows[0]),
  estilo: rows[0].estilo,
  color: rows[0].color,
  size: rows[0].size,
  quantity: Math.max(...rows.map(row => row.quantity)),
  source_files: [...new Set(rows.map(row => row.source_file))],
  source_rows: rows.map(row => row.source_row),
}));

const report = {
  version: 1,
  generated_at: new Date().toISOString(),
  files: sources.map(source => ({
    file: source.file,
    products: source.products.length,
    variants: source.variants.length,
    pairs: source.variants.reduce((sum, row) => sum + row.quantity, 0),
    first_size: source.first_size,
    last_size: source.last_size,
    total_mismatches: source.total_mismatches,
    duplicate_products: source.duplicate_products,
    duplicate_variants: source.duplicate_variants,
  })),
  union: {
    products: productSources.size,
    variants: variantSources.size,
    pairs_using_max_per_variant: unionPairsMax,
    products_present_in_multiple_files: overlappingProducts.length,
    variants_present_in_multiple_files: overlappingVariants.length,
    overlapping_variants_with_different_quantity: conflictingVariantQuantities.length,
  },
  products: mergedProducts,
  variants: mergedVariants,
};

if (outputPath) fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

console.log(JSON.stringify({ output: outputPath || null, files: report.files, union: report.union }, null, 2));
