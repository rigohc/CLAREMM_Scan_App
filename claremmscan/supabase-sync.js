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
  const PRODUCT_CATALOG_SELECT = 'id,estilo,color,marca,proveedor,temporada,sublinea,departamento,clasificacion,linea,corrida,acabado,precio,source_system,imagen';

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
  const compactEstilo = value => catalogText(value).replace(/^0+(?=\d)/, '');
  const compactLookupKey = value => `${compactEstilo(value?.estilo)}|${catalogText(value?.color)}`;
  const productLookupKeys = value => {
    const exact = productLookupKey(value);
    const compact = compactLookupKey(value);
    return exact === compact ? [exact] : [exact, compact];
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
    for (const key of productLookupKeys(row)) {
      for (const product of context.productsByKey.get(key) || []) {
        if (seen.has(product.id)) continue;
        seen.add(product.id);
        candidates.push(product);
      }
    }
    return candidates;
  };
  const imageNamePart = value => catalogText(value).replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  const catalogImageName = value => `${imageNamePart(value?.estilo) || 'ESTILO'}-${imageNamePart(value?.color) || 'COLOR'}.png`;
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
    const [{ data: branches, error: branchError }, products, registry, variants] = await Promise.all([
      client.from('branches').select('id,code,name,active').eq('organization_id', organization.id).eq('active', true).order('name'),
      pagedQuery(() => client.from('products').select(PRODUCT_CATALOG_SELECT).eq('organization_id', organization.id).eq('activo', true).order('estilo')),
      pagedQuery(() => client.from('saz_product_registry').select('product_id,lookup_key').eq('organization_id', organization.id)),
      pagedQuery(() => client.from('product_variants').select('id,product_id,size,products!inner(organization_id)').eq('products.organization_id', organization.id)),
    ]);
    if (branchError) throw branchError;
    const productsByKey = new Map(), productsById = new Map();
    for (const product of products) {
      productsById.set(product.id, product);
      for (const key of productLookupKeys(product)) {
        if (!productsByKey.has(key)) productsByKey.set(key, []);
        productsByKey.get(key).push(product);
      }
    }
    const registryByKey = new Map();
    for (const row of registry) {
      const exact = catalogText(row.lookup_key);
      registryByKey.set(exact, row.product_id);
      const [estilo, color = ''] = exact.split('|');
      const compact = `${compactEstilo(estilo)}|${catalogText(color)}`;
      if (!registryByKey.has(compact)) registryByKey.set(compact, row.product_id);
    }
    const variantsByProduct = new Map();
    for (const variant of variants) {
      if (!variantsByProduct.has(variant.product_id)) variantsByProduct.set(variant.product_id, []);
      variantsByProduct.get(variant.product_id).push({ id: variant.id, product_id: variant.product_id, size: String(variant.size) });
    }
    branchStockContext = { userId: user.id, organization, branches: branches || [], products, productsById, productsByKey, registryByKey, variantsByProduct };
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
    if (row?.productId && context.productsById.has(row.productId)) return { product: context.productsById.get(row.productId), reason: '' };
    const candidates = candidatesFor(context, row);
    const registeredId = productLookupKeys(row).map(key => context.registryByKey.get(key)).find(id => id && context.productsById.has(id));
    if (registeredId) return { product: context.productsById.get(registeredId), reason: '' };
    const product = pickCanonicalProduct(candidates);
    if (product) return { product, reason: '' };
    return { product: null, reason: 'No existe este estilo y color en el catálogo.' };
  }

  async function searchBranchCatalog(query) {
    const context = await loadBranchStockContext();
    const terms = catalogText(query).split(' ').filter(Boolean);
    if (!terms.length) return [];
    return context.products.filter(product => {
      const haystack = catalogText([product.estilo, product.color, product.marca, product.proveedor, product.linea, product.corrida, product.acabado].join(' '));
      return terms.every(term => haystack.includes(term));
    }).slice(0, 40).map(product => ({ ...product, sizes: (context.variantsByProduct.get(product.id) || []).map(variant => variant.size) }));
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

  async function searchRelationalInventory(query, scope = 'all', sazFilter = 'all') {
    const context = await loadBranchStockContext();
    const terms = catalogText(query).split(' ').filter(Boolean);
    if (!terms.length) return [];
    const products = context.products.filter(product => {
      const haystack = scope === 'style'
        ? catalogText(product.estilo)
        : catalogText([product.estilo, product.color, product.marca, product.proveedor, product.temporada, product.sublinea, product.departamento, product.clasificacion, product.linea, product.corrida, product.acabado].join(' '));
      const registered = context.registryByKey.get(productLookupKey(product)) === product.id;
      const matchesStatus = sazFilter === 'loaded' ? registered : sazFilter === 'pending' ? !registered : true;
      return matchesStatus && terms.every(term => haystack.includes(term));
    }).slice(0, 80);
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
    const branchById = new Map(context.branches.map(branch => [branch.id, branch])), grouped = new Map();
    for (const level of levels) {
      const product = productByVariant.get(level.variant_id), variant = variantById.get(level.variant_id), branch = branchById.get(level.branch_id);
      if (!product || !variant || !branch) continue;
      const key = `${product.id}|${branch.id}`;
      if (!grouped.has(key)) grouped.set(key, { product, branch, sizes: [], totalQuantity: 0 });
      const result = grouped.get(key), quantity = Number(level.quantity || 0);
      result.sizes.push({ size: variant.size, quantity });
      result.totalQuantity += quantity;
    }
    return [...grouped.values()]
      .map(result => ({
        ...result,
        sizes: result.sizes.sort((a, b) => Number(a.size) - Number(b.size)),
        sazRegistered: context.registryByKey.get(productLookupKey(result.product)) === result.product.id,
        imageUrl: result.product.imagen ? relationalImageUrls.get(result.product.imagen) || '' : '',
      }))
      .sort((a, b) => catalogText(`${a.product.estilo}|${a.product.color}|${a.branch.name}`).localeCompare(catalogText(`${b.product.estilo}|${b.product.color}|${b.branch.name}`)));
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

  async function uploadRelationalProductImage({ productId, blob }) {
    if (!client || !user) throw new Error('Inicia sesión antes de guardar una imagen.');
    if (!(blob instanceof Blob) || blob.type !== 'image/png') throw new Error('La imagen debe estar en formato PNG.');
    if (blob.size > 100 * 1024) throw new Error('La imagen supera el límite de 100 KB.');
    const context = await loadBranchStockContext(), product = context.productsById.get(productId);
    if (!product) throw new Error('No se encontró el producto en el catálogo relacional.');
    const matchingProducts = context.products.filter(item => productLookupKey(item) === productLookupKey(product));
    const fileName = catalogImageName(product);
    const path = `${context.organization.id}/products/${fileName}`;
    const { error: uploadError } = await client.storage.from(BUCKET).upload(path, blob, { contentType: 'image/png', upsert: true, cacheControl: '60' });
    if (uploadError) throw uploadError;
    for (const group of chunks(matchingProducts.map(item => item.id), 200)) {
      const { error: productError } = await client.from('products').update({ imagen: path }).eq('organization_id', context.organization.id).in('id', group);
      if (productError) throw productError;
    }
    for (const item of matchingProducts) item.imagen = path;
    relationalImageUrls.delete(path);
    const signedUrl = await signedRelationalImage(path, true);
    return { path, fileName, imageUrl: `${signedUrl}${signedUrl.includes('?') ? '&' : '?'}v=${Date.now()}`, size: blob.size };
  }

  async function removeRelationalProductImage({ estilo, color }) {
    const context = await loadBranchStockContext();
    const matchingProducts = context.products.filter(product => productLookupKey(product) === productLookupKey({ estilo, color }));
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

  async function updateRelationalStylePrice(estilo, precio) {
    if (!client || !user) throw new Error('Inicia sesión antes de actualizar precios.');
    const value = catalogPrice(precio);
    if (!Number.isFinite(value) || value < 0) throw new Error('Escribe un precio válido.');
    const context = await loadBranchStockContext(), matchingProducts = context.products.filter(product => catalogText(product.estilo) === catalogText(estilo));
    for (const group of chunks(matchingProducts.map(product => product.id), 200)) {
      if (!group.length) continue;
      const { error } = await client.from('products').update({ precio: value }).eq('organization_id', context.organization.id).in('id', group);
      if (error) throw error;
    }
    for (const product of matchingProducts) product.precio = value;
    return { updated: matchingProducts.length, precio: value };
  }

  async function updateRelationalProductField({ productId, field, value }) {
    if (!client || !user) throw new Error('Inicia sesión antes de editar la ficha.');
    if (!PRODUCT_EDIT_FIELDS.includes(field)) throw new Error('Ese dato no se edita desde la ficha.');
    const context = await loadBranchStockContext();
    const product = context.productsById.get(productId);
    if (!product) throw new Error('No se encontró el producto en el catálogo relacional.');
    if (field === 'precio') return updateRelationalStylePrice(product.estilo, value);
    const next = String(value ?? '').trim();
    const { error } = await client.from('products').update({ [field]: next }).eq('id', productId).eq('organization_id', context.organization.id);
    if (error) throw error;
    product[field] = next;
    return { updated: 1, field, value: next, estilo: product.estilo };
  }

  async function getRelationalStylePrice(estilo) {
    const context = await loadBranchStockContext();
    const prices = context.products.filter(product => catalogText(product.estilo) === catalogText(estilo)).map(product => Number(product.precio)).filter(price => Number.isFinite(price) && price > 0);
    if (!prices.length) return '';
    const frequency = new Map();
    for (const price of prices) frequency.set(price, (frequency.get(price) || 0) + 1);
    return String([...frequency].sort((a, b) => b[1] - a[1])[0][0]);
  }

  async function validateBranchStockRows(rows) {
    const context = await loadBranchStockContext();
    const known = [], unknown = [];
    for (const row of rows || []) {
      const resolved = resolveCatalogProduct(context, row);
      if (resolved.product) known.push({ ...row, productId: resolved.product.id, product: resolved.product });
      else unknown.push({ ...row, reason: resolved.reason, canCreate: !candidatesFor(context, row).length });
    }
    return { known, unknown };
  }

  async function createAuthorizedProducts(rows, context) {
    const groups = new Map();
    for (const row of rows) {
      const key = productLookupKey(row);
      if (!groups.has(key)) groups.set(key, row);
    }
    const payload = [...groups].map(([key, row]) => ({
      organization_id: context.organization.id,
      source_system: 'branch_import',
      source_id: key,
      match_key: [row.estilo, row.color, row.marca].map(catalogText).join('|'),
      estilo: catalogText(row.estilo), color: catalogText(row.color), precio: Math.max(0, Number(row.precio) || 0),
      marca: catalogText(row.marca), linea: catalogText(row.linea), acabado: catalogText(row.material),
      observaciones: String(row.notas || ''), activo: true,
    }));
    for (const group of chunks(payload, 200)) {
      const { error } = await client.from('products').upsert(group, { onConflict: 'organization_id,source_system,source_id' });
      if (error) throw error;
    }
    await loadBranchStockContext(true);
    return payload.length;
  }

  async function applyBranchStock({ branchId, rows, mode = 'set', allowCreate = false, sourceName = 'captura individual' }) {
    if (!client || !user) throw new Error('Inicia sesión antes de guardar existencias.');
    let context = await loadBranchStockContext();
    const branch = context.branches.find(item => item.id === branchId);
    if (!branch) throw new Error('La sucursal seleccionada no existe o está inactiva.');
    if (catalogText(branch.code) === 'JUAREZ' || catalogText(branch.name) === catalogText(DEFAULT_BRANCH)) throw new Error('La carga por catálogo solo se permite en sucursales distintas de la tienda base JUÁREZ.');
    let validation = await validateBranchStockRows(rows);
    const creatable = validation.unknown.filter(row => row.canCreate && row.createProduct === true && row.marca && row.linea && row.material);
    let createdProducts = 0;
    if (allowCreate && creatable.length) {
      createdProducts = await createAuthorizedProducts(creatable, context);
      context = await loadBranchStockContext(true);
      validation = await validateBranchStockRows(rows);
    }
    const consolidated = new Map();
    for (const row of validation.known) {
      const size = String(row.talla || '').trim().replace(',', '.'), key = `${row.productId}|${size}`;
      if (!consolidated.has(key)) consolidated.set(key, { ...row, size, cantidad: 0 });
      consolidated.get(key).cantidad += Math.max(0, Number(row.cantidad) || 0);
    }
    const stockRows = [...consolidated.values()], missingVariants = [];
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
    if (missingVariants.length) context = await loadBranchStockContext(true);
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
    const key = change.type === 'price' ? `price:${estilo}` : `image:${estilo}|${color}`;
    queue.catalog[key] = { ...change, estilo, color };
    saveQueue(queue);
    if (user) scheduleFlush();
    else setCloudStatus('Cambios guardados localmente; inicia sesión para relacionarlos con el catálogo.', 'muted');
  }

  async function applyCatalogMutation(change) {
    if (change.type === 'price') return updateRelationalStylePrice(change.estilo, change.precio);
    const context = await loadBranchStockContext();
    const product = context.products.find(item => productLookupKey(item) === productLookupKey(change));
    if (!product) return { updated: 0 };
    if (change.action === 'delete') return removeRelationalProductImage(change);
    const name = change.name || catalogImageName(change), blob = await store.getProductImage(name);
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
      await fetchSazStats();
      await syncImages();
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
    } else {
      setCloudStatus(client ? 'Inicia sesión para respaldar y sincronizar el inventario.' : 'Supabase no está configurado; los datos siguen guardándose localmente.', 'muted');
    }
  }

  window.claremmCloud = { recordMutation, recordImageMutation, recordCatalogMutation, syncAll, loadBranchStockContext, searchBranchCatalog, searchRelationalInventory, hydrateRelationalImages, uploadRelationalProductImage, updateRelationalStylePrice, updateRelationalProductField, getRelationalStylePrice, listAllProductImages, validateBranchStockRows, applyBranchStock };

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
