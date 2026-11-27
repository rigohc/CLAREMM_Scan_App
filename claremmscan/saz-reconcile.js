'use strict';

((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ClaremmSazReconcile = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase().replace(/\s+/g, ' ');
  const canonicalColor = value => {
    const color = normalize(value).replace(/[\/]+/g, ' ').replace(/\s+/g, ' ');
    if (color === 'N B' || color === 'NB') return 'NEGRO BLANCO';
    if (color === 'B N' || color === 'BN') return 'BLANCO NEGRO';
    if (color === 'FUCSIA' || color === 'FUCHSIA' || color === 'FUSCIA' || color === 'FUCHIA') return 'FIUSHA';
    return color;
  };
  const estiloText = value => (typeof value === 'number' && Number.isFinite(value) ? String(Math.trunc(value)) : String(value ?? '').trim());
  const compactEstilo = value => normalize(value).replace(/\s+/g, '').replace(/^0+(?=\d)/, '');
  const compactKey = (estilo, color) => `${compactEstilo(estilo)}|${canonicalColor(color)}`;
  const sizeKey = value => {
    const raw = normalize(value);
    const numeric = Number(raw.replace(',', '.'));
    return Number.isFinite(numeric) ? numeric.toFixed(1) : raw;
  };
  const integer = value => Math.trunc(Number(value) || 0);

  function parseMatrix(matrix, fileName = '', normalizeColor = canonicalColor) {
    if (!Array.isArray(matrix) || !matrix.length) throw new Error('El archivo no contiene filas legibles.');
    const headers = matrix[0] || [];
    const columns = Object.fromEntries(headers.map((header, index) => [normalize(header), index]));
    for (const header of ['TIENDA', 'ESTILO', 'COLOR', 'TOTAL']) {
      if (columns[header] === undefined) throw new Error(`Falta la columna ${header}.`);
    }
    const firstSizeIndex = columns.FORRO + 1;
    const totalIndex = columns.TOTAL;
    if (!Number.isInteger(firstSizeIndex) || firstSizeIndex <= 0 || totalIndex <= firstSizeIndex) {
      throw new Error('No se pudo identificar el bloque de tallas entre Forro y Total.');
    }
    const sizeColumns = [];
    for (let index = firstSizeIndex; index < totalIndex; index += 1) {
      const header = String(headers[index] ?? '').trim();
      const match = header.match(/^(.+?)-(\d+)$/);
      const size = sizeKey(match ? match[1] : header);
      if (!size) throw new Error(`Columna de talla vacía en ${index + 1}.`);
      sizeColumns.push({ index, header, size });
    }

    const products = new Map();
    const blockedKeys = new Set();
    const blockedRows = [];
    const skippedSummaryRows = [];
    let sourceRows = 0;
    for (let index = 1; index < matrix.length; index += 1) {
      const row = matrix[index] || [];
      const tienda = normalize(row[columns.TIENDA]);
      const estilo = estiloText(row[columns.ESTILO]);
      const color = normalizeColor(row[columns.COLOR]);
      const declaredRaw = row[totalIndex];
      if (!tienda && (!color || /SUM\s*=|TOTAL/i.test(String(declaredRaw)))) {
        if (estilo || color || declaredRaw) skippedSummaryRows.push(index + 1);
        continue;
      }
      if (!estilo && !color) continue;
      sourceRows += 1;
      if (!estilo || !color) {
        blockedRows.push({ row: index + 1, estilo, color, reason: 'falta_estilo_o_color' });
        if (estilo || color) blockedKeys.add(`${compactEstilo(estilo)}|${color}`);
        continue;
      }
      const quantities = new Map();
      const negatives = [];
      let calculated = 0;
      for (const column of sizeColumns) {
        const quantity = integer(row[column.index]);
        calculated += quantity;
        if (quantity < 0) {
          negatives.push({ column: column.header, size: column.size, quantity });
          continue;
        }
        if (quantity) quantities.set(column.size, (quantities.get(column.size) || 0) + quantity);
      }
      const declared = integer(declaredRaw);
      const key = `${compactEstilo(estilo)}|${color}`;
      if (negatives.length || declared !== calculated) {
        blockedKeys.add(key);
        blockedRows.push({
          row: index + 1,
          estilo,
          color,
          declared,
          calculated,
          reason: negatives.length ? 'existencia_negativa' : 'total_no_cuadra',
          negatives,
        });
        continue;
      }
      if (!products.has(key)) {
        products.set(key, {
          key, estilo, color, tienda,
          acabado: normalize(row[columns.ACABADO]),
          marca: normalize(row[columns.MARCA]),
          temporada: normalize(row[columns.TEMPORADA]),
          clasificacion: normalize(row[columns.CLASIFICACION]),
          linea: normalize(row[columns.LINEA]),
          sublinea: normalize(row[columns.SUBLINEA]),
          departamento: normalize(row[columns.DEPARTAMENTO]),
          catalogo: normalize(row[columns.CATALOGO]),
          forro: normalize(row[columns.FORRO]),
          quantities: {}, pairs: 0, sourceRows: [],
        });
      }
      const product = products.get(key);
      product.pairs += calculated;
      product.sourceRows.push(index + 1);
      for (const [size, quantity] of quantities) product.quantities[size] = (product.quantities[size] || 0) + quantity;
    }
    const rows = [...products.values()].filter(row => !blockedKeys.has(row.key));
    return {
      fileName,
      sourceRows,
      products: rows,
      uniqueProducts: rows.length,
      variants: rows.reduce((sum, row) => sum + Object.keys(row.quantities).length, 0),
      pairs: rows.reduce((sum, row) => sum + row.pairs, 0),
      duplicateProducts: rows.filter(row => row.sourceRows.length > 1).length,
      sizeColumns: sizeColumns.length,
      blockedRows,
      skippedSummaryRows,
    };
  }

  async function readFile(file, xlsx = globalThis.XLSX) {
    if (!file) throw new Error('Selecciona un archivo de existencias SAZ.');
    if (!xlsx) throw new Error('No se cargó el lector de Excel.');
    const bytes = await file.arrayBuffer();
    const workbook = xlsx.read(bytes, { type: 'array', raw: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) throw new Error('El archivo no contiene una hoja legible.');
    const matrix = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
    const parsed = parseMatrix(matrix, file.name);
    const hash = await globalThis.crypto?.subtle?.digest?.('SHA-256', bytes);
    parsed.sha256 = hash ? [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('') : `${file.name}:${file.size}:${file.lastModified}`;
    parsed.sheetName = sheetName;
    return parsed;
  }

  return { normalize, canonicalColor, compactEstilo, compactKey, sizeKey, parseMatrix, readFile };
});
