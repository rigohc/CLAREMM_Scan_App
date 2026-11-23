'use strict';

const COLOR_ALIASES = {
  NB: 'NEGRO BLANCO',
  'N B': 'NEGRO BLANCO',
  BN: 'BLANCO NEGRO',
  'B N': 'BLANCO NEGRO',
  FUCSIA: 'FIUSHA',
  FUCHSIA: 'FIUSHA',
  FUSCIA: 'FIUSHA',
  FUCHIA: 'FIUSHA',
};
const REVIEW_PREFIX = 'CLAREMM_REVIEW:';
const BLOCKED_BRANCHES = new Set(['JUAREZ']);
const TIPO_VALUES = new Set(['NINOS', 'NINAS', 'DAMA', 'CABALLERO']);

function text(value) {
  return String(value ?? '').trim();
}

function normalize(value) {
  return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ');
}

function estiloText(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
  return text(value);
}

function compactEstilo(value) {
  return normalize(estiloText(value)).replace(/^0+(?=\d)/, '');
}

function padEstilo(value) {
  const compact = compactEstilo(value);
  if (/^\d+$/.test(compact)) return compact.padStart(Math.max(6, compact.length), '0');
  return normalize(estiloText(value));
}

function estiloKeys(value) {
  const raw = normalize(estiloText(value));
  const compact = compactEstilo(raw);
  const hyphenless = compact.replace(/-/g, '');
  const keys = [raw, compact, hyphenless];
  if (/^\d+$/.test(hyphenless)) {
    for (let length = hyphenless.length; length <= Math.max(6, hyphenless.length); length += 1) {
      keys.push(hyphenless.padStart(length, '0'));
    }
  }
  return [...new Set(keys.filter(Boolean))];
}

function colorKey(value) {
  const spaced = normalize(value).replace(/[\/]+/g, ' ').replace(/\s+/g, ' ');
  return COLOR_ALIASES[spaced] || COLOR_ALIASES[spaced.replace(/ /g, '')] || spaced;
}

function lookupKey(estilo, color) {
  return `${compactEstilo(estilo).replace(/-/g, '')}|${colorKey(color)}`;
}

function sizeKey(value) {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed.toFixed(1) : '';
}

function isValidSize(value) {
  const key = sizeKey(value);
  return /^\d+\.\d$/.test(key) && Number(key) > 0;
}

function isValidQuantity(value) {
  const quantity = Number(value);
  return Number.isInteger(quantity) && quantity >= 1;
}

function truthy(value) {
  return /^(1|true|si|sí|yes)$/i.test(text(value));
}

function parsePrice(value) {
  const raw = text(value).replace(/[^0-9,.-]/g, '');
  if (!raw) return 0;
  const comma = raw.lastIndexOf(',');
  const dot = raw.lastIndexOf('.');
  return Number(comma > dot ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '')) || 0;
}

function catalogCorrida(value) {
  return normalize(value).replace(/[–—]/g, '-').replace(/\s+/g, '').replace(/(\d+)\.0(?!\d)/g, '$1');
}

function corridaContainsSize(corrida, size) {
  const match = catalogCorrida(corrida).match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
  const parsed = Number(size);
  return Boolean(match) && Number.isFinite(parsed) && parsed >= Number(match[1]) && parsed <= Number(match[2]);
}

function sameEstilo(left, right) {
  const a = new Set(estiloKeys(left));
  return estiloKeys(right).some(key => a.has(key));
}

function blockedBranch(code) {
  return BLOCKED_BRANCHES.has(normalize(code).replace(/ /g, '_'));
}

