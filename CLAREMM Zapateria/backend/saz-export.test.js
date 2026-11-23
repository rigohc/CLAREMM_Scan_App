import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { sazSelection, sazRows, fillSazWorkbook, SAZ_HEADERS, createSazExportHandler } from './saz-export.js';

const product = { estilo: '005807', color: 'NEGRO', acabado: 'PIEL', marca: 'FLEXI', linea: 'DAMA', corrida: '21.50-27.00', temporada: 'CLAREMM 26', sublinea: 'ZAPATOS', clasificacion: 'CASUAL', observaciones: 'Prueba', descripcion: 'Zapato', proveedor: 'FLEXI', pagina: 0, catalogo: 'UNICO', costo: 500, precio: 1199, codigo_barras: 'NO_REPETIR_POR_TALLA' };

test('selección de uno, varios y todos; rechaza cantidades inválidas', () => {
  assert.deepEqual(sazSelection({}), { mode: 'uno', count: 1, id: null });
  assert.equal(sazSelection({ modo: 'varios', cantidad: '10' }).count, 10);
  assert.equal(sazSelection({ modo: 'todos' }).count, null);
  for (const cantidad of ['0', '-2', '1.5', 'abc', 'Infinity']) assert.throws(() => sazSelection({ modo: 'varios', cantidad }));
  assert.throws(() => sazSelection({ modo: 'todos', producto: '2' }));
});

test('una fila por talla, importes numéricos, ceros iniciales y SKU vacíos', () => {
  const rows = sazRows([product]);
  assert.equal(rows.length, 12);
  assert.equal(rows[0][0], '005807');
  assert.equal(rows[0][5], 21.5);
  assert.equal(rows.at(-1)[5], 27);
  assert.equal(rows[0][14], 500);
  assert.equal(rows[0][15], 1199);
  for (const row of rows) { assert.equal(row.length, 18); assert.equal(row[16], null); assert.equal(row[17], null); }
  assert.equal(sazRows(Array.from({ length: 10 }, (_, i) => ({ ...product, estilo: String(i) }))).length, 120);
  assert.throws(() => sazRows([{ ...product, corrida: 'sin corrida' }]));
});

test('archivo final conserva encabezados y elimina todos los ejemplos de la plantilla', async () => {
  const workbook = new ExcelJS.Workbook();
  const template = path.join(path.dirname(fileURLToPath(import.meta.url)), 'templates', 'alta-masiva-saz.xlsx');
  assert.deepEqual(await fillSazWorkbook(workbook, template, [product]), { productCount: 1, rowCount: 12 });
  const reread = new ExcelJS.Workbook();
  await reread.xlsx.load(await workbook.xlsx.writeBuffer());
  const sheet = reread.worksheets[0];
  assert.equal(sheet.name, 'Hoja1');
  assert.equal(sheet.rowCount, 13);
  assert.deepEqual(sheet.getRow(1).values.slice(1), SAZ_HEADERS);
  for (let i = 2; i <= sheet.rowCount; i++) {
    assert.equal(sheet.getCell(i, 1).value, '005807');
    assert.equal(sheet.getCell(i, 17).value, null);
  }
});

test('descarga real del manejador: 1, 10 y todos sin truncar a la página visible', async () => {
  const all = Array.from({ length: 12 }, (_, i) => ({ ...product, id: i + 1, estilo: `PRUEBA${i}`, activo: 1 }));
  const ops = { getAll: ({ limit }) => ({ items: all.slice(0, limit), pagination: { total: all.length } }), getById: id => all.find(p => p.id === id) };
  const template = path.join(path.dirname(fileURLToPath(import.meta.url)), 'templates', 'alta-masiva-saz.xlsx');
  const handler = createSazExportHandler(ops, template, ExcelJS.Workbook);
  for (const [query, expected] of [[{ modo: 'uno', producto: '2' }, 1], [{ modo: 'varios', cantidad: '10' }, 10], [{ modo: 'todos' }, 12]]) {
    const headers = {}; let body;
    const res = { setHeader: (k, v) => { headers[k] = v; }, send: v => { body = v; }, status: () => { throw new Error('Respuesta HTTP inesperada'); } };
    await handler({ query }, res);
    assert.equal(headers['X-SAZ-Products'], String(expected));
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(body);
    assert.equal(workbook.worksheets[0].rowCount, expected * 12 + 1);
    if (query.producto) assert.equal(workbook.worksheets[0].getCell('A2').value, 'PRUEBA1');
  }
});
