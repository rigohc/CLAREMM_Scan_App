import { getSizesForCorrida } from './inventory.js';

export const SAZ_HEADERS = ['ESTILO', 'COLOR', 'ACABADO', 'MARCA', 'LINEA', 'TALLA', 'TEMPORADA', 'SUBLINEA', 'CLASIFICACION', 'OBSERVACIONES', 'DESCRIPCION', 'PROVEEDOR', 'PAGINA', 'CATALOGO', 'COSTO', 'P1', 'SKU', 'SKU_PROV'];

export function sazSelection(query) {
  const mode = query.modo || 'uno';
  if (!['uno', 'varios', 'todos'].includes(mode)) throw new Error('Selecciona 1 producto, varios o todos.');
  const count = mode === 'uno' ? 1 : mode === 'todos' ? null : Number(query.cantidad);
  if (count !== null && (!Number.isSafeInteger(count) || count < 1)) throw new Error('La cantidad debe ser un entero mayor que cero.');
  const id = query.producto ? Number(query.producto) : null;
  if (id !== null && (mode !== 'uno' || !Number.isSafeInteger(id) || id < 1)) throw new Error('El producto seleccionado no es válido.');
  return { mode, count, id };
}

export function sazRows(products) {
  return products.flatMap(product => {
    let sizes;
    try { sizes = getSizesForCorrida(product.corrida); }
    catch (error) { throw new Error(`Estilo ${product.estilo}: ${error.message}`); }
    const text = key => String(product[key] ?? '');
    const amount = key => {
      const value = product[key];
      if (value === '' || value == null) return null;
      if (!Number.isFinite(Number(value)) || Number(value) < 0) throw new Error(`Estilo ${product.estilo}: ${key} no válido.`);
      return Number(value);
    };
    return sizes.map(size => [text('estilo'), text('color'), text('acabado'), text('marca'), text('linea'), Number(size), text('temporada'), text('sublinea'), text('clasificacion'), text('observaciones'), text('descripcion'), text('proveedor'), product.pagina ?? null, text('catalogo'), amount('costo'), amount('precio'), null, null]);
  });
}

export async function fillSazWorkbook(workbook, templatePath, products) {
  await workbook.xlsx.readFile(templatePath);
  let sheet = workbook.worksheets[0];
  if (!sheet || SAZ_HEADERS.some((header, i) => sheet.getCell(1, i + 1).value !== header)) throw new Error('La plantilla SAZ no tiene los encabezados esperados.');
  const rows = sazRows(products);
  const styles = SAZ_HEADERS.map((_, i) => structuredClone(sheet.getCell(2, i + 1).style));
  const height = sheet.getRow(2).height;
  // Recreate the data sheet: ExcelJS spliceRows can retain trailing sample rows.
  const headerStyles = SAZ_HEADERS.map((_, i) => structuredClone(sheet.getCell(1, i + 1).style));
  const headerHeight = sheet.getRow(1).height;
  const columns = SAZ_HEADERS.map((_, i) => ({ width: sheet.getColumn(i + 1).width, style: structuredClone(sheet.getColumn(i + 1).style) }));
  const options = { properties: structuredClone(sheet.properties), pageSetup: structuredClone(sheet.pageSetup), views: structuredClone(sheet.views) };
  const name = sheet.name;
  workbook.removeWorksheet(sheet.id);
  sheet = workbook.addWorksheet(name, options);
  sheet.columns = columns;
  const header = sheet.addRow(SAZ_HEADERS);
  header.height = headerHeight;
  header.eachCell((cell, i) => { cell.style = headerStyles[i - 1]; });
  for (const values of rows) {
    const row = sheet.addRow(values);
    row.height = height;
    row.eachCell({ includeEmpty: true }, (cell, i) => { cell.style = structuredClone(styles[i - 1] || {}); });
    for (const col of [1, 17, 18]) row.getCell(col).numFmt = '@';
  }
  return { productCount: products.length, rowCount: rows.length };
}

export function createSazExportHandler(productOperations, templatePath, Workbook) {
  return async (req, res) => {
    try {
      const selection = sazSelection(req.query);
      let products;
      if (selection.id) {
        const product = productOperations.getById(selection.id);
        if (!product || product.activo === 0) return res.status(404).json({ success: false, message: 'El producto seleccionado ya no está disponible.' });
        products = [product];
      } else {
        const total = productOperations.getAll({ limit: 1 }).pagination.total;
        products = productOperations.getAll({ limit: selection.count === null ? Math.max(total, 1) : selection.count }).items;
      }
      if (!products.length) return res.status(400).json({ success: false, message: 'No hay productos activos para exportar.' });
      const workbook = new Workbook();
      const summary = await fillSazWorkbook(workbook, templatePath, products);
      const buffer = await workbook.xlsx.writeBuffer();
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="CLAREMM_Alta_Masiva_SAZ.xlsx"');
      res.setHeader('X-SAZ-Products', String(summary.productCount));
      res.setHeader('X-SAZ-Rows', String(summary.rowCount));
      res.send(buffer);
    } catch (error) {
      res.status(400).json({ success: false, message: error.message || 'No se pudo generar la plantilla SAZ.' });
    }
  };
}
