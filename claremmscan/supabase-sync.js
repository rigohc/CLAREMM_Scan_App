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

  const byId = id => document.getElementById(id);
  const emptyQueue = () => ({ upserts: {}, deletes: {}, images: {}, imageClear: false });
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
  const productLookupKey = value => `${catalogText(value?.estilo)}|${catalogText(value?.color)}`;
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

  async function loadBranchStockContext(force = false) {
    if (!client || !user) throw new Error('Inicia sesión para consultar el catálogo por sucursal.');
    if (!force && branchStockContext?.userId === user.id) return branchStockContext;
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
      pagedQuery(() => client.from('products').select('id,estilo,color,marca,linea,acabado,precio,proveedor,source_system').eq('organization_id', organization.id).eq('activo', true).order('estilo')),
      pagedQuery(() => client.from('saz_product_registry').select('product_id,lookup_key').eq('organization_id', organization.id)),
      pagedQuery(() => client.from('product_variants').select('id,product_id,size,products!inner(organization_id)').eq('products.organization_id', organization.id)),
    ]);
    if (branchError) throw branchError;
    const productsByKey = new Map(), productsById = new Map();
    for (const product of products) {
      productsById.set(product.id, product);
      const key = productLookupKey(product);
      if (!productsByKey.has(key)) productsByKey.set(key, []);
      productsByKey.get(key).push(product);
    }
    const registryByKey = new Map(registry.map(row => [catalogText(row.lookup_key), row.product_id]));
    const variantsByProduct = new Map();
    for (const variant of variants) {
      if (!variantsByProduct.has(variant.product_id)) variantsByProduct.set(variant.product_id, []);
      variantsByProduct.get(variant.product_id).push({ id: variant.id, product_id: variant.product_id, size: String(variant.size) });
    }
    branchStockContext = { userId: user.id, organization, branches: branches || [], products, productsById, productsByKey, registryByKey, variantsByProduct };
    return branchStockContext;
  }

  function resolveCatalogProduct(context, row) {
    if (row?.productId && context.productsById.has(row.productId)) return { product: context.productsById.get(row.productId), reason: '' };
    const key = productLookupKey(row), candidates = context.productsByKey.get(key) || [], registeredId = context.registryByKey.get(key);
    if (registeredId && context.productsById.has(registeredId)) return { product: context.productsById.get(registeredId), reason: '' };
    if (candidates.length === 1) return { product: candidates[0], reason: '' };
    if (!candidates.length) return { product: null, reason: 'No existe este estilo y color en el catálogo.' };
    return { product: null, reason: 'Hay más de una ficha para este estilo y color; requiere revisión manual.' };
  }

  async function searchBranchCatalog(query) {
    const context = await loadBranchStockContext();
    const terms = catalogText(query).split(' ').filter(Boolean);
    if (!terms.length) return [];
    return context.products.filter(product => {
      const haystack = catalogText([product.estilo, product.color, product.marca, product.proveedor, product.linea].join(' '));
      return terms.every(term => haystack.includes(term));
    }).slice(0, 40).map(product => ({ ...product, sizes: (context.variantsByProduct.get(product.id) || []).map(variant => variant.size) }));
  }

  async function validateBranchStockRows(rows) {
    const context = await loadBranchStockContext();
    const known = [], unknown = [];
    for (const row of rows || []) {
      const resolved = resolveCatalogProduct(context, row);
      if (resolved.product) known.push({ ...row, productId: resolved.product.id, product: resolved.product });
      else unknown.push({ ...row, reason: resolved.reason, canCreate: !context.productsByKey.has(productLookupKey(row)) });
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
      const latest = loadQueue();
      for (const [key, value] of Object.entries(snapshot.upserts)) if (JSON.stringify(latest.upserts[key]) === JSON.stringify(value)) delete latest.upserts[key];
      for (const key of Object.keys(snapshot.deletes)) if (latest.deletes[key]) delete latest.deletes[key];
      for (const [name, action] of Object.entries(snapshot.images)) if (latest.images[name] === action) delete latest.images[name];
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

  async function syncImages() {
    setCloudStatus('Sincronizando imágenes…');
    const localImages = await store.listProductImages();
    const localNames = new Set(localImages.map(image => image.name));
    const remoteNames = new Set(await listRemoteImageNames());
    for (const image of localImages) {
      if (remoteNames.has(image.name)) continue;
      const { error } = await client.storage.from(BUCKET).upload(`${user.id}/${image.name}`, image.blob, { contentType: 'image/png', upsert: false, cacheControl: '3600' });
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
      try { await syncAll(); }
      catch (error) { setCloudStatus(`No se pudo sincronizar: ${cloudErrorMessage(error)}`, 'warn'); }
    } else {
      setCloudStatus(client ? 'Inicia sesión para respaldar y sincronizar el inventario.' : 'Supabase no está configurado; los datos siguen guardándose localmente.', 'muted');
    }
  }

  window.claremmCloud = { recordMutation, recordImageMutation, syncAll, loadBranchStockContext, searchBranchCatalog, validateBranchStockRows, applyBranchStock };

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
