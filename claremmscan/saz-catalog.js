'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ClaremmSazCatalog = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  const DEFAULT_TEMPORADA = 'CLAREMM 26';
  const FIXED_OPTIONS = {
    departamento: ['CALZADO', 'ROPA'],
    suela: ['SUELAS'],
    plantilla: ['PLANTILLAS'],
    tacon: ['PISO'],
    forro: ['FORRO'],
  };
  const DATALISTS = {
    color: 'sazColorOptions',
    marca: 'sazMarcaOptions',
    linea: 'sazLineaOptions',
    acabado: 'sazAcabadoOptions',
    temporada: 'sazTemporadaOptions',
    clasificacion: 'sazClasificacionOptions',
    sublinea: 'sazSublineaOptions',
    proveedor: 'sazProveedorOptions',
    corrida: 'sazCorridaOptions',
    departamento: 'sazDepartamentoOptions',
  };
  const FUZZY_FIELDS = new Set(['color', 'acabado', 'linea', 'clasificacion', 'temporada', 'departamento', 'sublinea']);
  const OPEN_FIELDS = new Set(['proveedor']);
  const COLOR_ALIASES = {
    'NB': 'NEGRO BLANCO',
    'N B': 'NEGRO BLANCO',
    'BN': 'BLANCO NEGRO',
    'B N': 'BLANCO NEGRO',
    'FUCSIA': 'FIUSHA',
    'FUCHSIA': 'FIUSHA',
    'FUSCIA': 'FIUSHA',
    'FUCHIA': 'FIUSHA',
  };

  let loaded = false;
  const indexes = {};

  function formatCorrida(value) {
    const text = String(value || '').trim();
    const range = text.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
    const selected = text.match(/^(\d+(?:\.\d+)?)\s+al\s+(\d+(?:\.\d+)?)\s+inc\s+\d+(?:\.\d+)?$/i);
    const match = range || selected;
    return match ? `${Number(match[1]).toFixed(2)}-${Number(match[2]).toFixed(2)}` : text;
  }

  function normalizeKey(value) {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLocaleUpperCase('es');
  }

  function fieldTokens(value) {
    return normalizeKey(value).replace(/[\/\-_,+|.]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function editDistance(left, right) {
    const a = String(left || ''), b = String(right || '');
    const row = [...Array(b.length + 1).keys()];
    for (let i = 1; i <= a.length; i++) {
      let prev = row[0];
      row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const old = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = old;
      }
    }
    return row[b.length];
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function buildIndex(field, values) {
    const byKey = new Map();
    const byTokens = new Map();
    const byInitials = new Map();
    for (const raw of values || []) {
      const text = String(raw ?? '').trim().replace(/\s+/g, ' ');
      const value = field === 'corrida' ? formatCorrida(text) : text;
      if (!value) continue;
      const key = normalizeKey(value);
      if (!byKey.has(key)) byKey.set(key, value);
      const tokens = fieldTokens(value);
      if (tokens && !byTokens.has(tokens)) byTokens.set(tokens, value);
      const initials = tokens.split(' ').map(part => part[0]).join('');
      if (initials.length >= 2) {
        if (!byInitials.has(initials)) byInitials.set(initials, []);
        byInitials.get(initials).push(value);
      }
    }
    indexes[field] = { byKey, byTokens, byInitials, values: [...byKey.values()] };
  }

  function loadFromData(productOptions = {}, providerOptions = []) {
    const seeds = {
      color: productOptions.color || [],
      acabado: productOptions.acabado || [],
      corrida: productOptions.corrida || [],
      marca: productOptions.marca || [],
      proveedor: Array.isArray(providerOptions) ? providerOptions : [],
      sublinea: productOptions.sublinea || [],
      temporada: productOptions.temporada || [],
      departamento: FIXED_OPTIONS.departamento,
      clasificacion: productOptions.clasificacion || [],
      linea: productOptions.linea || [],
      suela: FIXED_OPTIONS.suela,
      plantilla: productOptions.plantilla?.length ? productOptions.plantilla : FIXED_OPTIONS.plantilla,
      tacon: FIXED_OPTIONS.tacon,
      forro: FIXED_OPTIONS.forro,
      catalogo: productOptions.catalogo || [],
      comprador: productOptions.comprador || [],
      status: productOptions.status || [],
    };
    for (const [field, values] of Object.entries(seeds)) buildIndex(field, values);
    loaded = true;
    fillDatalists();
    return api;
  }

  function getOptions(field) {
    return indexes[field]?.values || FIXED_OPTIONS[field] || [];
  }

  function resolve(field, raw) {
    const text = String(raw ?? '').trim().replace(/\s+/g, ' ');
    if (!text) return '';
    const formatted = field === 'corrida' ? formatCorrida(text) : text;
    const idx = indexes[field];
    if (!idx) return formatted;
    const key = normalizeKey(formatted);
    if (idx.byKey.has(key)) return idx.byKey.get(key);
    const tokens = fieldTokens(formatted);
    if (idx.byTokens.has(tokens)) return idx.byTokens.get(tokens);
    const alias = COLOR_ALIASES[tokens] || COLOR_ALIASES[key];
    if (field === 'color' && alias && idx.byKey.has(normalizeKey(alias))) return idx.byKey.get(normalizeKey(alias));
    if (field === 'color' && /^[A-Z]{2,4}$/.test(tokens.replace(/ /g, '')) && tokens.length <= 7) {
      const hits = unique(idx.byInitials.get(tokens.replace(/ /g, '')) || []);
      if (hits.length === 1) return hits[0];
    }
    if (OPEN_FIELDS.has(field)) return formatted;
    if (key.length >= 3) {
      const prefixes = idx.values.filter(value => normalizeKey(value).startsWith(key) || fieldTokens(value).startsWith(tokens));
      if (prefixes.length === 1) return prefixes[0];
    }
    if (FUZZY_FIELDS.has(field) && key.length >= 4) {
      const contains = idx.values.filter(value => normalizeKey(value).includes(key) || fieldTokens(value).includes(tokens));
      if (contains.length === 1) return contains[0];
    }
    if (FUZZY_FIELDS.has(field) && key.length >= 4 && key.length <= 18) {
      const close = idx.values.filter(value => {
        const candidate = normalizeKey(value);
        return Math.abs(candidate.length - key.length) <= 1 && editDistance(candidate, key) === 1;
      });
      if (close.length === 1) return close[0];
    }
    return formatted;
  }

  function matches(field, left, right) {
    const a = resolve(field, left);
    const b = resolve(field, right);
    if (!a || !b) return false;
    if (normalizeKey(a) === normalizeKey(b)) return true;
    return field === 'color' && fieldTokens(a) === fieldTokens(b);
  }

  function suggestions(field, raw, limit = 8) {
    const resolved = resolve(field, raw);
    const tokens = fieldTokens(raw);
    const key = normalizeKey(raw);
    const values = getOptions(field);
    if (!key) return values.slice(0, limit);
    const ranked = [];
    for (const value of values) {
      const candidate = normalizeKey(value);
      const candidateTokens = fieldTokens(value);
      let score = 0;
      if (candidate === key || value === resolved) score = 100;
      else if (candidate.startsWith(key) || candidateTokens.startsWith(tokens)) score = 80;
      else if (candidate.includes(key) || candidateTokens.includes(tokens)) score = 50;
      if (score) ranked.push({ value, score });
    }
    ranked.sort((left, right) => right.score - left.score || left.value.localeCompare(right.value, 'es', { sensitivity: 'base' }));
    const seen = new Set();
    const result = [];
    for (const item of [{ value: resolved, score: 101 }, ...ranked]) {
      if (!item.value || seen.has(item.value)) continue;
      seen.add(item.value);
      result.push(item.value);
      if (result.length >= limit) break;
    }
    return result;
  }

  function datalistId(field) {
    return DATALISTS[field] || '';
  }

  function fillDatalists() {
    if (typeof document === 'undefined') return;
    for (const [field, id] of Object.entries(DATALISTS)) {
      let list = document.getElementById(id);
      if (!list) {
        list = document.createElement('datalist');
        list.id = id;
        document.body.append(list);
      }
      list.innerHTML = getOptions(field).map(value => `<option value="${String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))}"></option>`).join('');
    }
  }

  function canonicalize(record = {}) {
    const next = { ...record };
    if (next.color) next.color = resolve('color', next.color);
    if (next.marca) next.marca = resolve('marca', next.marca);
    if (next.linea) next.linea = resolve('linea', next.linea);
    if (next.material) next.material = resolve('acabado', next.material);
    if (next.acabado) next.acabado = resolve('acabado', next.acabado);
    if (next.proveedor) next.proveedor = resolve('proveedor', next.proveedor);
    if (next.sublinea) next.sublinea = resolve('sublinea', next.sublinea);
    if (next.clasificacion) next.clasificacion = resolve('clasificacion', next.clasificacion);
    if (next.temporada) next.temporada = resolve('temporada', next.temporada);
    if (next.departamento) next.departamento = resolve('departamento', next.departamento);
    if (next.corrida) next.corrida = resolve('corrida', next.corrida);
    return next;
  }

  async function loadFromUrls(productUrl, providerUrl) {
    const [product, providers] = await Promise.all([
      fetch(productUrl).then(response => {
        if (!response.ok) throw new Error(`No se cargó el catálogo SAZ (${response.status}).`);
        return response.json();
      }),
      fetch(providerUrl).then(response => {
        if (!response.ok) throw new Error(`No se cargaron los proveedores SAZ (${response.status}).`);
        return response.json();
      }),
    ]);
    loadFromData(product, providers);
    return api;
  }

  const ready = typeof document === 'undefined'
    ? Promise.resolve()
    : loadFromUrls('./saz-catalog/product-option-values.json', './saz-catalog/provider-option-values.json').catch(error => {
      console.warn('CLAREMM SAZ catalog:', error.message);
    });

  const api = {
    DEFAULT_TEMPORADA,
    FIXED_OPTIONS,
    formatCorrida,
    normalizeKey,
    fieldTokens,
    loadFromData,
    loadFromUrls,
    getOptions,
    resolve,
    matches,
    suggestions,
    datalistId,
    canonicalize,
    isLoaded: () => loaded,
    ready,
  };
  return api;
}));
