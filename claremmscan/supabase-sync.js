'use strict';

(() => {
  const QUEUE_KEY = 'claremmscan-cloud-queue-v1';
  const OWNER_KEY = 'claremmscan-cloud-owner-v1';
  const BUCKET = 'product-images';
  const DEFAULT_BRANCH = 'CLAREMM ZAPATERIA JUAREZ';
  const store = window.ClaremmStore;
  let client = null;
  let user = null;
  let syncing = false;
  let flushTimer = null;
  let branchStockContext = null;
  let branchStockContextPromise = null;
  const relationalImageUrls = new Map();
  const PRODUCT_EDIT_FIELDS = ['precio', 'marca', 'proveedor', 'temporada', 'sublinea', 'departamento', 'clasificacion', 'linea', 'corrida', 'acabado'];
  const PRODUCT_CATALOG_SELECT = 'id,estilo,color,marca,proveedor,temporada,sublinea,departamento,clasificacion,linea,corrida,acabado,precio,source_system,estado,imagen';
  const inventorySearch = () => window.ClaremmInventorySearch;
  let catalogSearchAbort = null;
  const beginCatalogSearch = () => {
    catalogSearchAbort?.abort();
    catalogSearchAbort = typeof AbortController === 'function' ? new AbortController() : null;
    return catalogSearchAbort?.signal || null;
  };
  const withSignal = (queryBuilder, signal) => (signal && typeof queryBuilder.abortSignal === 'function' ? queryBuilder.abortSignal(signal) : queryBuilder);
  const isAbortError = error => error?.name === 'AbortError' || /aborted|AbortError/i.test(String(error?.message || error || ''));
  const plannedSearch = query => inventorySearch()?.plan?.(query) || null;

  const byId = id => document.getElementById(id);
  const emptyQueue = () => ({ upserts: {}, deletes: {}, images: {}, catalog: {}, imageClear: false });
  const loadQueue = () => {
    try { return { ...emptyQueue(), ...JSON.parse(localStorage.getItem(QUEUE_KEY) || '{}') }; }
    catch { return emptyQueue(); }
  };
  const saveQueue = queue => localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  const authRedirectUrl = () => {
    const url = new URL(window.location.href);
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/index\.html$/, '');
    return url.toString();
  };
  const authErrorFromFragment = () => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const code = params.get('error_code');
    if (!code) return '';
    if (code === 'otp_expired') return 'El enlace de confirmación venció o ya fue utilizado. Escribe tu correo y pulsa “Reenviar correo”.';
    return params.get('error_description') || 'No se pudo confirmar el correo. Solicita un enlace nuevo.';
  };
  const initialAuthError = authErrorFromFragment();
  const clearAuthFragment = () => {
    if (!/access_token=|refresh_token=|error_code=|error_description=/.test(window.location.hash)) return;
    window.history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`);
  };
  const chunks = (values, size) => Array.from({ length: Math.ceil(values.length / size) }, (_, i) => values.slice(i * size, (i + 1) * size));
  const catalogText = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase().replace(/\s+/g, ' ');
  const catalogPrice = value => { const raw = String(value ?? '').trim().replace(/[^0-9,.-]/g, ''); if (!raw) return NaN; const comma = raw.lastIndexOf(','), dot = raw.lastIndexOf('.'); const normalized = comma > dot ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, ''); return Number(normalized); };
  const productLookupKey = value => `${catalogText(value?.estilo)}|${catalogText(value?.color)}`;
  const compactEstilo = value => catalogText(value).replace(/\s+/g, '').replace(/^0+(?=\d)/, '');
  const catalogCorrida = value => catalogText(value).replace(/[–—]/g, '-').replace(/\s+/g, '').replace(/(\d+)\.0(?!\d)/g, '$1');
  const matchesStyleCorrida = (product, estilo, corrida) => compactEstilo(product.estilo) === compactEstilo(estilo) && catalogCorrida(product.corrida) === catalogCorrida(corrida);
  const colorTokens = value => catalogText(value).replace(/[\/\-_,+|.]/g, ' ').replace(/\s+/g, ' ').trim();
  const foldedColor = value => {
    const tokens = colorTokens(value);
    if (tokens === 'B N' || tokens === 'BN') return 'BLANCO NEGRO';
    if (tokens === 'N B' || tokens === 'NB') return 'NEGRO BLANCO';
    return tokens.split(' ').filter(Boolean).sort().join(' ');
  };
  const sazCatalog = () => window.ClaremmSazCatalog;
  const sazResolve = (field, value) => sazCatalog()?.resolve?.(field, value) || catalogText(value);
  const colorsMatch = (left, right) => {
    if (sazCatalog()?.matches) return sazCatalog().matches('color', left, right);
    return Boolean(foldedColor(left) && foldedColor(left) === foldedColor(right));
  };
  const isNuevoFicha = (product, totalQuantity = 0) => Boolean(product)
    && !String(product.imagen || '').trim()
    && !(Number(product.precio) > 0)
    && !(Number(totalQuantity) > 0);
  const catalogSazFlags = (context, product, totalQuantity = 0) => {
    const sazRegistered = context.registryByKey.get(productLookupKey(product)) === product.id;
    const sazPreloaded = product.source_system === 'saz_precargado' || /PRECARGADO EN SAZ/i.test(String(product.estado || ''));
    return { sazRegistered, sazPreloaded, isNew: isNuevoFicha(product, totalQuantity) };
  };
  const compactLookupKey = value => `${compactEstilo(value?.estilo)}|${catalogText(value?.color)}`;
  const productLookupKeys = value => {
    const estilos = [...new Set([catalogText(value?.estilo), compactEstilo(value?.estilo)].filter(Boolean))];
    const colors = [...new Set([catalogText(value?.color), colorTokens(value?.color), foldedColor(value?.color), catalogText(sazResolve('color', value?.color))].filter(Boolean))];
    const keys = [];
    for (const estilo of estilos) for (const color of colors) keys.push(`${estilo}|${color}`);
    return keys;
  };
  const catalogScore = product => (
    (Number(product.precio) > 0 ? 1000 : 0) +
    (String(product.imagen || '').trim() ? 400 : 0) +
    (product.source_system === 'saz_registered' ? 220 : 0) +
    (/^0+\d/.test(String(product.estilo || '')) ? 80 : 0) +
    (catalogText(product.marca) && catalogText(product.marca) !== 'NAN' && catalogText(product.marca) !== 'CLAREMM' ? 25 : 0)
  );
  const pickCanonicalProduct = candidates => {
    if (!candidates.length) return null;
    return [...candidates].sort((left, right) => catalogScore(right) - catalogScore(left) || String(left.id).localeCompare(String(right.id)))[0];
  };
  const candidatesFor = (context, row) => {
    const seen = new Set();
    const candidates = [];
    const add = product => {
      if (!product || seen.has(product.id)) return;
      seen.add(product.id);
      candidates.push(product);
    };
    for (const key of productLookupKeys(row)) {
      for (const product of context.productsByKey.get(key) || []) add(product);
    }
    const estilo = compactEstilo(row?.estilo);
    if (estilo) {
      for (const product of context.productsByEstilo?.get(estilo) || []) {
        if (colorsMatch(product.color, row.color)) add(product);
      }
    }
    return candidates;
  };
  const productsOfEstilo = (context, estilo) => context.products.filter(product => product.activo !== false && compactEstilo(product.estilo) === compactEstilo(estilo));
  const imageNamePart = value => catalogText(value).replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  const catalogImageName = value => {
    const estilo = imageNamePart(value?.estilo), color = imageNamePart(value?.color);
    if (!estilo || !color) return '';
    return `${estilo}-${color}.png`;
  };
  const asPngBlob = blob => {
    if (!(blob instanceof Blob)) throw new Error('La imagen debe estar en formato PNG.');
    return blob.type === 'image/png' ? blob : new Blob([blob], { type: 'image/png' });
  };
  const resolveCaptureBranch = (context, sucursal) => {
    const name = catalogText(sucursal || DEFAULT_BRANCH);
    return context.branches.find(branch => catalogText(branch.name) === name)
      || context.branches.find(branch => catalogText(branch.code) === name)
      || context.branches.find(branch => catalogText(branch.code) === 'JUAREZ')
      || context.branches[0];
  };
  const estiloSearchValues = value => inventorySearch()?.estiloKeys?.(value) || [...new Set([catalogText(value), compactEstilo(value)].filter(Boolean))];
  const looksLikeEstilo = value => /\d/.test(catalogText(value));
  const rememberProducts = (context, products) => {
    if (!context.productsByEstilo) context.productsByEstilo = new Map();
    if (!context.queriedEstilos) context.queriedEstilos = new Set();
    for (const product of products || []) {
      const existing = context.productsById.get(product.id);
      if (existing) {
        Object.assign(existing, product);
        continue;
      }
      context.products.push(product);
      context.productsById.set(product.id, product);
      const estiloKey = compactEstilo(product.estilo);
      if (estiloKey) {
        if (!context.productsByEstilo.has(estiloKey)) context.productsByEstilo.set(estiloKey, []);
        context.productsByEstilo.get(estiloKey).push(product);
      }
      for (const key of productLookupKeys(product)) {
        if (!context.productsByKey.has(key)) context.productsByKey.set(key, []);
        context.productsByKey.get(key).push(product);
      }
    }
  };
  const rememberVariants = (context, variants) => {
    for (const variant of variants || []) {
      const list = context.variantsByProduct.get(variant.product_id) || [];
      if (!list.some(item => item.id === variant.id)) list.push({ id: variant.id, product_id: variant.product_id, size: String(variant.size) });
      context.variantsByProduct.set(variant.product_id, list);
    }
  };
  async function queryProductsByEstilo(context, estilo, limit, signal) {
    const planned = plannedSearch(estilo);
    if (planned && !planned.ready) return [];
    const values = planned?.keys?.length ? planned.keys : estiloSearchValues(estilo);
    const cap = Math.min(Number(limit) || planned?.limit || 40, planned?.limit || 40, 40);
    if (!values.length) return [];
    if (!context.queriedEstilos) context.queriedEstilos = new Set();
    if (!context.productsByEstilo) context.productsByEstilo = new Map();
    const compact = compactEstilo(estilo);
    if (compact && context.queriedEstilos?.has(compact)) {
      const keys = new Set(values.map(compactEstilo).filter(Boolean));
      if (/^\d+$/.test(compact)) keys.add(`PI${compact}`);
      const seen = new Set();
      return [...keys].flatMap(key => context.productsByEstilo?.get(key) || []).filter(product => {
        if (seen.has(product.id)) return false;
        seen.add(product.id);
        return true;
      }).slice(0, cap);
    }
    const exact = await withSignal(client.from('products').select(PRODUCT_CATALOG_SELECT)
      .eq('organization_id', context.organization.id)
      .eq('activo', true)
      .in('estilo', values)
      .limit(cap), signal);
    if (exact.error) throw exact.error;
    let rows = exact.data || [];
    if (!rows.length && /^\d+$/.test(compact) && compact.length >= 2) {
      const padded = compact.padStart(Math.max(6, compact.length), '0');
      const prefixed = await withSignal(client.from('products').select(PRODUCT_CATALOG_SELECT)
        .eq('organization_id', context.organization.id)
        .eq('activo', true)
        .or(`estilo.eq.PI${compact},estilo.eq."${padded}"`)
        .limit(cap), signal);
      if (prefixed.error) throw prefixed.error;
      rows = prefixed.data || [];
    }
    if (!rows.length && planned?.allowPrefix && !/^\d+[eE]\d+$/.test(catalogText(estilo))) {
      const prefix = catalogText(estilo);
      const loose = await withSignal(client.from('products').select(PRODUCT_CATALOG_SELECT)
        .eq('organization_id', context.organization.id)
        .eq('activo', true)
        .ilike('estilo', `${prefix}%`)
        .limit(cap), signal);
      if (loose.error) throw loose.error;
      rows = loose.data || [];
    }
    rememberProducts(context, rows);
    if (compact) context.queriedEstilos.add(compact);
    for (const product of rows) {
      const key = compactEstilo(product.estilo);
      if (key) context.queriedEstilos.add(key);
    }
    return rows.slice(0, cap);
  }
  async function queryProductsFallback(context, term, limit = 40, signal) {
    const planned = plannedSearch(term);
    if (planned && (planned.mode === 'exact-estilo' || planned.allowPrefix || !planned.ready)) return [];
    const resolvedColor = sazResolve('color', term);
    const value = catalogText(resolvedColor && catalogText(resolvedColor) !== catalogText(term) ? resolvedColor : term);
    if (!value || looksLikeEstilo(value) || value.length < 3) return [];
    const cap = Math.min(Number(limit) || 40, 40);
    const { data, error } = await withSignal(client.from('products').select(PRODUCT_CATALOG_SELECT)
      .eq('organization_id', context.organization.id)
      .eq('activo', true)
      .or(`color.ilike."${value}%",marca.ilike."${value}%",linea.ilike."${value}%"`)
      .limit(cap), signal);
    if (error) throw error;
    rememberProducts(context, data || []);
    return data || [];
  }
  async function loadVariantsFor(context, productIds, { refresh = false } = {}) {
    if (!context.variantsLoaded) context.variantsLoaded = new Set();
    const ids = [...new Set(productIds || [])].filter(Boolean);
    const needed = refresh ? ids : ids.filter(id => !context.variantsLoaded.has(id));
    if (refresh) for (const id of needed) context.variantsByProduct.delete(id);
    for (const group of chunks(needed, 200)) {
      if (!group.length) continue;
      const { data, error } = await client.from('product_variants').select('id,product_id,size').in('product_id', group);
      if (error) throw error;
      rememberVariants(context, data || []);
      for (const id of group) context.variantsLoaded.add(id);
    }
  }
  async function stockTotalsByProduct(context, productIds) {
    await loadVariantsFor(context, productIds);
    const totals = new Map((productIds || []).map(id => [id, 0]));
    const variantToProduct = new Map();
    for (const productId of productIds || []) {
      for (const variant of context.variantsByProduct.get(productId) || []) variantToProduct.set(variant.id, productId);
    }
    const variantIds = [...variantToProduct.keys()];
    for (const group of chunks(variantIds, 200)) {
      if (!group.length) continue;
      const { data, error } = await client.from('inventory_levels').select('variant_id,quantity').in('variant_id', group).gt('quantity', 0);
      if (error) throw error;
      for (const row of data || []) {
        const productId = variantToProduct.get(row.variant_id);
        if (!productId) continue;
        totals.set(productId, (totals.get(productId) || 0) + Number(row.quantity || 0));
      }
    }
    return totals;
  }
  async function findCatalogProducts(context, query, scope = 'all', limit, signal) {
    await sazCatalog()?.ready;
    const planned = plannedSearch(query);
    if (planned && !planned.ready) return [];
    const terms = planned?.terms?.length ? planned.terms : catalogText(query).split(' ').filter(Boolean);
    if (!terms.length) return [];
    const cap = Math.min(Number(limit) || planned?.limit || 40, planned?.limit || 40, 40);
    let products = await queryProductsByEstilo(context, terms[0], cap, signal);
    if (!products.length && scope !== 'style' && planned?.mode === 'text') products = await queryProductsFallback(context, terms[0], cap, signal);
    const matcher = inventorySearch()?.matchesPlannedProduct;
    return products.filter(product => {
      if (matcher && planned) return matcher(product, planned) || (scope !== 'style' && planned.mode === 'text' && (colorsMatch(product.color, terms[0]) || sazCatalog()?.matches?.('marca', product.marca, terms[0])));
      const compactProduct = compactEstilo(product.estilo);
      return terms.every(term => compactEstilo(term) && compactProduct === compactEstilo(term));
    }).slice(0, cap);
  }
  async function ensureProductById(context, productId) {
    if (!productId) return null;
    if (context.productsById.has(productId)) return context.productsById.get(productId);
    const { data, error } = await client.from('products').select(PRODUCT_CATALOG_SELECT).eq('id', productId).maybeSingle();
    if (error) throw error;
    if (data) rememberProducts(context, [data]);
    return data || null;
  }
  async function ensureNuevoLeonBranch(organization, branches) {
    const list = branches || [];
    if (list.some(branch => catalogText(branch.code) === 'NUEVO_LEON' || catalogText(branch.name).includes('NUEVO LEON'))) return list;
    const { data, error } = await client.from('branches').upsert({
      organization_id: organization.id,
      code: 'NUEVO_LEON',
      name: 'Zapateria CLAREMM Nuevo Leon',
      active: true,
    }, { onConflict: 'organization_id,code' }).select('id,code,name,active').maybeSingle();
    if (error || !data) return list;
    return [...list, data].sort((left, right) => catalogText(left.name).localeCompare(catalogText(right.name)));
  }
  const setCloudStatus = (message, kind = '') => {
    const el = byId('cloudStatus');
    if (!el) return;
    el.textContent = message;
    el.className = kind;
  };
  const cloudErrorMessage = error => {
    const code = String(error?.code || '');
    const message = String(error?.message || error || 'Error desconocido');
    if (code === 'PGRST204' || /(?:marca|sucursal|saz_cargado|origen).*column|column.*(?:marca|sucursal|saz_cargado|origen)/i.test(message)) {
      return 'Falta actualizar las columnas de inventario en Supabase. Ejecuta supabase/saz-status-migration.sql en el SQL Editor; no borrará ni mezclará tus registros.';
    }
    if (code === 'PGRST205' || code === '42P01' || message.includes('inventory_items')) {
      return 'Falta crear la tabla de inventario. Ejecuta supabase/schema.sql en el SQL Editor de Supabase.';
    }
    if (message.toLowerCase().includes('bucket') && message.toLowerCase().includes('not found')) {
      return 'Falta crear el almacén de imágenes. Ejecuta supabase/schema.sql en el SQL Editor de Supabase.';
    }
    if (/rate limit|too many requests|email rate/i.test(message)) {
      return 'Supabase limitó temporalmente los correos. Espera unos minutos antes de volver a intentarlo.';
    }
    return message;
  };
  const recordKey = item => store.itemSyncKey(item);
  const toRow = item => ({
    user_id: user.id,
    item_key: recordKey(item),
    sucursal: String(item.sucursal || DEFAULT_BRANCH).toUpperCase() === 'MATRIZ' ? DEFAULT_BRANCH : String(item.sucursal || DEFAULT_BRANCH),
    estilo: String(item.estilo || ''),
    marca: String(item.marca || ''),
    color: String(item.color || ''),
    linea: String(item.linea || ''),
    talla: String(item.talla || ''),
    cantidad: Math.max(1, Number(item.cantidad) || 1),
    material: String(item.material || ''),
    precio: String(item.precio || ''),
    notas: String(item.notas || ''),
    saz_cargado: item.saz_cargado === true,
    saz_cargado_at: item.saz_cargado && item.saz_cargado_at ? item.saz_cargado_at : null,
    origen: String(item.origen || 'app_capture'),
    updated_at: new Date().toISOString(),
  });
  const fromRow = row => ({
    estilo: row.estilo || '', marca: row.marca || '', sucursal: String(row.sucursal || DEFAULT_BRANCH).toUpperCase() === 'MATRIZ' ? DEFAULT_BRANCH : String(row.sucursal || DEFAULT_BRANCH), color: row.color || '', linea: row.linea || '', talla: row.talla || '',
    cantidad: String(row.cantidad || 1), material: row.material || '', precio: row.precio || '', notas: row.notas || '',
    saz_cargado: row.saz_cargado === true, saz_cargado_at: row.saz_cargado_at || '', origen: row.origen || 'supabase_legacy',
  });

  function updateAuthUi() {
    byId('cloudSignedOut').hidden = !!user;
    byId('cloudSignedIn').hidden = !user;
    byId('cloudUser').textContent = user?.email || '';
    byId('cloudSync').disabled = !user || syncing;
    byId('cloudLogout').disabled = !user;
    document.dispatchEvent(new CustomEvent('claremm-cloud-session', { detail: { signedIn: !!user } }));
  }

  async function pagedQuery(createQuery) {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await createQuery().range(from, from + 999);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < 1000) return rows;
    }
  }

  async function loadBranchStockContextNow() {
    const { data: memberships, error: membershipError } = await client.from('organization_members').select('organization_id,is_default').eq('user_id', user.id);
    if (membershipError) throw membershipError;
    const organizationIds = (memberships || []).map(row => row.organization_id);
    if (!organizationIds.length) throw new Error('Tu cuenta no pertenece a la organización CLAREMM.');
    const { data: organizations, error: organizationError } = await client.from('organizations').select('id,name').in('id', organizationIds);
    if (organizationError) throw organizationError;
    const preferredId = memberships.find(row => row.is_default)?.organization_id;
    const organization = (organizations || []).find(row => catalogText(row.name) === 'CLAREMM')
      || (organizations || []).find(row => row.id === preferredId)
      || organizations?.[0];
    if (!organization) throw new Error('No se encontró la organización CLAREMM.');
    const [{ data: branches, error: branchError }, registry] = await Promise.all([
      client.from('branches').select('id,code,name,active').eq('organization_id', organization.id).eq('active', true).order('name'),
      pagedQuery(() => client.from('saz_product_registry').select('product_id,lookup_key').eq('organization_id', organization.id)),
    ]);
    if (branchError) throw branchError;
    const nextBranches = await ensureNuevoLeonBranch(organization, branches || []);
    const previous = branchStockContext?.userId === user.id ? branchStockContext : null;
    const registryByKey = new Map();
    for (const row of registry) {
      const exact = catalogText(row.lookup_key);
      registryByKey.set(exact, row.product_id);
      const [estilo, color = ''] = exact.split('|');
      const compact = `${compactEstilo(estilo)}|${catalogText(color)}`;
      if (!registryByKey.has(compact)) registryByKey.set(compact, row.product_id);
    }
    const productsByEstilo = previous?.productsByEstilo || new Map();
    if (!previous?.productsByEstilo && previous?.products?.length) {
      for (const product of previous.products) {
        const estiloKey = compactEstilo(product.estilo);
        if (!estiloKey) continue;
        if (!productsByEstilo.has(estiloKey)) productsByEstilo.set(estiloKey, []);
        productsByEstilo.get(estiloKey).push(product);
      }
    }
    branchStockContext = {
      userId: user.id, organization, branches: nextBranches, products: previous?.products || [],
      productsById: previous?.productsById || new Map(), productsByKey: previous?.productsByKey || new Map(),
      productsByEstilo, queriedEstilos: previous?.queriedEstilos || new Set(),
      registryByKey, variantsByProduct: previous?.variantsByProduct || new Map(),
      variantsLoaded: previous?.variantsLoaded || new Set(),
    };
    return branchStockContext;
  }

  async function loadBranchStockContext(force = false) {
    if (!client || !user) throw new Error('Inicia sesión para consultar el catálogo por sucursal.');
    if (!force && branchStockContext?.userId === user.id) return branchStockContext;
    if (branchStockContextPromise) {
      const pending = await branchStockContextPromise;
      if (!force && pending?.userId === user.id) return pending;
    }
    branchStockContextPromise = loadBranchStockContextNow();
    try {
      return await branchStockContextPromise;
    } finally {
      branchStockContextPromise = null;
    }
  }

  function resolveCatalogProduct(context, row) {
    if (row?.productId && context.productsById.has(row.productId)) return { product: context.productsById.get(row.productId), reason: '', siblings: productsOfEstilo(context, row.estilo) };
    const candidates = candidatesFor(context, row);
    const siblings = productsOfEstilo(context, row.estilo);
    const registeredId = productLookupKeys(row).map(key => context.registryByKey.get(key)).find(id => id && context.productsById.has(id));
    if (registeredId) return { product: context.productsById.get(registeredId), reason: '', siblings };
    const product = pickCanonicalProduct(candidates);
    if (product) return { product, reason: '', siblings };
    const similar = [...new Set(siblings.map(item => item.color).filter(Boolean))].slice(0, 6);
    const reason = siblings.length
      ? `El estilo ${catalogText(row.estilo)} sí existe (${similar.join(', ') || 'otros colores'}). No hay ficha con color ${catalogText(row.color)}.`
      : 'No existe este estilo y color en el catálogo.';
    return { product: null, reason, siblings };
  }

  async function searchBranchCatalog(query) {
    const planned = plannedSearch(query);
    if (planned && !planned.ready) return [];
    const context = await loadBranchStockContext();
    const products = await findCatalogProducts(context, query, 'all', planned?.limit || 40);
    const productIds = products.map(product => product.id);
    await loadVariantsFor(context, productIds);
    const totals = await stockTotalsByProduct(context, productIds);
    return products.map(product => ({
      ...product,
      sizes: (context.variantsByProduct.get(product.id) || []).map(variant => variant.size),
      totalQuantity: totals.get(product.id) || 0,
      ...catalogSazFlags(context, product, totals.get(product.id) || 0),
    }));
  }

  async function signedRelationalImage(path, refresh = false) {
    if (!path) return '';
    if (!refresh && relationalImageUrls.has(path)) return relationalImageUrls.get(path);
    const { data, error } = await client.storage.from(BUCKET).createSignedUrl(path, 3600);
    if (error) throw error;
    const url = data?.signedUrl || '';
    relationalImageUrls.set(path, url);
    return url;
  }

  const sizeKeyOf = value => {
    const number = Number(String(value ?? '').trim().replace(',', '.'));
    return Number.isFinite(number) ? number.toFixed(1) : '';
  };

  function mergeBranchStocks(left, right) {
    const byId = new Map();
    for (const stock of [...(left || []), ...(right || [])]) {
      const id = stock?.branch?.id || stock?.branch?.code || stock?.branch?.name;
      if (!id) continue;
      const current = byId.get(id);
      if (!current) {
        byId.set(id, {
          branch: stock.branch,
          sizes: [...(stock.sizes || [])].map(item => ({ size: sizeKeyOf(item.size) || String(item.size || ''), quantity: Math.trunc(Number(item.quantity) || 0) })).filter(item => item.size && item.quantity > 0),
          totalQuantity: Number(stock.totalQuantity || 0),
        });
        continue;
      }
      const qty = new Map(current.sizes.map(item => [item.size, item.quantity]));
      for (const item of stock.sizes || []) {
        const size = sizeKeyOf(item.size) || String(item.size || '');
        const quantity = Math.trunc(Number(item.quantity) || 0);
        if (!size || quantity <= 0) continue;
        qty.set(size, (qty.get(size) || 0) + quantity);
      }
      current.sizes = [...qty.entries()].map(([size, quantity]) => ({ size, quantity })).sort((a, b) => Number(a.size) - Number(b.size));
      current.totalQuantity = current.sizes.reduce((sum, item) => sum + item.quantity, 0);
    }
    return [...byId.values()];
  }

  function mergeDuplicateSearchResults(results) {
    const byKey = new Map();
    for (const result of results || []) {
      const key = compactLookupKey(result.product);
      const current = byKey.get(key);
      if (!current) {
        byKey.set(key, {
          ...result,
          branchStocks: mergeBranchStocks(result.branchStocks, []),
          sizes: [...(result.sizes || [])],
        });
        continue;
      }
      current.product = pickCanonicalProduct([current.product, result.product]);
      current.branchStocks = mergeBranchStocks(current.branchStocks, result.branchStocks);
      current.sizes = current.branchStocks.flatMap(stock => (stock.sizes || []).map(item => ({
        ...item,
        branch: stock.branch?.name,
        branchCode: stock.branch?.code,
      })));
      current.totalQuantity = current.branchStocks.reduce((sum, stock) => sum + Number(stock.totalQuantity || 0), 0);
      current.branch = current.branchStocks.find(stock => stock.totalQuantity > 0)?.branch || current.branch;
      current.imageUrl = current.imageUrl || result.imageUrl;
      current.sazRegistered = Boolean(current.sazRegistered || result.sazRegistered);
      current.sazPreloaded = Boolean(current.sazPreloaded || result.sazPreloaded);
      current.notice = 'Misma ficha unida: estilo + color. Las tallas se suman; si no existía, se agrega.';
    }
    return [...byKey.values()];
  }

  async function searchRelationalInventory(query, scope = 'all', sazFilter = 'all', options = {}) {
    const planned = plannedSearch(query);
    if (planned && !planned.ready) return [];
    const signal = beginCatalogSearch();
    try {
    const context = await loadBranchStockContext();
    const includeEmpty = options.includeEmpty !== false;
    const found = await findCatalogProducts(context, query, scope, planned?.limit || 40, signal);
    const products = found.filter(product => {
      const registered = context.registryByKey.get(productLookupKey(product)) === product.id;
      const preloaded = product.source_system === 'saz_precargado' || /PRECARGADO EN SAZ/i.test(String(product.estado || ''));
      const sinImagen = !String(product.imagen || '').trim();
      const sinPrecio = !(Number(product.precio) > 0);
      if (sazFilter === 'loaded') return registered;
      if (sazFilter === 'pending') return !registered && !preloaded;
      if (sazFilter === 'prep') return !registered && !preloaded && (sinImagen || sinPrecio);
      return true;
    });
    await loadVariantsFor(context, products.map(product => product.id));
    const variantIds = products.flatMap(product => (context.variantsByProduct.get(product.id) || []).map(variant => variant.id));
    const levels = [];
    for (const group of chunks(variantIds, 200)) {
      if (!group.length) continue;
      const { data, error } = await client.from('inventory_levels').select('branch_id,variant_id,quantity').in('variant_id', group).gt('quantity', 0);
      if (error) throw error;
      levels.push(...(data || []));
    }
    const productByVariant = new Map(), variantById = new Map();
    for (const product of products) for (const variant of context.variantsByProduct.get(product.id) || []) {
      productByVariant.set(variant.id, product);
      variantById.set(variant.id, variant);
    }
    const branchById = new Map(context.branches.map(branch => [branch.id, branch]));
    const grouped = new Map(products.map(product => [product.id, { product, stocks: new Map(), totalQuantity: 0 }]));
    for (const level of levels) {
      const product = productByVariant.get(level.variant_id), variant = variantById.get(level.variant_id), branch = branchById.get(level.branch_id);
      if (!product || !variant || !branch) continue;
      const result = grouped.get(product.id);
      if (!result) continue;
      if (!result.stocks.has(branch.id)) result.stocks.set(branch.id, { branch, sizes: [], totalQuantity: 0 });
      const stock = result.stocks.get(branch.id), quantity = Number(level.quantity || 0);
      stock.sizes.push({ size: variant.size, quantity });
      stock.totalQuantity += quantity;
      result.totalQuantity += quantity;
    }
    const juarez = context.branches.find(branch => catalogText(branch.code) === 'JUAREZ') || context.branches[0];
    const mapped = [...grouped.values()]
      .filter(result => includeEmpty || result.totalQuantity > 0)
      .map(result => {
        const branchStocks = context.branches.map(branch => {
          const stock = result.stocks.get(branch.id);
          return {
            branch,
            sizes: [...(stock?.sizes || [])].sort((a, b) => Number(a.size) - Number(b.size)),
            totalQuantity: stock?.totalQuantity || 0,
          };
        });
        const juarezStock = branchStocks.find(item => catalogText(item.branch.code) === 'JUAREZ');
        const branch = sazFilter === 'prep'
          ? (juarez || juarezStock?.branch || context.branches[0])
          : (branchStocks.find(item => item.totalQuantity > 0)?.branch || juarez || context.branches[0]);
        const sizes = sazFilter === 'prep'
          ? (juarezStock?.sizes || []).map(size => ({ ...size, branch: juarez?.name || 'JUAREZ', branchCode: 'JUAREZ' }))
          : branchStocks.flatMap(item => item.sizes.map(size => ({ ...size, branch: item.branch.name, branchCode: item.branch.code })));
        return {
          product: result.product,
          branch,
          branchStocks: sazFilter === 'prep' ? branchStocks.filter(item => catalogText(item.branch.code) === 'JUAREZ') : branchStocks,
          sizes,
          totalQuantity: sazFilter === 'prep' ? (juarezStock?.totalQuantity || 0) : result.totalQuantity,
          ...catalogSazFlags(context, result.product, result.totalQuantity),
          imageUrl: result.product.imagen ? relationalImageUrls.get(result.product.imagen) || '' : '',
        };
      });
    return mergeDuplicateSearchResults(mapped)
      .sort((a, b) => catalogText(`${a.product.estilo}|${a.product.color}`).localeCompare(catalogText(`${b.product.estilo}|${b.product.color}`)));
    } catch (error) {
      if (isAbortError(error)) {
        error.aborted = true;
        throw error;
      }
      throw error;
    }
  }

  async function hydrateRelationalImages(results) {
    const paths = [...new Set((results || []).map(result => result.product?.imagen).filter(Boolean))];
    const missing = paths.filter(path => !relationalImageUrls.has(path));
    if (missing.length) {
      try {
        const { data, error } = await client.storage.from(BUCKET).createSignedUrls(missing, 3600);
        if (error) throw error;
        for (const item of data || []) {
          if (item?.path && item.signedUrl) relationalImageUrls.set(item.path, item.signedUrl);
        }
      } catch {
        await Promise.all(missing.map(path => signedRelationalImage(path).catch(() => '')));
      }
    }
    return (results || []).map(result => ({
      ...result,
      imageUrl: result.product?.imagen ? relationalImageUrls.get(result.product.imagen) || result.imageUrl || '' : '',
    }));
  }

  async function addRelationalStock({ context, productId, branchId, size, quantity, reason, importKey }) {
    const qty = Math.trunc(Number(quantity));
    const nextSize = String(size ?? '').trim().replace(',', '.');
    if (!Number.isInteger(qty) || qty < 1) throw new Error('La cantidad debe ser un entero de al menos 1.');
    if (!Number.isFinite(Number(nextSize)) || Number(nextSize) <= 0) throw new Error('Escribe una talla válida.');
    let variant = (context.variantsByProduct.get(productId) || []).find(item => catalogText(item.size) === catalogText(nextSize));
    if (!variant) {
      const { data, error } = await client.from('product_variants').upsert(
        { product_id: productId, size: nextSize },
        { onConflict: 'product_id,size' }
      ).select('id,size').single();
      if (error) throw error;
      variant = data;
      const list = context.variantsByProduct.get(productId) || [];
      list.push({ id: variant.id, product_id: productId, size: String(variant.size) });
      context.variantsByProduct.set(productId, list);
    }
    const { data: level, error: readError } = await client.from('inventory_levels').select('quantity').eq('branch_id', branchId).eq('variant_id', variant.id).maybeSingle();
    if (readError) throw readError;
    const previous = Number(level?.quantity || 0), next = previous + qty;
    const { error: levelError } = await client.from('inventory_levels').upsert({
      branch_id: branchId, variant_id: variant.id, quantity: next, updated_by: user.id,
    }, { onConflict: 'branch_id,variant_id' });
    if (levelError) throw levelError;
    const { error: movementError } = await client.from('inventory_movements_relational').insert({
      organization_id: context.organization.id,
      branch_id: branchId,
      variant_id: variant.id,
      operation: 'add',
      previous_quantity: previous,
      quantity: qty,
      new_quantity: next,
      reason: reason || 'Entrada de inventario',
      import_key: importKey || `add:${productId}:${variant.id}:${Date.now()}`,
      created_by: user.id,
    });
    if (movementError && !/duplicate|unique/i.test(String(movementError.message || movementError.code || ''))) throw movementError;
    return { added: qty, size: nextSize, quantity: next, variantId: variant.id };
  }

  async function uploadRelationalProductImage({ productId, blob }) {
    if (!client || !user) throw new Error('Inicia sesión antes de guardar una imagen.');
    const png = asPngBlob(blob);
    if (png.size > 100 * 1024) throw new Error('La imagen supera el límite de 100 KB.');
    const context = await loadBranchStockContext();
    const product = await ensureProductById(context, productId);
    if (!product) throw new Error('No se encontró el producto en el catálogo relacional.');
    const fileName = catalogImageName(product);
    if (!fileName) throw new Error('La foto debe nombrarse con estilo y color. Completa ambos datos de la ficha.');
    const ofStyle = await queryProductsByEstilo(context, product.estilo, 200);
    const matchingProducts = ofStyle.filter(item => productLookupKey(item) === productLookupKey(product));
    const path = `${context.organization.id}/products/${fileName}`;
    const { error: uploadError } = await client.storage.from(BUCKET).upload(path, png, { contentType: 'image/png', upsert: true, cacheControl: '60' });
    if (uploadError) throw uploadError;
    for (const group of chunks(matchingProducts.map(item => item.id), 200)) {
      const { error: productError } = await client.from('products').update({ imagen: path }).eq('organization_id', context.organization.id).in('id', group);
      if (productError) throw productError;
    }
    for (const item of matchingProducts) item.imagen = path;
    await store.putImageFromCloud(fileName, png).catch(() => {});
    relationalImageUrls.delete(path);
    const signedUrl = await signedRelationalImage(path, true);
    return { path, fileName, imageUrl: `${signedUrl}${signedUrl.includes('?') ? '&' : '?'}v=${Date.now()}`, size: png.size };
  }

  async function removeRelationalProductImage({ estilo, color }) {
    const context = await loadBranchStockContext();
    const ofStyle = await queryProductsByEstilo(context, estilo, 200);
    const matchingProducts = ofStyle.filter(product => productLookupKey(product) === productLookupKey({ estilo, color }));
    if (!matchingProducts.length) return { removed: 0 };
    const organizationPrefix = `${context.organization.id}/products/`;
    const paths = [...new Set(matchingProducts.map(product => product.imagen).filter(path => path?.startsWith(organizationPrefix)))];
    for (const group of chunks(matchingProducts.map(product => product.id), 200)) {
      const { error } = await client.from('products').update({ imagen: '' }).eq('organization_id', context.organization.id).in('id', group);
      if (error) throw error;
    }
    if (paths.length) {
      const { error } = await client.storage.from(BUCKET).remove(paths);
      if (error) throw error;
    }
    for (const product of matchingProducts) product.imagen = '';
    for (const path of paths) relationalImageUrls.delete(path);
    return { removed: matchingProducts.length };
  }

  async function updateRelationalStylePrice(estilo, precio, corrida) {
    if (!client || !user) throw new Error('Inicia sesión antes de actualizar precios.');
    const value = catalogPrice(precio);
    if (!Number.isFinite(value) || value < 0) throw new Error('Escribe un precio válido.');
    const context = await loadBranchStockContext();
    const ofStyle = await queryProductsByEstilo(context, estilo, 500);
    let matchingProducts = ofStyle.filter(product => matchesStyleCorrida(product, estilo, corrida));
    if (!catalogCorrida(corrida)) {
      const runs = new Set(ofStyle.map(product => catalogCorrida(product.corrida)));
      if (runs.size === 1) matchingProducts = ofStyle;
      else throw new Error('El precio solo se actualiza si coinciden estilo y corrida. Esta búsqueda tiene más de una corrida.');
    }
    if (!matchingProducts.length) throw new Error('No hay fichas con ese estilo y corrida.');
    for (const group of chunks(matchingProducts.map(product => product.id), 200)) {
      if (!group.length) continue;
      const { error } = await client.from('products').update({ precio: value }).eq('organization_id', context.organization.id).in('id', group);
      if (error) throw error;
    }
    for (const product of matchingProducts) product.precio = value;
    return { updated: matchingProducts.length, precio: value, estilo, corrida: matchingProducts[0]?.corrida || corrida || '' };
  }

  async function updateRelationalProductField({ productId, field, value }) {
    if (!client || !user) throw new Error('Inicia sesión antes de editar la ficha.');
    if (!PRODUCT_EDIT_FIELDS.includes(field)) throw new Error('Ese dato no se edita desde la ficha.');
    const context = await loadBranchStockContext();
    const product = await ensureProductById(context, productId);
    if (!product) throw new Error('No se encontró el producto en el catálogo relacional.');
    if (field === 'precio') return updateRelationalStylePrice(product.estilo, value, product.corrida);
    const next = sazCatalog()?.resolve?.(field, value) || String(value ?? '').trim();
    const { error } = await client.from('products').update({ [field]: next }).eq('id', productId).eq('organization_id', context.organization.id);
    if (error) throw error;
    product[field] = next;
    return { updated: 1, field, value: next, estilo: product.estilo };
  }

  async function duplicateRelationalProduct({ productId, color, precio, corrida, size, quantity, blob }) {
    if (!client || !user) throw new Error('Inicia sesión antes de duplicar una ficha.');
    const context = await loadBranchStockContext();
    const source = await ensureProductById(context, productId);
    if (!source) throw new Error('No se encontró la ficha original.');
    const nextColor = sazResolve('color', color);
    const nextCorrida = String(corrida ?? '').trim();
    const nextSize = String(size ?? '').trim().replace(',', '.');
    const qty = Math.trunc(Number(quantity));
    const value = catalogPrice(precio);
    if (!nextColor) throw new Error('Escribe el color de la nueva ficha.');
    if (catalogText(source.color) === nextColor) throw new Error('Cambia el color. Ese estilo y color ya está en esta ficha.');
    if (!nextCorrida) throw new Error('Escribe la corrida a la que va a pertenecer.');
    if (!Number.isFinite(Number(nextSize)) || Number(nextSize) <= 0) throw new Error('Escribe una talla válida.');
    if (!Number.isInteger(qty) || qty < 1) throw new Error('La cantidad debe ser un entero de al menos 1.');
    if (!Number.isFinite(value) || value < 0) throw new Error('Escribe un precio válido. Si es otra corrida, ajústalo aquí.');
    const ofStyle = await queryProductsByEstilo(context, source.estilo, 200);
    const existing = ofStyle.find(product => colorsMatch(product.color, nextColor) || compactLookupKey(product) === `${compactEstilo(source.estilo)}|${nextColor}`);
    if (existing) throw new Error(`Ya existe ${source.estilo} · ${existing.color}. Abre esa ficha en lugar de duplicar.`);
    const juarez = context.branches.find(branch => catalogText(branch.code) === 'JUAREZ') || context.branches[0];
    if (!juarez) throw new Error('No se encontró la sucursal JUÁREZ para guardar la talla.');
    const payload = {
      organization_id: context.organization.id,
      source_system: 'ficha_duplicate',
      source_id: `${catalogText(source.estilo)}|${nextColor}|${Date.now()}`,
      match_key: [source.estilo, nextColor, source.marca].map(catalogText).join('|'),
      estilo: catalogText(source.estilo),
      color: nextColor,
      precio: value,
      marca: source.marca || '',
      proveedor: source.proveedor || '',
      temporada: source.temporada || '',
      sublinea: source.sublinea || '',
      departamento: source.departamento || '',
      clasificacion: source.clasificacion || '',
      linea: source.linea || '',
      corrida: nextCorrida,
      acabado: source.acabado || '',
      activo: true,
      imagen: '',
    };
    const { data: created, error: createError } = await client.from('products').insert(payload).select(PRODUCT_CATALOG_SELECT).single();
    if (createError) throw createError;
    rememberProducts(context, [created]);
    const added = await addRelationalStock({
      context,
      productId: created.id,
      branchId: juarez.id,
      size: nextSize,
      quantity: qty,
      reason: `Ficha duplicada desde ${source.estilo} · ${source.color}`,
      importKey: `ficha-duplicate:${created.id}:${nextSize}:${Date.now()}`,
    });
    let priced = { updated: 1, precio: value, corrida: nextCorrida };
    try {
      priced = await updateRelationalStylePrice(created.estilo, value, nextCorrida);
    } catch (error) {
      priced = { updated: 1, precio: value, corrida: nextCorrida, warning: error.message };
    }
    const fileName = catalogImageName({ estilo: created.estilo, color: nextColor });
    let imageUrl = '', imageMessage = fileName
      ? `Sin foto todavía. Se guardará como ${fileName}.`
      : 'Sin imagen. Toma o elige una foto de este color.';
    if (blob) {
      try {
        const savedImage = await uploadRelationalProductImage({ productId: created.id, blob });
        imageUrl = savedImage.imageUrl;
        imageMessage = `Imagen ${savedImage.fileName} · ${(savedImage.size / 1024).toFixed(1)} KB`;
      } catch (error) {
        imageMessage = `Ficha guardada, pero la foto no se subió: ${error.message}`;
      }
    }
    const product = context.productsById.get(created.id) || { ...created, precio: priced.precio, corrida: nextCorrida };
    return {
      product,
      branch: juarez,
      sizes: [{ size: added.size, quantity: added.quantity }],
      totalQuantity: added.quantity,
      ...catalogSazFlags(context, product, added.quantity),
      fileName: catalogImageName(product) || fileName,
      imageUrl,
      imageMessage,
      notice: catalogCorrida(nextCorrida) === catalogCorrida(source.corrida)
        ? `Ficha duplicada. El precio se aplicó a ${priced.updated} color(es) de ${product.estilo} corrida ${nextCorrida}.`
        : `Ficha duplicada en corrida ${nextCorrida}. El precio quedó en este grupo de estilo y corrida.`,
    };
  }

  async function syncCaptureToCatalog(item) {
    if (!client || !user) return null;
    const estilo = catalogText(item?.estilo), color = sazResolve('color', item?.color);
    if (!estilo || !color) return null;
    const qty = Math.trunc(Number(item.cantidad));
    const size = String(item.talla || '').trim().replace(',', '.');
    let context = await loadBranchStockContext();
    if (estilo) await findCatalogProducts(context, `${estilo} ${color}`.trim(), 'all', 40);
    let product = resolveCatalogProduct(context, { ...item, color }).product;
    if (!product) {
      const payload = {
        organization_id: context.organization.id,
        source_system: 'app_capture',
        source_id: `${estilo}|${color}`,
        match_key: [estilo, color, catalogText(item.marca)].join('|'),
        estilo,
        color,
        precio: Math.max(0, catalogPrice(item.precio) || 0),
        marca: sazResolve('marca', item.marca),
        linea: sazResolve('linea', item.linea) || catalogText(item.linea),
        corrida: sazCatalog()?.resolve?.('corrida', item.corrida) || String(item.corrida || '').trim(),
        acabado: sazResolve('acabado', item.material || item.acabado),
        temporada: catalogText(item.temporada) || sazCatalog()?.DEFAULT_TEMPORADA || '',
        departamento: sazResolve('departamento', item.departamento) || 'CALZADO',
        observaciones: String(item.notas || ''),
        activo: true,
        imagen: '',
      };
      const { data, error } = await client.from('products').upsert(payload, { onConflict: 'organization_id,source_system,source_id' }).select(PRODUCT_CATALOG_SELECT).single();
      if (error) throw error;
      rememberProducts(context, [data]);
      product = context.productsById.get(data.id) || data;
    } else {
      const patch = {};
      if (!(Number(product.precio) > 0) && catalogPrice(item.precio) > 0) patch.precio = catalogPrice(item.precio);
      if (!catalogText(product.marca) && catalogText(item.marca)) patch.marca = sazResolve('marca', item.marca);
      if (!catalogText(product.linea) && catalogText(item.linea)) patch.linea = sazResolve('linea', item.linea) || catalogText(item.linea);
      if (!catalogText(product.acabado) && catalogText(item.material || item.acabado)) patch.acabado = sazResolve('acabado', item.material || item.acabado);
      if (!catalogCorrida(product.corrida) && String(item.corrida || '').trim()) patch.corrida = String(item.corrida).trim();
      if (Object.keys(patch).length) {
        const { error } = await client.from('products').update(patch).eq('id', product.id).eq('organization_id', context.organization.id);
        if (error) throw error;
        Object.assign(product, patch);
      }
    }
    const branch = resolveCaptureBranch(context, item.sucursal);
    if (!branch) throw new Error('No se encontró la sucursal para guardar la captura.');
    let sizes = [], totalQuantity = 0;
    if (Number.isFinite(Number(size)) && Number(size) > 0 && Number.isInteger(qty) && qty > 0) {
      const added = await addRelationalStock({
        context,
        productId: product.id,
        branchId: branch.id,
        size,
        quantity: qty,
        reason: `Captura scanner · ${estilo} · ${color}`,
        importKey: `app-capture:${product.id}:${size}:${Date.now()}`,
      });
      sizes = [{ size: added.size, quantity: added.quantity }];
      totalQuantity = added.quantity;
    }
    const fileName = catalogImageName(product);
    let imageUrl = '', imageMessage = fileName ? `La foto de este color se guarda como ${fileName}.` : '';
    if (fileName) {
      const localBlob = await store.getProductImage(fileName).catch(() => null);
      if (localBlob && !product.imagen) {
        const savedImage = await uploadRelationalProductImage({ productId: product.id, blob: localBlob });
        imageUrl = savedImage.imageUrl;
        imageMessage = `Imagen ${savedImage.fileName}`;
        product.imagen = savedImage.path;
      }
    }
    return {
      product,
      branch,
      sizes,
      totalQuantity,
      ...catalogSazFlags(context, product, totalQuantity),
      fileName,
      imageUrl,
      imageMessage,
      notice: `Captura lista en ${product.estilo} · ${product.color}.`,
    };
  }

  async function getRelationalStylePrice(estilo, corrida, color) {
    const context = await loadBranchStockContext();
    const ofStyleAll = await queryProductsByEstilo(context, estilo, 500);
    let run = corrida;
    if (!catalogCorrida(run) && color) {
      const hit = ofStyleAll.find(product => colorsMatch(product.color, color) || catalogText(product.color) === catalogText(color));
      run = hit?.corrida || '';
    }
    if (!catalogCorrida(run)) {
      const ofStyle = ofStyleAll.filter(product => Number(product.precio) > 0);
      const runs = new Set(ofStyle.map(product => catalogCorrida(product.corrida)));
      if (runs.size !== 1) return '';
      run = ofStyle[0]?.corrida || '';
    }
    const prices = ofStyleAll.filter(product => matchesStyleCorrida(product, estilo, run)).map(product => Number(product.precio)).filter(price => Number.isFinite(price) && price > 0);
    if (!prices.length) return '';
    const frequency = new Map();
    for (const price of prices) frequency.set(price, (frequency.get(price) || 0) + 1);
    return String([...frequency].sort((a, b) => b[1] - a[1])[0][0]);
  }

  async function validateBranchStockRows(rows) {
    const context = await loadBranchStockContext();
    const estilos = [...new Set((rows || []).map(row => catalogText(row.estilo)).filter(Boolean))];
    for (const estilo of estilos) await queryProductsByEstilo(context, estilo, 500);
    const known = [], unknown = [];
    for (const row of rows || []) {
      const resolved = resolveCatalogProduct(context, row);
      if (resolved.product) {
        known.push({ ...row, productId: resolved.product.id, product: resolved.product, estiloExists: true });
        continue;
      }
      const missing = ['marca', 'linea', 'material'].filter(field => !catalogText(row[field]));
      const estiloExists = Boolean(resolved.siblings?.length);
      const template = estiloExists ? pickCanonicalProduct(resolved.siblings) : null;
      const canCreate = !candidatesFor(context, row).length;
      const ready = canCreate && (estiloExists || (!missing.length && row.createProduct === true));
      unknown.push({
        ...row,
        marca: catalogText(row.marca) || catalogText(template?.marca),
        linea: catalogText(row.linea) || catalogText(template?.linea),
        material: catalogText(row.material) || catalogText(template?.acabado),
        precio: row.precio || (Number(template?.precio) > 0 ? String(template.precio) : ''),
        reason: resolved.reason,
        canCreate,
        estiloExists,
        similarColors: (resolved.siblings || []).map(item => item.color).filter(Boolean),
        missingFields: estiloExists ? [] : missing,
        willCreate: ready,
        templateId: template?.id || '',
      });
    }
    return { known, unknown };
  }

  async function createAuthorizedProducts(rows, context) {
    const groups = new Map();
    for (const row of rows) {
      const key = productLookupKey(row);
      if (!groups.has(key)) groups.set(key, row);
    }
    const payload = [...groups].map(([key, row]) => {
      const template = pickCanonicalProduct(productsOfEstilo(context, row.estilo)) || {};
      const precio = catalogPrice(row.precio);
      return {
        organization_id: context.organization.id,
        source_system: 'branch_import',
        source_id: key,
        match_key: [row.estilo, row.color, row.marca || template.marca].map(catalogText).join('|'),
        estilo: catalogText(row.estilo || template.estilo),
        color: sazResolve('color', row.color),
        precio: Number.isFinite(precio) && precio > 0 ? precio : Math.max(0, Number(template.precio) || 0),
        marca: sazResolve('marca', row.marca) || catalogText(template.marca),
        proveedor: sazResolve('proveedor', template.proveedor),
        temporada: catalogText(template.temporada) || sazCatalog()?.DEFAULT_TEMPORADA || '',
        sublinea: sazResolve('sublinea', template.sublinea),
        departamento: catalogText(template.departamento) || 'CALZADO',
        clasificacion: sazResolve('clasificacion', template.clasificacion),
        linea: sazResolve('linea', row.linea) || catalogText(template.linea),
        corrida: sazCatalog()?.resolve?.('corrida', template.corrida) || String(template.corrida || '').trim(),
        acabado: sazResolve('acabado', row.material) || catalogText(template.acabado),
        observaciones: String(row.notas || ''),
        activo: true,
      };
    });
    for (const group of chunks(payload, 200)) {
      const { data, error } = await client.from('products').upsert(group, { onConflict: 'organization_id,source_system,source_id' }).select(PRODUCT_CATALOG_SELECT);
      if (error) throw error;
      rememberProducts(context, data || []);
    }
    return payload.length;
  }

  async function applyBranchStock({ branchId, rows, mode = 'set', allowCreate = false, sourceName = 'captura individual' }) {
    if (!client || !user) throw new Error('Inicia sesión antes de guardar existencias.');
    let context = await loadBranchStockContext();
    const branch = context.branches.find(item => item.id === branchId);
    if (!branch) throw new Error('La sucursal seleccionada no existe o está inactiva.');
    if (catalogText(branch.code) === 'JUAREZ' || catalogText(branch.name) === catalogText(DEFAULT_BRANCH)) throw new Error('La carga por catálogo solo se permite en sucursales distintas de la tienda base JUÁREZ.');
    let validation = await validateBranchStockRows(rows);
    const creatable = validation.unknown.filter(row => row.willCreate);
    let createdProducts = 0;
    if (allowCreate && creatable.length) {
      createdProducts = await createAuthorizedProducts(creatable, context);
      validation = await validateBranchStockRows(rows);
    }
    const consolidated = new Map();
    for (const row of validation.known) {
      const size = String(row.talla || '').trim().replace(',', '.'), key = `${row.productId}|${size}`;
      if (!consolidated.has(key)) consolidated.set(key, { ...row, size, cantidad: 0 });
      consolidated.get(key).cantidad += Math.max(0, Number(row.cantidad) || 0);
    }
    const stockRows = [...consolidated.values()], missingVariants = [];
    await loadVariantsFor(context, [...new Set(stockRows.map(row => row.productId))], { refresh: true });
    for (const row of stockRows) {
      const existing = (context.variantsByProduct.get(row.productId) || []).find(variant => catalogText(variant.size) === catalogText(row.size));
      if (existing) row.variantId = existing.id;
      else missingVariants.push({ product_id: row.productId, size: row.size });
    }
    for (const group of chunks(missingVariants, 200)) {
      if (!group.length) continue;
      const { error } = await client.from('product_variants').upsert(group, { onConflict: 'product_id,size' });
      if (error) throw error;
    }
    if (missingVariants.length) await loadVariantsFor(context, [...new Set(stockRows.map(row => row.productId))], { refresh: true });
    for (const row of stockRows) {
      if (!row.variantId) row.variantId = (context.variantsByProduct.get(row.productId) || []).find(variant => catalogText(variant.size) === catalogText(row.size))?.id;
      if (!row.variantId) throw new Error(`No se pudo preparar la talla ${row.size} de ${row.estilo} ${row.color}.`);
    }
    const current = new Map();
    for (const group of chunks(stockRows.map(row => row.variantId), 200)) {
      if (!group.length) continue;
      const { data, error } = await client.from('inventory_levels').select('variant_id,quantity').eq('branch_id', branch.id).in('variant_id', group);
      if (error) throw error;
      for (const row of data || []) current.set(row.variant_id, Number(row.quantity || 0));
    }
    const levels = [], movements = [];
    for (const row of stockRows) {
      const previous = current.get(row.variantId) || 0, next = mode === 'add' ? previous + row.cantidad : row.cantidad;
      levels.push({ branch_id: branch.id, variant_id: row.variantId, quantity: next, updated_by: user.id });
      movements.push({ organization_id: context.organization.id, branch_id: branch.id, variant_id: row.variantId, operation: mode === 'add' ? 'add' : 'set', previous_quantity: previous, quantity: row.cantidad, new_quantity: next, reason: `Carga por sucursal · ${sourceName}`, import_key: `branch-stock:${crypto.randomUUID()}`, created_by: user.id });
    }
    for (const group of chunks(levels, 200)) {
      const { error } = await client.from('inventory_levels').upsert(group, { onConflict: 'branch_id,variant_id' });
      if (error) throw error;
    }
    for (const group of chunks(movements, 200)) {
      const { error } = await client.from('inventory_movements_relational').insert(group);
      if (error) throw error;
    }
    const remainingUnknown = (await validateBranchStockRows(rows)).unknown;
    return { branch, appliedRows: stockRows.length, appliedPairs: stockRows.reduce((sum, row) => sum + row.cantidad, 0), createdProducts, unknown: remainingUnknown };
  }

  async function listRecentBranchStock(branchId, limit = 100) {
    const context = await loadBranchStockContext();
    if (!branchId) return [];
    const maxRows = Math.max(100, Math.min(500, limit * 4));
    const { data: movements, error } = await client.from('inventory_movements_relational')
      .select('created_at,variant_id')
      .eq('organization_id', context.organization.id)
      .eq('branch_id', branchId)
      .in('operation', ['add', 'set', 'initial_import'])
      .order('created_at', { ascending: false })
      .limit(maxRows);
    if (error) throw error;
    const variantIds = [...new Set((movements || []).map(row => row.variant_id).filter(Boolean))];
    if (!variantIds.length) return [];
    const variants = [];
    for (const group of chunks(variantIds, 200)) {
      const { data, error: variantError } = await client.from('product_variants').select('id,product_id,size').in('id', group);
      if (variantError) throw variantError;
      variants.push(...(data || []));
    }
    const variantById = new Map(variants.map(row => [row.id, row]));
    const productIds = [...new Set(variants.map(row => row.product_id).filter(Boolean))];
    const products = [];
    for (const group of chunks(productIds, 200)) {
      const { data, error: productError } = await client.from('products').select('id,estilo,color,precio,imagen,source_system,estado').in('id', group);
      if (productError) throw productError;
      products.push(...(data || []));
    }
    const productById = new Map(products.map(row => [row.id, row]));
    const grouped = new Map();
    for (const movement of movements || []) {
      const variant = variantById.get(movement.variant_id);
      const product = productById.get(variant?.product_id);
      if (!product) continue;
      if (!grouped.has(product.id) && grouped.size >= limit) continue;
      if (!grouped.has(product.id)) grouped.set(product.id, { product, estilo: product.estilo, color: product.color, sizes: [], seen: new Set() });
      const group = grouped.get(product.id);
      const size = String(variant.size || '').trim();
      if (size && !group.seen.has(size)) {
        group.seen.add(size);
        group.sizes.push(size);
      }
    }
    return [...grouped.values()].map(row => ({
      id: row.product.id,
      estilo: row.estilo,
      color: row.color,
      sizes: [...row.sizes].sort((left, right) => Number(left) - Number(right)),
      precio: row.product.precio,
      imagen: row.product.imagen || '',
      isNew: isNuevoFicha(row.product, row.sizes.length),
    }));
  }

  function scheduleFlush() {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => flushQueue().catch(error => setCloudStatus(`Pendiente de sincronizar: ${cloudErrorMessage(error)}`, 'warn')), 700);
  }

  function recordMutation(change) {
    const queue = loadQueue();
    for (const item of change.upserts || []) {
      const key = recordKey(item);
      queue.upserts[key] = item;
      delete queue.deletes[key];
    }
    for (const item of change.deletes || []) {
      const key = recordKey(item);
      queue.deletes[key] = true;
      delete queue.upserts[key];
    }
    saveQueue(queue);
    if (user) scheduleFlush();
    else setCloudStatus('Cambios guardados localmente; inicia sesión para subirlos.', 'muted');
  }

  function recordImageMutation(change) {
    const queue = loadQueue();
    if (change.type === 'clear') {
      queue.imageClear = true;
      queue.images = {};
    } else {
      queue.images[change.name] = change.type;
    }
    saveQueue(queue);
    if (user) scheduleFlush();
  }

  function recordCatalogMutation(change) {
    const queue = loadQueue(), estilo = catalogText(change?.estilo), color = catalogText(change?.color);
    if (!estilo) return;
    const key = change.type === 'price' ? `price:${estilo}|${catalogCorrida(change.corrida)}` : `image:${estilo}|${color}`;
    queue.catalog[key] = { ...change, estilo, color, corrida: catalogCorrida(change.corrida) };
    saveQueue(queue);
    if (user) scheduleFlush();
    else setCloudStatus('Cambios guardados localmente; inicia sesión para relacionarlos con el catálogo.', 'muted');
  }

  async function applyCatalogMutation(change) {
    if (change.type === 'price') {
      let corrida = change.corrida;
      if (!catalogCorrida(corrida) && change.color) {
        const context = await loadBranchStockContext();
        const ofStyle = await queryProductsByEstilo(context, change.estilo, 200);
        const hit = ofStyle.find(item => colorsMatch(item.color, change.color) || catalogText(item.color) === catalogText(change.color));
        corrida = hit?.corrida || '';
      }
      return updateRelationalStylePrice(change.estilo, change.precio, corrida);
    }
    const context = await loadBranchStockContext();
    await queryProductsByEstilo(context, change.estilo, 200);
    let product = context.products.find(item => productLookupKey(item) === productLookupKey(change));
    if (!product && change.action !== 'delete') {
      const created = await syncCaptureToCatalog({ estilo: change.estilo, color: change.color, talla: '', cantidad: 0 });
      product = created?.product;
    }
    if (!product) return { updated: 0 };
    if (change.action === 'delete') return removeRelationalProductImage(change);
    const name = catalogImageName(change) || change.name, blob = await store.getProductImage(name);
    if (!blob) return { updated: 0 };
    return uploadRelationalProductImage({ productId: product.id, blob });
  }

  async function upsertRecords(records) {
    for (const group of chunks(records, 250)) {
      if (!group.length) continue;
      const { error } = await client.from('inventory_items').upsert(group.map(toRow), { onConflict: 'user_id,item_key' });
      if (error) throw error;
    }
  }

  async function deleteKeys(keys) {
    for (const group of chunks(keys, 250)) {
      if (!group.length) continue;
      const { error } = await client.from('inventory_items').delete().eq('user_id', user.id).in('item_key', group);
      if (error) throw error;
    }
  }

  async function listRemoteImageNames() {
    const names = [];
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await client.storage.from(BUCKET).list(user.id, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } });
      if (error) throw error;
      names.push(...(data || []).filter(file => file.name && file.id).map(file => file.name));
      if (!data || data.length < 100) break;
    }
    return names;
  }

  async function removeAllRemoteImages() {
    const names = await listRemoteImageNames();
    for (const group of chunks(names.map(name => `${user.id}/${name}`), 100)) {
      const { error } = await client.storage.from(BUCKET).remove(group);
      if (error) throw error;
    }
  }

  async function flushQueue() {
    if (!client || !user || syncing) return;
    syncing = true;
    updateAuthUi();
    const snapshot = loadQueue();
    try {
      setCloudStatus('Sincronizando cambios con Supabase…');
      await upsertRecords(Object.values(snapshot.upserts));
      await deleteKeys(Object.keys(snapshot.deletes));
      if (snapshot.imageClear) await removeAllRemoteImages();
      for (const [name, action] of Object.entries(snapshot.images)) {
        const path = `${user.id}/${name}`;
        if (action === 'delete') {
          const { error } = await client.storage.from(BUCKET).remove([path]);
          if (error) throw error;
        } else {
          const blob = await store.getProductImage(name);
          if (!blob) continue;
          const { error } = await client.storage.from(BUCKET).upload(path, blob, { contentType: 'image/png', upsert: true, cacheControl: '3600' });
          if (error) throw error;
        }
      }
      for (const change of Object.values(snapshot.catalog || {})) await applyCatalogMutation(change);
      const latest = loadQueue();
      for (const [key, value] of Object.entries(snapshot.upserts)) if (JSON.stringify(latest.upserts[key]) === JSON.stringify(value)) delete latest.upserts[key];
      for (const key of Object.keys(snapshot.deletes)) if (latest.deletes[key]) delete latest.deletes[key];
      for (const [name, action] of Object.entries(snapshot.images)) if (latest.images[name] === action) delete latest.images[name];
      for (const [key, change] of Object.entries(snapshot.catalog || {})) if (JSON.stringify(latest.catalog[key]) === JSON.stringify(change)) delete latest.catalog[key];
      if (snapshot.imageClear) latest.imageClear = false;
      saveQueue(latest);
      setCloudStatus('Cambios guardados en Supabase.', 'ok');
    } finally {
      syncing = false;
      updateAuthUi();
    }
  }

  async function fetchRemoteRecords() {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await client.from('inventory_items')
        .select('item_key,sucursal,estilo,marca,color,linea,talla,cantidad,material,precio,notas,saz_cargado,saz_cargado_at,origen,updated_at')
        .eq('user_id', user.id).order('item_key').range(from, from + 999);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return rows;
  }

  async function fetchSazStats() {
    const { data, error } = await client.from('saz_registration_summary')
      .select('registered_products,registered_variants,registered_pairs,last_registered_at')
      .eq('branch_code', 'JUAREZ').maybeSingle();
    if (error) {
      const missing = String(error.code || '') === 'PGRST205' || /saz_registration_summary/i.test(String(error.message || ''));
      if (missing) return;
      throw error;
    }
    store.setSazStats({
      registeredProducts: Number(data?.registered_products || 0),
      registeredVariants: Number(data?.registered_variants || 0),
      registeredPairs: Number(data?.registered_pairs || 0),
      lastRegisteredAt: data?.last_registered_at || '',
    });
  }

  async function syncRelationalImages() {
    const context = await loadBranchStockContext(), localImages = await store.listProductImages();
    const localByName = new Map(localImages.map(image => [image.name, image.blob])), groups = new Map(), canonicalNames = new Set();
    for (const product of context.products) {
      const key = productLookupKey(product);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(product);
    }
    for (const products of groups.values()) {
      const product = products[0], name = catalogImageName(product), path = products.map(item => item.imagen).find(Boolean) || '';
      let blob = null;
      if (path) {
        const downloaded = await client.storage.from(BUCKET).download(path);
        if (!downloaded.error) blob = downloaded.data;
      }
      if (blob) {
        await store.putImageFromCloud(name, blob);
        canonicalNames.add(name);
        if (products.some(item => item.imagen !== path)) await uploadRelationalProductImage({ productId: product.id, blob });
      } else if (localByName.has(name)) {
        blob = localByName.get(name);
        await uploadRelationalProductImage({ productId: product.id, blob });
        canonicalNames.add(name);
      }
    }
    return canonicalNames;
  }

  async function listAllProductImages() {
    if (!user) return { images: await store.listProductImages(), cloudComplete: false };
    await syncRelationalImages();
    return { images: await store.listProductImages(), cloudComplete: true };
  }

  async function syncImages() {
    setCloudStatus('Sincronizando imágenes…');
    const canonicalNames = await syncRelationalImages();
    const localImages = await store.listProductImages();
    const localNames = new Set(localImages.map(image => image.name));
    const remoteNames = new Set(await listRemoteImageNames());
    for (const image of localImages) {
      if (remoteNames.has(image.name) && !canonicalNames.has(image.name)) continue;
      const { error } = await client.storage.from(BUCKET).upload(`${user.id}/${image.name}`, image.blob, { contentType: 'image/png', upsert: canonicalNames.has(image.name), cacheControl: '3600' });
      if (error && String(error.statusCode) !== '409') throw error;
    }
    for (const name of remoteNames) {
      if (localNames.has(name)) continue;
      const { data, error } = await client.storage.from(BUCKET).download(`${user.id}/${name}`);
      if (error) throw error;
      await store.putImageFromCloud(name, data);
    }
    await store.refreshImageIndicators();
  }

  async function syncAll() {
    if (!user || syncing) return;
    await flushQueue();
    syncing = true;
    updateAuthUi();
    try {
      setCloudStatus('Comparando inventario local y Supabase…');
      const remoteRows = await fetchRemoteRecords();
      const remoteMap = new Map(remoteRows.map(row => [row.item_key, fromRow(row)]));
      const local = store.getItems();
      const localOnly = local.filter(item => !remoteMap.has(recordKey(item)));
      await upsertRecords(localOnly);
      for (const item of localOnly) remoteMap.set(recordKey(item), item);
      store.replaceItemsFromCloud([...remoteMap.values()]);
      try { await fetchSazStats(); }
      catch (error) { console.warn('SAZ stats', error); }
      try { await syncImages(); }
      catch (error) {
        setCloudStatus(`Inventario sincronizado (${remoteMap.size} artículos). Las imágenes no se completaron: ${cloudErrorMessage(error)}`, 'warn');
        return;
      }
      setCloudStatus(`Sincronizado: ${remoteMap.size} artículos protegidos en Supabase.`, 'ok');
    } finally {
      syncing = false;
      updateAuthUi();
    }
  }

  async function handleSession(session) {
    user = session?.user || null;
    branchStockContext = null;
    updateAuthUi();
    if (user) {
      const previousOwner = localStorage.getItem(OWNER_KEY);
      if (previousOwner && previousOwner !== user.id) {
        store.replaceItemsFromCloud([]);
        await store.clearImagesFromCloud();
        saveQueue(emptyQueue());
      }
      localStorage.setItem(OWNER_KEY, user.id);
      setCloudStatus(`Sesión iniciada como ${user.email}.`);
      loadBranchStockContext().catch(() => {});
      try { await syncAll(); }
      catch (error) { setCloudStatus(`No se pudo sincronizar: ${cloudErrorMessage(error)}`, 'warn'); }
      store.refreshSazPrepCatalog?.().catch(() => {});
    } else {
      setCloudStatus(client ? 'Inicia sesión para respaldar y sincronizar el inventario.' : 'Supabase no está configurado; los datos siguen guardándose localmente.', 'muted');
    }
  }

  const REVIEW_PREFIX = 'CLAREMM_REVIEW:';
  function parseReviewMeta(descripcion) {
    const raw = String(descripcion || '');
    const index = raw.indexOf(REVIEW_PREFIX);
    if (index < 0) return null;
    try { return JSON.parse(raw.slice(index + REVIEW_PREFIX.length)); }
    catch { return null; }
  }
  function writeReviewMeta(descripcion, review) {
    const raw = String(descripcion || '');
    const index = raw.indexOf(REVIEW_PREFIX);
    const notes = index < 0 ? raw.trim() : raw.slice(0, index).trim();
    const body = REVIEW_PREFIX + JSON.stringify(review);
    return notes ? `${notes}\n${body}` : body;
  }

  async function listCatalogReview({ branch = '', estado = 'pendiente' } = {}) {
    if (!client || !user) throw new Error('Inicia sesión para ver la revisión pendiente.');
    const context = await loadBranchStockContext();
    const { data, error } = await client.from('products')
      .select('id,estilo,color,marca,linea,acabado,precio,estado,descripcion,created_at,source_system,imagen')
      .eq('organization_id', context.organization.id)
      .like('descripcion', '%CLAREMM_REVIEW:%')
      .limit(1000);
    if (error) throw error;
    const wantedStatus = catalogText(estado);
    const wantedBranch = catalogText(branch).replace(/ /g, '_');
    const products = (data || []).map(product => ({ product, review: parseReviewMeta(product.descripcion) })).filter(row => {
      if (!row.review) return false;
      if (wantedStatus && wantedStatus !== 'TODOS' && catalogText(row.review.status) !== wantedStatus) return false;
      if (wantedBranch && catalogText(row.review.branch_code).replace(/ /g, '_') !== wantedBranch) return false;
      return true;
    });
    await loadVariantsFor(context, products.map(row => row.product.id));
    const branchId = wantedBranch ? (context.branches.find(item => catalogText(item.code).replace(/ /g, '_') === wantedBranch)?.id || '') : '';
    const variantIds = products.flatMap(row => (context.variantsByProduct.get(row.product.id) || []).map(variant => variant.id));
    const levels = [];
    for (const group of chunks(variantIds, 200)) {
      if (!group.length) continue;
      let query = client.from('inventory_levels').select('branch_id,variant_id,quantity').in('variant_id', group).gt('quantity', 0);
      if (branchId) query = query.eq('branch_id', branchId);
      const { data: rows, error: levelError } = await query;
      if (levelError) throw levelError;
      levels.push(...(rows || []));
    }
    const quantityByProduct = new Map();
    const sizesByProduct = new Map();
    const variantToProduct = new Map();
    for (const row of products) {
      for (const variant of context.variantsByProduct.get(row.product.id) || []) variantToProduct.set(variant.id, { productId: row.product.id, size: String(variant.size) });
    }
    for (const level of levels) {
      const info = variantToProduct.get(level.variant_id);
      if (!info) continue;
      quantityByProduct.set(info.productId, (quantityByProduct.get(info.productId) || 0) + Number(level.quantity || 0));
      if (!sizesByProduct.has(info.productId)) sizesByProduct.set(info.productId, []);
      sizesByProduct.get(info.productId).push({ size: info.size, quantity: Number(level.quantity || 0) });
    }
    return products.map(row => ({
      ficha_id: row.product.id,
      estilo: row.product.estilo,
      color: row.product.color,
      marca: row.product.marca || '',
      tipo: row.product.linea || '',
      tipo_inferido: Boolean(row.review.tipo_inferido),
      material: row.product.acabado || '',
      label_material: row.review.label_material || '',
      precio: Number(row.product.precio || 0),
      precio_origen: row.review.precio_origen || '',
      estado_revision: row.review.status || 'pendiente',
      kind: row.review.kind || 'created',
      batch_id: row.review.batch_id || '',
      created_at: row.product.created_at,
      estado_saz: /CARGADO EN SAZ|PRECARGADO EN SAZ/i.test(String(row.product.estado || '')) ? 'En SAZ' : 'Pendiente de SAZ',
      tallas: (sizesByProduct.get(row.product.id) || []).map(item => item.size),
      pares: quantityByProduct.get(row.product.id) || 0,
      imagen: row.product.imagen || '',
    }));
  }

  async function reviewCatalogProduct(productId, { precio, tipo, material, motivo, marcarRevisado = true } = {}) {
    if (!client || !user) throw new Error('Inicia sesión para corregir la ficha.');
    const context = await loadBranchStockContext();
    const current = context.productsById.get(productId) || (await client.from('products').select('id,descripcion,precio,linea,acabado,estilo,color,marca,imagen').eq('id', productId).single()).data;
    if (!current) throw new Error('No existe esa ficha.');
    const patch = {};
    if (precio != null && precio !== '') patch.precio = catalogPrice(precio);
    if (tipo != null) patch.linea = catalogText(tipo) ? sazResolve('linea', tipo) || String(tipo).trim() : current.linea;
    if (material != null) patch.acabado = catalogText(material) ? sazResolve('acabado', material) || String(material).trim() : current.acabado;
    const review = { ...(parseReviewMeta(current.descripcion) || {}), motivo: String(motivo || '').trim(), reviewed_at: new Date().toISOString() };
    if (marcarRevisado) review.status = 'revisado';
    patch.descripcion = writeReviewMeta(current.descripcion, review);
    const { data, error } = await client.from('products').update(patch).eq('id', productId).select('id,estilo,color,marca,linea,acabado,precio,estado,descripcion,created_at,imagen').single();
    if (error) throw error;
    rememberProducts(context, [data]);
    return data;
  }

  async function listSazPrepGaps(onProgress) {
    if (!client || !user) throw new Error('Inicia sesión para incluir el catálogo relacional.');
    const prep = window.ClaremmSazPrepExcel;
    const sizeKey = prep?.sizeKey || (value => {
      const number = Number(String(value ?? '').trim().replace(',', '.'));
      return Number.isFinite(number) ? number.toFixed(1) : '';
    });
    const fichaKey = prep?.fichaKey || ((estilo, color) => `${compactEstilo(estilo)}|${catalogText(color)}`);
    const context = await loadBranchStockContext();
    const juarez = context.branches.find(branch => catalogText(branch.code) === 'JUAREZ');
    if (!juarez) throw new Error('No está configurada la sucursal JUÁREZ.');
    const registeredIds = new Set(context.registryByKey.values());
    onProgress?.('Leyendo existencias de JUÁREZ…');
    const levels = await pagedQuery(() => client.from('inventory_levels').select('variant_id,quantity').eq('branch_id', juarez.id).gt('quantity', 0));
    if (!levels.length) return { rows: [], skipKeys: [] };
    const variantIds = [...new Set(levels.map(level => level.variant_id).filter(Boolean))];
    const variants = [];
    for (let index = 0; index < variantIds.length; index += 100) {
      onProgress?.(`Leyendo tallas JUÁREZ ${index + 1}…`);
      const { data, error } = await client.from('product_variants').select('id,product_id,size').in('id', variantIds.slice(index, index + 100));
      if (error) throw error;
      variants.push(...(data || []));
    }
    const productIds = [...new Set(variants.map(variant => variant.product_id).filter(Boolean))];
    const extraSelect = `${PRODUCT_CATALOG_SELECT},costo,suela,plantilla,tacon,forro,catalogo,status,observaciones,activo`;
    const products = [];
    for (let index = 0; index < productIds.length; index += 100) {
      onProgress?.(`Leyendo fichas JUÁREZ ${index + 1}…`);
      const group = productIds.slice(index, index + 100);
      let { data, error } = await client.from('products').select(extraSelect).in('id', group);
      if (error) {
        const fallback = await client.from('products').select(`${PRODUCT_CATALOG_SELECT},activo`).in('id', group);
        if (fallback.error) {
          const last = await client.from('products').select(PRODUCT_CATALOG_SELECT).in('id', group);
          if (last.error) throw last.error;
          data = last.data;
        } else data = fallback.data;
      }
      products.push(...(data || []));
    }
    const qtyByProductSize = new Map();
    const variantById = new Map(variants.map(variant => [variant.id, variant]));
    for (const level of levels) {
      const variant = variantById.get(level.variant_id);
      const size = sizeKey(variant?.size);
      const quantity = Math.trunc(Number(level.quantity) || 0);
      if (!variant || !size || quantity <= 0) continue;
      if (!qtyByProductSize.has(variant.product_id)) qtyByProductSize.set(variant.product_id, {});
      const bag = qtyByProductSize.get(variant.product_id);
      bag[size] = (bag[size] || 0) + quantity;
    }
    const groups = new Map();
    for (const product of products) {
      if (product.activo === false) continue;
      const key = fichaKey(product.estilo, product.color);
      const current = groups.get(key) || { products: [], qtyBySize: {} };
      current.products.push(product);
      const qtyBySize = qtyByProductSize.get(product.id) || {};
      for (const [size, quantity] of Object.entries(qtyBySize)) {
        const sized = sizeKey(size);
        const qty = Math.trunc(Number(quantity) || 0);
        if (!sized || qty <= 0) continue;
        current.qtyBySize[sized] = (current.qtyBySize[sized] || 0) + qty;
      }
      groups.set(key, current);
    }
    const rows = [];
    const skipKeys = [];
    for (const [key, group] of groups) {
      const canonical = pickCanonicalProduct(group.products);
      const inSaz = group.products.some(product => registeredIds.has(product.id) || product.source_system === 'saz_precargado' || /CARGADO EN SAZ|PRECARGADO EN SAZ/i.test(String(product.estado || '')));
      const sinImagen = !String(canonical?.imagen || '').trim();
      const sinPrecio = !(Number(canonical?.precio) > 0);
      const pares = Object.values(group.qtyBySize).reduce((sum, quantity) => sum + Math.trunc(Number(quantity) || 0), 0);
      if (inSaz || (!sinImagen && !sinPrecio)) {
        skipKeys.push(key);
        continue;
      }
      if (pares <= 0) continue;
      const product = canonical;
      rows.push({
        ficha_id: product.id,
        estilo: product.estilo,
        color: product.color,
        marca: product.marca || '',
        proveedor: product.proveedor || '',
        temporada: product.temporada || '',
        sublinea: product.sublinea || '',
        departamento: product.departamento || '',
        clasificacion: product.clasificacion || '',
        linea: product.linea || '',
        corrida: product.corrida || '',
        acabado: product.acabado || '',
        suela: product.suela || '',
        plantilla: product.plantilla || '',
        tacon: product.tacon || '',
        forro: product.forro || '',
        catalogo: product.catalogo || '',
        status: product.status == null ? 1 : product.status,
        observaciones: product.observaciones || '',
        costo: Number(product.costo || 0),
        precio: Number(product.precio || 0),
        imagen: product.imagen || '',
        qtyBySize: group.qtyBySize,
        pares,
        sin_imagen: sinImagen,
        sin_precio: sinPrecio,
        estado_saz: 'Pendiente de SAZ',
        origen: 'catalogo',
      });
    }
    return { rows, skipKeys };
  }

  window.claremmCloud = { recordMutation, recordImageMutation, recordCatalogMutation, syncAll, loadBranchStockContext, searchBranchCatalog, searchRelationalInventory, hydrateRelationalImages, uploadRelationalProductImage, updateRelationalStylePrice, updateRelationalProductField, duplicateRelationalProduct, syncCaptureToCatalog, getRelationalStylePrice, listAllProductImages, validateBranchStockRows, applyBranchStock, listRecentBranchStock, listCatalogReview, reviewCatalogProduct, listSazPrepGaps };

  byId('cloudLogin').onclick = async () => {
    if (!client) return alert('Supabase aún no está configurado.');
    const email = byId('cloudEmail').value.trim(), password = byId('cloudPassword').value;
    if (!email || !password) return alert('Escribe correo y contraseña.');
    byId('cloudLogin').disabled = true;
    const { error } = await client.auth.signInWithPassword({ email, password });
    byId('cloudLogin').disabled = false;
    if (error) alert('No se pudo iniciar sesión: ' + error.message);
  };

  byId('cloudRegister').onclick = async () => {
    if (!client) return alert('Supabase aún no está configurado.');
    const email = byId('cloudEmail').value.trim(), password = byId('cloudPassword').value;
    if (!email || password.length < 6) return alert('Usa un correo válido y una contraseña de al menos 6 caracteres.');
    byId('cloudRegister').disabled = true;
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: authRedirectUrl() },
    });
    byId('cloudRegister').disabled = false;
    if (error) return alert('No se pudo crear la cuenta: ' + error.message);
    if (!data.session) {
      setCloudStatus('Solicitud recibida. Si la cuenta está pendiente recibirás un correo; si ya fue confirmada, inicia sesión.', 'ok');
      alert('Revisa el correo y la carpeta de spam. Si esta cuenta ya fue confirmada, no se enviará otro mensaje: inicia sesión directamente.');
    }
  };

  byId('cloudResend').onclick = async () => {
    if (!client) return alert('Supabase aún no está configurado.');
    const email = byId('cloudEmail').value.trim();
    if (!email || !email.includes('@')) return alert('Escribe el correo de la cuenta que quieres confirmar.');
    byId('cloudResend').disabled = true;
    setCloudStatus('Solicitando un correo de confirmación nuevo…');
    const { error } = await client.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: authRedirectUrl() },
    });
    byId('cloudResend').disabled = false;
    if (error) {
      const message = cloudErrorMessage(error);
      setCloudStatus(message, 'warn');
      return alert(message);
    }
    setCloudStatus('Solicitud aceptada. Revisa la bandeja de entrada y spam; abre solamente el mensaje más reciente.', 'ok');
  };

  byId('cloudLogout').onclick = async () => { if (client) await client.auth.signOut(); };
  byId('cloudSync').onclick = () => syncAll().catch(error => setCloudStatus(`No se pudo sincronizar: ${cloudErrorMessage(error)}`, 'warn'));

  (async () => {
    try {
      const response = await fetch('./api/supabase-config', { cache: 'no-store' });
      if (!response.ok) throw new Error('not_configured');
      const config = await response.json();
      if (!window.supabase?.createClient) throw new Error('library_unavailable');
      client = window.supabase.createClient(config.url, config.publishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
      client.auth.onAuthStateChange((_event, session) => setTimeout(() => {
        if (session) clearAuthFragment();
        handleSession(session);
      }, 0));
      const { data } = await client.auth.getSession();
      if (data.session) clearAuthFragment();
      await handleSession(data.session);
      if (!data.session && initialAuthError) {
        clearAuthFragment();
        setCloudStatus(initialAuthError, 'warn');
      }
    } catch {
      updateAuthUi();
      setCloudStatus('Supabase no está configurado; los datos siguen guardándose localmente.', 'muted');
    }
  })();
})();
