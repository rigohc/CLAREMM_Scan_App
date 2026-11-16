'use strict';

(() => {
  const QUEUE_KEY = 'claremmscan-cloud-queue-v1';
  const OWNER_KEY = 'claremmscan-cloud-owner-v1';
  const BUCKET = 'product-images';
  const store = window.ClaremmStore;
  let client = null;
  let user = null;
  let syncing = false;
  let flushTimer = null;

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
  const setCloudStatus = (message, kind = '') => {
    const el = byId('cloudStatus');
    if (!el) return;
    el.textContent = message;
    el.className = kind;
  };
  const cloudErrorMessage = error => {
    const code = String(error?.code || '');
    const message = String(error?.message || error || 'Error desconocido');
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
    estilo: String(item.estilo || ''),
    color: String(item.color || ''),
    linea: String(item.linea || ''),
    talla: String(item.talla || ''),
    cantidad: Math.max(1, Number(item.cantidad) || 1),
    material: String(item.material || ''),
    precio: String(item.precio || ''),
    notas: String(item.notas || ''),
    updated_at: new Date().toISOString(),
  });
  const fromRow = row => ({
    estilo: row.estilo || '', color: row.color || '', linea: row.linea || '', talla: row.talla || '',
    cantidad: String(row.cantidad || 1), material: row.material || '', precio: row.precio || '', notas: row.notas || '',
  });

  function updateAuthUi() {
    byId('cloudSignedOut').hidden = !!user;
    byId('cloudSignedIn').hidden = !user;
    byId('cloudUser').textContent = user?.email || '';
    byId('cloudSync').disabled = !user || syncing;
    byId('cloudLogout').disabled = !user;
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
        .select('item_key,estilo,color,linea,talla,cantidad,material,precio,notas,updated_at')
        .eq('user_id', user.id).order('item_key').range(from, from + 999);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return rows;
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
      await syncImages();
      setCloudStatus(`Sincronizado: ${remoteMap.size} artículos protegidos en Supabase.`, 'ok');
    } finally {
      syncing = false;
      updateAuthUi();
    }
  }

  async function handleSession(session) {
    user = session?.user || null;
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

  window.claremmCloud = { recordMutation, recordImageMutation, syncAll };

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