function groupRows(rows) {
  const grouped = new Map();
  const invalid = [];
  (rows || []).forEach((row, index) => {
    const sourceRow = Number(row.row || row.source_row || index + 1);
    const estilo = estiloText(row.estilo);
    const color = colorKey(row.color);
    const talla = sizeKey(row.talla);
    if (!estilo || !color) {
      invalid.push({ row: sourceRow, estilo, color, talla, cantidad: row.cantidad, motivo: 'Estilo y color son obligatorios.' });
      return;
    }
    if (!isValidSize(row.talla)) {
      invalid.push({ row: sourceRow, estilo, color, talla: text(row.talla), cantidad: row.cantidad, motivo: 'La talla debe tener un decimal, por ejemplo 24.0.' });
      return;
    }
    if (!isValidQuantity(row.cantidad)) {
      invalid.push({ row: sourceRow, estilo, color, talla, cantidad: row.cantidad, motivo: 'La cantidad debe ser un entero mayor o igual a 1.' });
      return;
    }
    const key = `${lookupKey(estilo, color)}|${talla}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        ...row,
        estilo,
        color,
        talla,
        cantidad: 0,
        source_rows: [],
        crear: Boolean(row.crear) || truthy(row.crear),
        material_source: (text(row.material) || text(row.acabado)) ? 'row' : 'default',
      });
    }
    const current = grouped.get(key);
    current.cantidad += Number(row.cantidad);
    current.source_rows.push(sourceRow);
    if (parsePrice(row.precio) > 0) current.precio = parsePrice(row.precio);
    if (text(row.marca)) current.marca = text(row.marca);
    if (text(row.tipo) || text(row.linea)) current.tipo = text(row.tipo || row.linea);
    if (text(row.material) || text(row.acabado)) {
      current.material = text(row.material || row.acabado);
      current.material_source = 'row';
    }
    if (row.crear === true || truthy(row.crear)) current.crear = true;
  });
  return { rows: [...grouped.values()], invalid, filas: grouped.size };
}

function indexProducts(products) {
  const byLookup = new Map();
  const byEstilo = new Map();
  for (const product of products || []) {
    if (product?.activo === false) continue;
    const key = lookupKey(product.estilo, product.color);
    if (!byLookup.has(key)) byLookup.set(key, []);
    byLookup.get(key).push(product);
    for (const estilo of estiloKeys(product.estilo)) {
      if (!byEstilo.has(estilo)) byEstilo.set(estilo, []);
      if (!byEstilo.get(estilo).some(item => item.id === product.id)) byEstilo.get(estilo).push(product);
    }
  }
  return { byLookup, byEstilo };
}

function siblingsOf(index, estilo) {
  const seen = new Map();
  for (const key of estiloKeys(estilo)) {
    for (const product of index.byEstilo.get(key) || []) seen.set(product.id, product);
  }
  return [...seen.values()];
}

function findProduct(index, estilo, color) {
  const seen = new Map();
  const wanted = colorKey(color);
    for (const key of estiloKeys(estilo)) {
    for (const product of index.byLookup.get(lookupKey(key, wanted)) || []) seen.set(product.id, product);
  }
  const list = [...seen.values()];
  if (!list.length) return null;
  return [...list].sort((left, right) => {
    const score = product => (Number(product.precio) > 0 ? 1000 : 0) + (text(product.imagen) ? 400 : 0) + (/^0+\d/.test(String(product.estilo || '')) ? 80 : 0);
    return score(right) - score(left);
  })[0];
}

function unknownReason(estilo, color, siblings) {
  const colors = [...new Set(siblings.map(item => item.color).filter(Boolean))];
  if (colors.length) return `El estilo ${padEstilo(estilo)} sí existe (${colors.join(', ')}). No hay ficha con color ${colorKey(color)}.`;
  return `No existe el estilo ${padEstilo(estilo)} en el catálogo.`;
}

function inheritPrice({ estilo, size, products, explicitPrice }) {
  const sent = parsePrice(explicitPrice);
  if (sent > 0) return { precio: sent, precio_origen: 'excel' };
  const siblings = (products || []).filter(product => sameEstilo(product.estilo, estilo) && Number(product.precio) > 0);
  const sameRun = siblings.filter(product => corridaContainsSize(product.corrida, size) || !text(product.corrida));
  const pool = sameRun.length ? sameRun : siblings;
  if (!pool.length) return { precio: 0, precio_origen: 'cero' };
  const frequency = new Map();
  for (const product of pool) frequency.set(Number(product.precio), (frequency.get(Number(product.precio)) || 0) + 1);
  const precio = [...frequency].sort((left, right) => right[1] - left[1] || right[0] - left[0])[0][0];
  return { precio, precio_origen: 'heredado' };
}

function inferTipo({ tipo, size, siblings }) {
  if (text(tipo)) {
    const resolved = normalize(tipo);
    return { tipo: text(tipo), tipo_inferido: false, linea: TIPO_VALUES.has(resolved) ? resolved.replace('NINOS', 'NIÑOS').replace('NINAS', 'NIÑAS') : text(tipo) };
  }
  const siblingTipo = (siblings || []).map(item => text(item.linea)).find(Boolean);
  if (siblingTipo) return { tipo: siblingTipo, tipo_inferido: true, linea: siblingTipo };
  const parsed = Number(size);
  const inferred = Number.isFinite(parsed) && parsed >= 25 ? 'CABALLERO' : 'DAMA';
  return { tipo: inferred, tipo_inferido: true, linea: inferred };
}

function resolveMaterial({ labelMaterial, existingAcabado, labelSource }) {
  const sent = text(labelMaterial);
  const source = labelSource || (sent ? 'row' : 'default');
  const hasSent = source !== 'default' && Boolean(sent);
  const existing = text(existingAcabado);
  const labelValue = !hasSent ? '' : (normalize(sent) === 'PIEL' ? 'PIEL' : sent);
  if (existing) {
    const mismatch = hasSent && normalize(existing) === 'PIEL' && normalize(sent) === 'SINTETICO';
    return {
      material: existing,
      overwrite: false,
      mismatch,
      label: hasSent ? labelValue : existing,
      label_source: hasSent ? source : 'default',
    };
  }
  const material = hasSent ? (normalize(sent) === 'PIEL' ? 'PIEL' : sent) : 'SINTETICO';
  return {
    material,
    overwrite: true,
    mismatch: false,
    label: material,
    label_source: hasSent ? source : 'default',
  };
}

function dedupeByLookup(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const key = lookupKey(row.estilo, row.color);
    if (!map.has(key)) {
      map.set(key, {
        ...row,
        tallas: [row.talla].filter(Boolean),
        source_rows: [...(row.source_rows || [])],
      });
      continue;
    }
    const current = map.get(key);
    if (row.talla && !current.tallas.includes(row.talla)) current.tallas.push(row.talla);
    current.cantidad = Number(current.cantidad || 0) + Number(row.cantidad || 0);
    current.source_rows.push(...(row.source_rows || []));
    if (parsePrice(row.precio) > 0) current.precio = parsePrice(row.precio);
    if (text(row.marca)) current.marca = text(row.marca);
    if (text(row.tipo) || text(row.linea)) current.tipo = text(row.tipo || row.linea);
    if (row.material_source === 'row' || (text(row.material) && current.material_source !== 'row')) {
      current.material = text(row.material);
      current.material_source = row.material_source || 'row';
    }
  }
  return [...map.values()];
}

function productSourceId(batchId, estilo, color) {
  return `${text(batchId)}:${lookupKey(estilo, color)}`;
}

function productPayload(row) {
  return row.product || {};
}

function classifyRows({ rows, products, productExtras = [], createUnknowns = false }) {
  const grouped = groupRows(rows);
  const extras = new Map();
  for (const item of productExtras || []) extras.set(lookupKey(item.estilo, item.color), item);
  const index = indexProducts(products);
  const encontradas = [];
  const desconocidas = [];
  const creables = [];
  for (const row of grouped.rows) {
    const extra = extras.get(lookupKey(row.estilo, row.color)) || {};
    const rowMaterial = text(row.material) || text(row.acabado);
    const extraMaterial = text(extra.material) || text(extra.acabado);
    const material_source = rowMaterial ? (row.material_source || 'row') : extraMaterial ? 'products' : 'default';
    const merged = {
      ...row,
      marca: text(extra.marca) || text(row.marca),
      tipo: text(extra.tipo) || text(row.tipo),
      material: rowMaterial || extraMaterial,
      material_source,
      precio: extra.precio != null ? extra.precio : row.precio,
      crear: extra.crear === true || extra.crear === 'true' || row.crear || createUnknowns,
    };
    const product = findProduct(index, merged.estilo, merged.color);
    const siblings = siblingsOf(index, merged.estilo);
    if (product) {
      encontradas.push({ ...merged, product, ficha_id: product.id, estiloExists: true });
      continue;
    }
    const unknown = {
      ...merged,
      motivo: unknownReason(merged.estilo, merged.color, siblings),
      estiloExists: siblings.length > 0,
      similarColors: siblings.map(item => item.color).filter(Boolean),
      siblings,
      willCreate: false,
    };
    const authorized = Boolean(merged.crear || createUnknowns);
    const hasIdentity = Boolean(text(merged.marca) || siblings.length);
    unknown.willCreate = authorized && hasIdentity;
    desconocidas.push(unknown);
    if (unknown.willCreate) creables.push(unknown);
  }
  const pares = grouped.rows.reduce((sum, row) => sum + Number(row.cantidad || 0), 0);
  return {
    filas: grouped.filas,
    pares,
    encontradas,
    desconocidas,
    creables,
    omitidas: grouped.invalid,
    invalid: grouped.invalid,
  };
}

function serializeReview(meta) {
  return `${REVIEW_PREFIX}${JSON.stringify(meta)}`;
}

function parseReview(descripcion) {
  const raw = text(descripcion);
  const index = raw.indexOf(REVIEW_PREFIX);
  if (index < 0) return { notes: raw, review: null };
  const json = raw.slice(index + REVIEW_PREFIX.length);
  const notes = raw.slice(0, index).trim();
  try { return { notes, review: JSON.parse(json) }; }
  catch { return { notes: raw, review: null }; }
}

function writeReview(descripcion, review) {
  const parsed = parseReview(descripcion);
  const body = serializeReview(review);
  return parsed.notes ? `${parsed.notes}\n${body}` : body;
}

function buildPreview(classified) {
  return {
    filas: classified.filas,
    encontradas: classified.encontradas.length,
    desconocidas: classified.desconocidas.length,
    pares: classified.pares,
    creables: classified.creables.length,
    desconocidas_detalle: classified.desconocidas.map(row => ({
      estilo: row.estilo,
      color: row.color,
      talla: row.talla,
      cantidad: row.cantidad,
      motivo: row.motivo,
      willCreate: row.willCreate,
      similar_colores: row.similarColors || [],
    })),
    omitidas: classified.omitidas,
  };
}

module.exports = {
  COLOR_ALIASES,
  REVIEW_PREFIX,
  text,
  normalize,
  estiloText,
  compactEstilo,
  padEstilo,
  estiloKeys,
  colorKey,
  lookupKey,
  sizeKey,
  isValidSize,
  isValidQuantity,
  parsePrice,
  sameEstilo,
  blockedBranch,
  groupRows,
  indexProducts,
  findProduct,
  siblingsOf,
  unknownReason,
  inheritPrice,
  inferTipo,
  resolveMaterial,
  dedupeByLookup,
  productSourceId,
  classifyRows,
  parseReview,
  writeReview,
  serializeReview,
  buildPreview,
  productPayload,
  corridaContainsSize,
};
