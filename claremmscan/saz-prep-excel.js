'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ClaremmSazPrepExcel = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  const DEFAULT_TEMPORADA = 'CLAREMM 26';
  const DEFAULT_DEPARTAMENTO = 'CALZADO';
  const INVENTORY_SHEET = 'Inventario';
  const RESUMEN_SHEET = 'Resumen Inventario';
  const FIXED_HEADERS = Object.freeze([
    'Estilo',
    'Color',
    'Precio de venta',
    'Marca',
    'Proveedor',
    'Temporada',
    'Sublinea',
    'Departamento',
    'Clasificacion',
    'Linea',
    'Corrida de tallas',
    'Material/Acabado',
    'Suela',
    'Plantillas',
    'Tacon',
    'Forro',
    'Catalogo',
    'Status',
    'Observaciones',
    'Costo',
  ]);
  const SIZE_HEADERS = Object.freeze((() => {
    const sizes = [];
    for (let size = 10; size <= 31 + 1e-9; size += 0.5) sizes.push(size.toFixed(1));
    return sizes;
  })());
  const INVENTORY_HEADERS = Object.freeze([...FIXED_HEADERS, ...SIZE_HEADERS, 'Total Existencia']);
  const RESUMEN_HEADERS = Object.freeze(['Marca', 'Línea', 'Sublínea', 'Modelos / Estilos', 'Total Pares en Existencia']);
  const TEXT_FILL = Object.freeze([
    'marca', 'proveedor', 'temporada', 'sublinea', 'departamento', 'clasificacion',
    'linea', 'corrida', 'acabado', 'suela', 'plantilla', 'tacon', 'forro', 'catalogo',
  ]);

  function text(value) {
    return String(value ?? '').trim();
  }

  function normalize(value) {
    return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ');
  }

  function compactEstilo(value) {
    return normalize(value).replace(/^0+(?=\d)/, '');
  }

  function fichaKey(estilo, color) {
    return `${compactEstilo(estilo)}|${normalize(color)}`;
  }

  function isJuarezBranch(name) {
    const value = normalize(name).replace(/_/g, ' ');
    if (!value) return false;
    if (value === 'MATRIZ') return true;
    return value.includes('JUAREZ');
  }

  function sizeKey(value) {
    const number = Number(String(value ?? '').trim().replace(',', '.'));
    return Number.isFinite(number) ? number.toFixed(1) : '';
  }

  function moneyCell(value) {
    const number = Number(value);
    return number > 0 ? `$${number.toFixed(2)}` : '';
  }

  function todayNote(date = new Date()) {
    const valid = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
    const dd = String(valid.getDate()).padStart(2, '0');
    const mm = String(valid.getMonth() + 1).padStart(2, '0');
    const yy = String(valid.getFullYear()).slice(-2);
    return `${dd}/${mm}/${yy}`;
  }

  function addSizeQty(qtyBySize, size, quantity) {
    const key = sizeKey(size);
    const qty = Math.trunc(Number(quantity) || 0);
    if (!key || qty <= 0) return qtyBySize;
    qtyBySize[key] = (qtyBySize[key] || 0) + qty;
    return qtyBySize;
  }

  function mergeQtyBySize(primary, secondary) {
    const out = { ...(primary || {}) };
    for (const [size, quantity] of Object.entries(secondary || {})) {
      const key = sizeKey(size);
      const qty = Math.trunc(Number(quantity) || 0);
      if (!key || qty <= 0) continue;
      out[key] = Math.max(Number(out[key] || 0), qty);
    }
    return out;
  }

  function pairsFromSizes(qtyBySize) {
    return Object.values(qtyBySize || {}).reduce((sum, quantity) => sum + Math.trunc(Number(quantity) || 0), 0);
  }

  function toInventoryRow(row, note) {
    const qtyBySize = row?.qtyBySize || {};
    const observaciones = text(row?.observaciones) || note || '';
    const sheetRow = {
      Estilo: text(row?.estilo),
      Color: text(row?.color),
      'Precio de venta': moneyCell(row?.precio),
      Marca: text(row?.marca),
      Proveedor: text(row?.proveedor),
      Temporada: text(row?.temporada) || DEFAULT_TEMPORADA,
      Sublinea: text(row?.sublinea),
      Departamento: text(row?.departamento) || DEFAULT_DEPARTAMENTO,
      Clasificacion: text(row?.clasificacion),
      Linea: text(row?.linea || row?.tipo),
      'Corrida de tallas': text(row?.corrida),
      'Material/Acabado': text(row?.acabado || row?.material),
      Suela: text(row?.suela),
      Plantillas: text(row?.plantilla || row?.plantillas),
      Tacon: text(row?.tacon),
      Forro: text(row?.forro),
      Catalogo: text(row?.catalogo),
      Status: row?.status == null || row?.status === '' ? 1 : row.status,
      Observaciones: observaciones,
      Costo: moneyCell(row?.costo),
    };
    let total = 0;
    for (const size of SIZE_HEADERS) {
      const qty = Math.trunc(Number(qtyBySize[size] || 0));
      sheetRow[size] = qty > 0 ? qty : '';
      total += qty;
    }
    sheetRow['Total Existencia'] = total;
    return sheetRow;
  }

  function toInventoryRows(rows, date) {
    const note = todayNote(date);
    return (rows || []).map(row => toInventoryRow(row, note));
  }

  function toResumenRows(inventoryRows) {
    const groups = new Map();
    for (const row of inventoryRows || []) {
      const marca = text(row.Marca);
      const linea = text(row.Linea);
      const sublinea = text(row.Sublinea);
      const key = `${normalize(marca)}|${normalize(linea)}|${normalize(sublinea)}`;
      const current = groups.get(key) || {
        Marca: marca,
        'Línea': linea,
        'Sublínea': sublinea,
        'Modelos / Estilos': 0,
        'Total Pares en Existencia': 0,
      };
      current['Modelos / Estilos'] += 1;
      current['Total Pares en Existencia'] += Number(row['Total Existencia'] || 0);
      groups.set(key, current);
    }
    return [...groups.values()].sort((left, right) => {
      const order = [
        normalize(left.Marca).localeCompare(normalize(right.Marca), 'es'),
        normalize(left['Línea']).localeCompare(normalize(right['Línea']), 'es'),
        normalize(left['Sublínea']).localeCompare(normalize(right['Sublínea']), 'es'),
      ];
      return order.find(value => value) || 0;
    });
  }

  function mergeGapRows(catalogRows, localRows, skipKeys) {
    const skip = new Set(skipKeys || []);
    const byKey = new Map();
    for (const row of catalogRows || []) {
      const key = fichaKey(row.estilo, row.color);
      byKey.set(key, { ...row, qtyBySize: { ...(row.qtyBySize || {}) }, origen: row.origen || 'catalogo' });
    }
    for (const row of localRows || []) {
      const key = fichaKey(row.estilo, row.color);
      if (skip.has(key)) continue;
      const current = byKey.get(key);
      if (!current) {
        byKey.set(key, { ...row, qtyBySize: { ...(row.qtyBySize || {}) } });
        continue;
      }
      current.origen = 'ambos';
      current.qtyBySize = mergeQtyBySize(current.qtyBySize, row.qtyBySize);
      current.pares = pairsFromSizes(current.qtyBySize);
      current.sin_imagen = Boolean(current.sin_imagen) && Boolean(row.sin_imagen);
      current.sin_precio = Boolean(current.sin_precio) && Boolean(row.sin_precio);
      if (!(Number(current.precio) > 0) && Number(row.precio) > 0) current.precio = row.precio;
      for (const field of TEXT_FILL) if (!current[field] && row[field]) current[field] = row[field];
      if (!current.linea && row.tipo) current.linea = row.tipo;
      if (!current.acabado && row.material) current.acabado = row.material;
      if (!current.sin_imagen && !current.sin_precio) byKey.delete(key);
    }
    return [...byKey.values()].sort((left, right) => normalize(`${left.estilo} ${left.color}`).localeCompare(normalize(`${right.estilo} ${right.color}`), 'es'));
  }

  return {
    DEFAULT_TEMPORADA,
    DEFAULT_DEPARTAMENTO,
    INVENTORY_SHEET,
    RESUMEN_SHEET,
    FIXED_HEADERS,
    SIZE_HEADERS,
    INVENTORY_HEADERS,
    RESUMEN_HEADERS,
    fichaKey,
    isJuarezBranch,
    sizeKey,
    addSizeQty,
    mergeQtyBySize,
    pairsFromSizes,
    todayNote,
    toInventoryRow,
    toInventoryRows,
    toResumenRows,
    mergeGapRows,
  };
}));
