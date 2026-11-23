'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ClaremmInventorySearch = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  const LIMITS = Object.freeze({
    MIN_PREFIX_CHARS: 3,
    MAX_PRODUCTS: 40,
    MAX_CARDS: 40,
    VARIANT_CHUNK: 200,
    DEBOUNCE_MS: 280,
  });

  function text(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
    return String(value ?? '').trim();
  }

  function normalize(value) {
    return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ');
  }

  function compactEstilo(value) {
    return normalize(value).replace(/^0+(?=\d)/, '');
  }

  function isNumericToken(value) {
    return /^\d+$/.test(normalize(value));
  }

  function estiloKeys(value) {
    const raw = normalize(value);
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

  function looksLikeEstiloToken(value) {
    const raw = normalize(value);
    if (!raw) return false;
    if (/^\d+$/.test(raw)) return true;
    return /[A-Z]/.test(raw) && /\d/.test(raw);
  }

  function sameEstilo(left, right) {
    const a = new Set(estiloKeys(left));
    return estiloKeys(right).some(key => a.has(key));
  }

  function plan(query) {
    const raw = normalize(query);
    const terms = raw.split(' ').filter(Boolean);
    const first = terms[0] || '';
    const idle = { ready: false, wait: false, mode: 'idle', keys: [], terms, allowPrefix: false, limit: LIMITS.MAX_PRODUCTS, cardLimit: LIMITS.MAX_CARDS, message: '' };
    if (!first) return idle;
    if (/^0+$/.test(first)) {
      return { ...idle, wait: true, mode: 'wait', limit: 0, cardLimit: 0, message: 'Sigue escribiendo el estilo…' };
    }
    if (isNumericToken(first)) {
      return {
        ready: true,
        wait: false,
        mode: 'exact-estilo',
        keys: estiloKeys(first),
        terms,
        allowPrefix: false,
        limit: LIMITS.MAX_PRODUCTS,
        cardLimit: LIMITS.MAX_CARDS,
        message: '',
      };
    }
    if (first.length < LIMITS.MIN_PREFIX_CHARS) {
      return { ...idle, wait: true, mode: 'wait', limit: 0, cardLimit: 0, message: 'Sigue escribiendo…' };
    }
    if (looksLikeEstiloToken(first)) {
      return {
        ready: true,
        wait: false,
        mode: 'prefix-estilo',
        keys: estiloKeys(first),
        terms,
        allowPrefix: true,
        limit: LIMITS.MAX_PRODUCTS,
        cardLimit: LIMITS.MAX_CARDS,
        message: '',
      };
    }
    return {
      ready: true,
      wait: false,
      mode: 'text',
      keys: estiloKeys(first),
      terms,
      allowPrefix: false,
      limit: LIMITS.MAX_PRODUCTS,
      cardLimit: LIMITS.MAX_CARDS,
      message: '',
    };
  }

  function matchesPlannedProduct(product, planned) {
    if (!planned?.ready || !product) return false;
    const compactProduct = compactEstilo(product.estilo);
    return (planned.terms || []).every(term => {
      const compactTerm = compactEstilo(term);
      if (compactTerm && compactProduct === compactTerm) return true;
      if (isNumericToken(term)) return false;
      const haystack = normalize([product.estilo, compactProduct, product.color, product.marca, product.linea].join(' '));
      return haystack.includes(normalize(term));
    });
  }

  function createLocalIndex() {
    let snapshot = [];
    let byCompact = new Map();

    function rebuild(items) {
      snapshot = Array.isArray(items) ? items : [];
      byCompact = new Map();
      snapshot.forEach((item, index) => {
        const key = compactEstilo(item?.estilo);
        if (!key) return;
        const bucket = byCompact.get(key);
        if (bucket) bucket.push(index);
        else byCompact.set(key, [index]);
      });
      return snapshot.length;
    }

    function lookup(query, sazFilter = 'all') {
      const planned = plan(query);
      if (!planned.ready) return [];
      const passesSaz = item => {
        if (sazFilter === 'pending' && item.saz_cargado) return false;
        if (sazFilter === 'loaded' && !item.saz_cargado) return false;
        return true;
      };
      if (planned.mode === 'exact-estilo') {
        const key = compactEstilo(planned.terms[0]);
        return (byCompact.get(key) || [])
          .map(index => ({ item: snapshot[index], index }))
          .filter(row => row.item && passesSaz(row.item));
      }
      return null;
    }

    return { rebuild, lookup, size: () => snapshot.length };
  }

  return {
    LIMITS,
    text,
    normalize,
    compactEstilo,
    estiloKeys,
    looksLikeEstiloToken,
    sameEstilo,
    plan,
    matchesPlannedProduct,
    createLocalIndex,
  };
}));
