/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V4 · module: branch inventory · genre: modern-minimal · theme: existing CLAREMM tokens */
'use strict';

(() => {
  const BASE_BRANCH_CODE = 'JUAREZ';
  const BASE_BRANCH_NAME = 'CLAREMM ZAPATERIA JUAREZ';
  const BRANCH_MEMORY_KEY = 'claremmscan-branch-stock-target-v1';
  const byId = id => document.getElementById(id);
  const text = value => String(value ?? '').trim();
  const normalized = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ');
  const normalizedSize = value => text(value).replace(',', '.');
  const numericPrice = value => { const raw = text(value).replace(/[^0-9,.-]/g, ''); if (!raw) return NaN; const comma = raw.lastIndexOf(','), dot = raw.lastIndexOf('.'); return Number(comma > dot ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '')); };
  const validSize = value => Number.isFinite(Number(normalizedSize(value))) && Number(normalizedSize(value)) > 0;
  const validQuantity = (value, mode = 'set') => Number.isInteger(Number(value)) && Number(value) >= (mode === 'add' ? 1 : 0);
  const esc = value => text(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const cloud = () => window.claremmCloud;
  let context = null;
  let selectedProduct = null;
  let bulkState = null;
  let manualUnknown = [];
  let searchTimer = null;
  let searchSequence = 0;
  let inventorySearchTimer = null;
  let inventorySearchSequence = 0;
  let relationalInventoryResults = [];
  let relationalInventoryQuery = '';
  let relationalImageTarget = null;

  function status(message, kind = '') {
    const element = byId('branchStockStatus');
    element.textContent = message;
    element.className = `branchStockStatus ${kind}`.trim();
  }

  function selectedBranchId() {
    return byId('branchStockBranch').value;
  }

  function isBaseBranch(branch) {
    return normalized(branch?.code) === BASE_BRANCH_CODE || normalized(branch?.name) === normalized(BASE_BRANCH_NAME);
  }

  function updateGate(message, enabled = false) {
    byId('branchStockGate').hidden = enabled;
    byId('branchStockWorkspace').hidden = !enabled;
    if (!enabled) byId('branchStockGate').textContent = message;
  }

  function resetManual() {
    selectedProduct = null;
    byId('branchStockStyle').value = '';
    byId('branchStockColor').value = '';
    byId('branchStockSize').value = '';
    byId('branchStockQuantity').value = '1';
    byId('branchSizeOptions').innerHTML = '';
    byId('branchCatalogResults').innerHTML = '<small>Escribe estilo o color para buscar.</small>';
    byId('branchStockSaveOne').disabled = true;
    byId('branchStockQueueUnknown').disabled = true;
  }

  function renderSearchResults(products) {
    const container = byId('branchCatalogResults');
    if (!products.length) {
      selectedProduct = null;
      container.innerHTML = '<small>No se encontró una coincidencia exacta. Puedes guardarla como producto desconocido.</small>';
      byId('branchStockSaveOne').disabled = true;
      byId('branchStockQueueUnknown').disabled = !(byId('branchStockStyle').value.trim() && byId('branchStockColor').value.trim());
      return;
    }
    container.innerHTML = products.map((product, index) => `<button type="button" class="catalogResult" data-product-index="${index}"><span><strong>${esc(product.estilo)} · ${esc(product.color)}</strong><small>${esc([product.marca, product.linea, product.acabado].filter(Boolean).join(' · ') || 'Sin datos adicionales')}</small></span><span class="catalogResultMark">${product.sizes?.length || 0} talla(s)</span></button>`).join('');
    container.querySelectorAll('[data-product-index]').forEach(button => button.addEventListener('click', () => {
      selectedProduct = products[Number(button.dataset.productIndex)];
      container.querySelectorAll('.catalogResult').forEach(item => item.classList.toggle('isSelected', item === button));
      byId('branchStockStyle').value = selectedProduct.estilo;
      byId('branchStockColor').value = selectedProduct.color;
      byId('branchSizeOptions').innerHTML = [...new Set(selectedProduct.sizes || [])].sort((a, b) => Number(a) - Number(b)).map(size => `<option value="${esc(size)}"></option>`).join('');
      byId('branchStockSaveOne').disabled = false;
      byId('branchStockQueueUnknown').disabled = true;
      status(`Seleccionado ${selectedProduct.estilo} · ${selectedProduct.color}. Escribe talla y cantidad.`);
    }));
    byId('branchStockQueueUnknown').disabled = true;
  }

  async function searchCatalog() {
    const style = byId('branchStockStyle').value.trim(), color = byId('branchStockColor').value.trim(), query = `${style} ${color}`.trim();
    selectedProduct = null;
    byId('branchStockSaveOne').disabled = true;
    if (query.length < 2) return renderSearchResults([]);
    const sequence = ++searchSequence;
    byId('branchCatalogResults').innerHTML = '<small>Buscando en el catálogo…</small>';
    try {
      const products = await cloud().searchBranchCatalog(query);
      if (sequence !== searchSequence) return;
      const exact = products.filter(product => (!style || normalized(product.estilo).includes(normalized(style))) && (!color || normalized(product.color).includes(normalized(color))));
      renderSearchResults(exact);
    } catch (error) {
      if (sequence !== searchSequence) return;
      renderSearchResults([]);
      status(error.message, 'warn');
    }
  }

  function queueSearch() {
    selectedProduct = null;
    byId('branchStockSaveOne').disabled = true;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(searchCatalog, 250);
  }

  function manualRow(product = selectedProduct) {
    return {
      productId: product?.id || '', estilo: normalized(byId('branchStockStyle').value), color: normalized(byId('branchStockColor').value),
      talla: normalizedSize(byId('branchStockSize').value), cantidad: Number(byId('branchStockQuantity').value),
      marca: product?.marca || '', linea: product?.linea || '', material: product?.acabado || '', precio: product?.precio || '', notas: '', createProduct: false,
    };
  }

  async function saveManual() {
    const mode = document.querySelector('input[name="branchManualMode"]:checked')?.value || 'set', row = manualRow();
    if (!selectedBranchId()) return status('Selecciona una sucursal destino.', 'warn');
    if (!selectedProduct) return status('Selecciona primero un producto del catálogo.', 'warn');
    if (!validSize(row.talla)) return status('Escribe una talla numérica válida.', 'warn');
    if (!validQuantity(row.cantidad, mode)) return status(mode === 'add' ? 'Para sumar, la cantidad debe ser al menos 1.' : 'La cantidad debe ser un entero desde 0.', 'warn');
    const button = byId('branchStockSaveOne');
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    status('Guardando existencia en Supabase…');
    try {
      const result = await cloud().applyBranchStock({ branchId: selectedBranchId(), rows: [row], mode, sourceName: 'captura individual' });
      status(`Guardado: ${row.estilo} · ${row.color} · talla ${row.talla} en ${result.branch.name}.`, 'ok');
      resetManual();
    } catch (error) {
      status(error.message, 'warn');
      button.disabled = false;
    } finally {
      button.removeAttribute('aria-busy');
    }
  }

  function queueUnknownManual() {
    const row = manualRow(null);
    if (!row.estilo || !row.color || !validSize(row.talla) || !validQuantity(row.cantidad)) return status('Para guardar como desconocido completa estilo, color, talla y cantidad.', 'warn');
    manualUnknown.push({ ...row, reason: 'No encontrado durante la captura individual.' });
    byId('branchStockDownloadUnknown').disabled = false;
    byId('branchStockUnknownBox').hidden = false;
    byId('branchStockUnknownCount').textContent = String((bulkState?.validation.unknown.length || 0) + manualUnknown.length);
    status('Producto agregado a la lista de desconocidos. Puedes descargar su Excel.', 'ok');
    resetManual();
  }

  const HEADER_ALIASES = {
    estilo: ['estilo', 'style', 'codigo', 'codigoestilo', 'sku'], color: ['color'], talla: ['talla', 'size'], cantidad: ['cantidad', 'quantity', 'qty', 'pares'],
    marca: ['marca', 'brand'], linea: ['linea', 'tipodelinea', 'tipolinea', 'categoria'], material: ['material', 'acabado'], precio: ['precio', 'price'],
    notas: ['notas', 'nota', 'observaciones', 'notes'], createProduct: ['crearproducto', 'crear', 'accion', 'action'],
  };
  const header = value => normalized(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  function valueByAliases(indexed, aliases) {
    const key = aliases.find(alias => Object.prototype.hasOwnProperty.call(indexed, alias));
    return key ? indexed[key] : '';
  }
  function normalizeFileRow(source) {
    const indexed = {};
    Object.entries(source || {}).forEach(([key, value]) => { indexed[header(key)] = value; });
    const createValue = normalized(valueByAliases(indexed, HEADER_ALIASES.createProduct)), quantityValue = valueByAliases(indexed, HEADER_ALIASES.cantidad);
    return {
      estilo: normalized(valueByAliases(indexed, HEADER_ALIASES.estilo)), color: normalized(valueByAliases(indexed, HEADER_ALIASES.color)),
      talla: normalizedSize(valueByAliases(indexed, HEADER_ALIASES.talla)), cantidad: Number(quantityValue), quantityPresent: text(quantityValue) !== '',
      marca: normalized(valueByAliases(indexed, HEADER_ALIASES.marca)), linea: normalized(valueByAliases(indexed, HEADER_ALIASES.linea)),
      material: normalized(valueByAliases(indexed, HEADER_ALIASES.material)), precio: text(valueByAliases(indexed, HEADER_ALIASES.precio)).replace(/[^0-9.-]/g, ''),
      notas: text(valueByAliases(indexed, HEADER_ALIASES.notas)), createProduct: ['SI', 'YES', 'TRUE', '1', 'CREAR'].includes(createValue),
    };
  }

  async function readRows(file) {
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (extension === 'json' || file.type === 'application/json') {
      const data = JSON.parse(await file.text()), rows = Array.isArray(data) ? data : data.rows || data.items || data.records;
      if (!Array.isArray(rows)) throw new Error('El JSON debe contener una lista de filas.');
      return rows;
    }
    if (!window.XLSX) throw new Error('No está disponible el lector de Excel/CSV. Comprueba tu conexión.');
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' }), sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) throw new Error('El archivo no contiene una hoja legible.');
    return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  }

  function consolidate(rows) {
    const result = new Map();
    for (const row of rows) {
      const key = `${row.estilo}|${row.color}|${row.talla}`;
      if (!result.has(key)) result.set(key, { ...row });
      else {
        const current = result.get(key);
        current.cantidad += row.cantidad;
        for (const field of ['marca', 'linea', 'material', 'precio', 'notas']) if (!current[field] && row[field]) current[field] = row[field];
        current.createProduct ||= row.createProduct;
      }
    }
    return [...result.values()];
  }

  async function parseBulkFile(file) {
    const source = await readRows(file), invalid = [], valid = [];
    source.forEach((row, index) => {
      const normalizedRow = normalizeFileRow(row), reasons = [];
      if (!normalizedRow.estilo) reasons.push('falta estilo');
      if (!normalizedRow.color) reasons.push('falta color');
      if (!validSize(normalizedRow.talla)) reasons.push('talla inválida');
      if (!normalizedRow.quantityPresent || !Number.isInteger(normalizedRow.cantidad) || normalizedRow.cantidad < 0) reasons.push('cantidad inválida');
      if (reasons.length) invalid.push({ row: index + 2, reasons, data: normalizedRow });
      else valid.push(normalizedRow);
    });
    const rows = consolidate(valid), validation = await cloud().validateBranchStockRows(rows);
    return { fileName: file.name, sourceRows: source.length, rows, validation, invalid };
  }

  function creatableUnknownCount() {
    return (bulkState?.validation.unknown || []).filter(row => row.canCreate && row.createProduct && row.marca && row.linea && row.material).length;
  }

  function renderBulkState() {
    const state = bulkState, unknownCount = (state?.validation.unknown.length || 0) + manualUnknown.length;
    byId('branchStockFileName').textContent = state ? `${state.fileName} · ${state.invalid.length} fila(s) inválida(s).` : 'Columnas: Estilo, Color, Talla y Cantidad. Admite Excel, CSV y JSON.';
    byId('branchStockRows').textContent = String(state?.rows.length || 0);
    byId('branchStockKnown').textContent = String(state?.validation.known.length || 0);
    byId('branchStockUnknownCount').textContent = String(unknownCount);
    byId('branchStockPairs').textContent = String(state?.rows.reduce((sum, row) => sum + Number(row.cantidad || 0), 0) || 0);
    byId('branchStockUnknownBox').hidden = unknownCount === 0;
    byId('branchStockDownloadUnknown').disabled = unknownCount === 0;
    const canCreate = byId('branchStockAllowCreate').checked && creatableUnknownCount() > 0;
    byId('branchStockApplyFile').disabled = !selectedBranchId() || !state || (!state.validation.known.length && !canCreate);
  }

  function workbookDownload(rows, name, instructions) {
    if (!window.XLSX) return status('No está disponible el generador de Excel.', 'warn');
    const workbook = XLSX.utils.book_new(), sheet = XLSX.utils.json_to_sheet(rows);
    sheet['!cols'] = [{ wch: 18 }, { wch: 18 }, { wch: 10 }, { wch: 12 }, { wch: 20 }, { wch: 20 }, { wch: 18 }, { wch: 12 }, { wch: 28 }, { wch: 16 }, { wch: 42 }];
    XLSX.utils.book_append_sheet(workbook, sheet, 'Existencias');
    if (instructions?.length) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(instructions.map(line => [line])), 'Instrucciones');
    XLSX.writeFile(workbook, name);
  }

  function templateRows() {
    return [{ Estilo: 'ROD410', Color: 'NEGRO', Talla: '26.5', Cantidad: 1, Marca: '', 'Tipo de línea': '', Material: '', Precio: '', Notas: '', 'Crear producto': 'NO' }];
  }

  function unknownRows() {
    const rows = [...(bulkState?.validation.unknown || []), ...manualUnknown];
    return rows.map(row => ({
      Estilo: row.estilo, Color: row.color, Talla: row.talla, Cantidad: row.cantidad, Marca: row.marca || '', 'Tipo de línea': row.linea || '',
      Material: row.material || '', Precio: row.precio || '', Notas: row.notas || '', 'Crear producto': row.createProduct ? 'SI' : 'NO', Motivo: row.reason || 'No existe en el catálogo',
    }));
  }

  async function chooseBulkFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    byId('branchStockApplyFile').disabled = true;
    status('Comparando el archivo con el catálogo maestro…');
    try {
      bulkState = await parseBulkFile(file);
      renderBulkState();
      const creatable = creatableUnknownCount();
      status(`Archivo revisado: ${bulkState.validation.known.length} fila(s) encontradas, ${bulkState.validation.unknown.length} desconocidas${creatable ? ` y ${creatable} listas para creación autorizada` : ''}.`, bulkState.validation.unknown.length ? 'warn' : 'ok');
    } catch (error) {
      bulkState = null;
      event.target.value = '';
      renderBulkState();
      status(`No se pudo leer el archivo: ${error.message}`, 'warn');
    }
  }

  async function applyBulkFile() {
    if (!bulkState) return;
    const mode = document.querySelector('input[name="branchBulkMode"]:checked')?.value || 'set', allowCreate = byId('branchStockAllowCreate').checked;
    if (mode === 'add' && bulkState.rows.some(row => Number(row.cantidad) < 1)) return status('Para Sumar entrada, todas las cantidades deben ser al menos 1.', 'warn');
    const button = byId('branchStockApplyFile');
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    status('Aplicando existencias por sucursal…');
    try {
      const result = await cloud().applyBranchStock({ branchId: selectedBranchId(), rows: bulkState.rows, mode, allowCreate, sourceName: bulkState.fileName });
      const unknownMessage = result.unknown.length ? ` Quedaron ${result.unknown.length} fila(s) desconocidas sin aplicar.` : '';
      status(`Listo: ${result.appliedRows} talla(s) y ${result.appliedPairs} par(es) procesados en ${result.branch.name}.${result.createdProducts ? ` Se crearon ${result.createdProducts} producto(s) autorizados.` : ''}${unknownMessage}`, result.unknown.length ? 'warn' : 'ok');
      bulkState.validation = await cloud().validateBranchStockRows(bulkState.rows);
      renderBulkState();
    } catch (error) {
      status(error.message, 'warn');
      renderBulkState();
    } finally {
      button.removeAttribute('aria-busy');
    }
  }

  async function loadContext(force = false) {
    updateGate('Consultando sucursales y catálogo…');
    status('Consultando catálogo maestro…');
    try {
      context = await cloud().loadBranchStockContext(force);
      const eligible = context.branches.filter(branch => !isBaseBranch(branch));
      byId('branchStockBranch').innerHTML = eligible.length
        ? `<option value="">Selecciona una sucursal</option>${eligible.map(branch => `<option value="${esc(branch.id)}">${esc(branch.name)} (${esc(branch.code)})</option>`).join('')}`
        : '<option value="">No hay otra sucursal activa</option>';
      const remembered = localStorage.getItem(BRANCH_MEMORY_KEY);
      if (eligible.some(branch => branch.id === remembered)) byId('branchStockBranch').value = remembered;
      updateGate(eligible.length ? '' : 'La tienda base JUÁREZ no usa este buscador. Crea o activa otra sucursal en Supabase para habilitar la carga.', eligible.length);
      renderBulkState();
      status(eligible.length ? `Catálogo listo: ${context.products.length} fichas disponibles.` : 'No hay sucursales adicionales disponibles.', eligible.length ? 'ok' : 'warn');
    } catch (error) {
      context = null;
      byId('branchStockBranch').innerHTML = '<option value="">Inicia sesión para consultar sucursales</option>';
      updateGate(error.message);
      status(error.message, 'warn');
    }
  }

  function openDialog() {
    const dialog = byId('branchStockDialog');
    if (!dialog.open) dialog.showModal();
    loadContext(false);
  }
  function closeDialog() { byId('branchStockDialog').close(); }

  function renderRelationalInventory(results, query) {
    const panel = byId('relationalSearchPanel'), container = byId('relationalSearchResults'), info = byId('relationalSearchInfo');
    relationalInventoryResults = results;
    relationalInventoryQuery = query;
    panel.hidden = false;
    if (!results.length) {
      info.textContent = `Sin existencias relacionales para “${query}”.`;
      container.innerHTML = '<p class="muted">El buscador antiguo puede seguir mostrando registros pendientes de migración.</p>';
      return;
    }
    const pairs = results.reduce((sum, result) => sum + Number(result.totalQuantity || 0), 0);
    info.textContent = `${results.length} producto-sucursal · ${pairs} par(es) encontrados.`;
    const currency = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
    container.innerHTML = results.map(result => `<article class="relationalResultCard" data-relational-product-id="${esc(result.product.id)}"><div class="relationalResultTitle"><strong>${esc(result.product.estilo)} · ${esc(result.product.color)}</strong><span>${esc(currency.format(Number(result.product.precio || 0)))}</span></div><div class="relationalResultMeta"><span>${esc(result.product.marca || 'Sin marca')}</span><span>${esc(result.product.linea || result.product.acabado || 'Sin línea')}</span><span>${esc(result.branch.name)}</span><strong>${esc(result.totalQuantity)} par(es)</strong><span class="sazStatus ${result.sazRegistered ? 'isLoaded' : 'isPending'}">${result.sazRegistered ? 'Registrado en SAZ' : 'Pendiente de SAZ'}</span></div><div class="relationalProductActions"><button type="button" class="secondary" data-relational-price="${esc(result.product.id)}">Cambiar precio del estilo</button><small data-relational-notice="${esc(result.product.id)}">${esc(result.notice || 'El precio se aplicará a todos los colores del mismo estilo.')}</small></div><div class="relationalSizes">${result.sizes.map(item => `<span class="relationalSize">${esc(item.size)} × ${esc(item.quantity)}</span>`).join('')}</div><div class="relationalImage"><div class="relationalImagePreview">${result.imageUrl ? `<img src="${esc(result.imageUrl)}" alt="Producto ${esc(result.product.estilo)} ${esc(result.product.color)}">` : '<span>Sin imagen</span>'}</div><div class="relationalImageControls"><button type="button" data-relational-image="camera" data-product-id="${esc(result.product.id)}">Tomar foto</button><button type="button" class="secondary" data-relational-image="gallery" data-product-id="${esc(result.product.id)}">Elegir imagen</button><small data-relational-image-status="${esc(result.product.id)}">${esc(result.imageMessage || (result.imageUrl ? 'Imagen compartida entre ambos inventarios.' : 'PNG máximo 100 KB · aplica por estilo y color.'))}</small></div></div></article>`).join('');
    container.querySelectorAll('[data-relational-image]').forEach(button => button.addEventListener('click', () => {
      const result = relationalInventoryResults.find(item => item.product.id === button.dataset.productId);
      if (!result) return;
      relationalImageTarget = result;
      byId(button.dataset.relationalImage === 'camera' ? 'relationalProductImageCamera' : 'relationalProductImageGallery').click();
    }));
    container.querySelectorAll('[data-relational-price]').forEach(button => button.addEventListener('click', async () => {
      const result = relationalInventoryResults.find(item => item.product.id === button.dataset.relationalPrice);
      if (!result) return;
      const entered = window.prompt(`Nuevo precio para todo el estilo ${result.product.estilo}:`, String(result.product.precio || ''));
      if (entered === null) return;
      const precio = numericPrice(entered);
      if (!Number.isFinite(precio) || precio < 0) return window.alert('Escribe un precio válido.');
      button.disabled = true;
      try {
        const saved = await cloud().updateRelationalStylePrice(result.product.estilo, precio);
        const legacyUpdated = window.ClaremmStore?.applyStylePriceFromCloud?.(result.product.estilo, precio) || 0;
        for (const item of relationalInventoryResults.filter(item => normalized(item.product.estilo) === normalized(result.product.estilo))) {
          item.product.precio = precio;
          item.notice = `Precio actualizado en ${saved.updated} ficha(s) relacionales y ${legacyUpdated} registro(s) anteriores.`;
        }
        renderRelationalInventory(relationalInventoryResults, relationalInventoryQuery);
      } catch (error) {
        const notice = document.querySelector(`[data-relational-notice="${CSS.escape(result.product.id)}"]`);
        if (notice) notice.textContent = error.message;
        button.disabled = false;
      }
    }));
  }

  async function saveRelationalProductImage(file) {
    const target = relationalImageTarget;
    if (!target || !file) return;
    const card = document.querySelector(`[data-relational-product-id="${CSS.escape(target.product.id)}"]`), statusElement = card?.querySelector('[data-relational-image-status]');
    const buttons = [...(card?.querySelectorAll('[data-relational-image]') || [])];
    buttons.forEach(button => { button.disabled = true; });
    if (statusElement) statusElement.textContent = 'Comprimiendo imagen…';
    try {
      if (!file.type.startsWith('image/')) throw new Error('Selecciona un archivo de imagen.');
      if (!window.ClaremmStore?.compressProductImage) throw new Error('Actualiza la página para activar el compresor de imágenes.');
      const blob = await window.ClaremmStore.compressProductImage(file);
      if (statusElement) statusElement.textContent = 'Guardando en Supabase…';
      const saved = await cloud().uploadRelationalProductImage({ productId: target.product.id, blob });
      await window.ClaremmStore.putImageFromCloud(saved.fileName, blob).catch(() => {});
      cloud().recordImageMutation?.({ type: 'upsert', name: saved.fileName });
      await window.ClaremmStore.refreshImageIndicators?.();
      for (const result of relationalInventoryResults.filter(item => item.product.id === target.product.id)) {
        result.product.imagen = saved.path;
        result.imageUrl = saved.imageUrl;
        result.imageMessage = `Imagen compartida en ambos inventarios · ${(saved.size / 1024).toFixed(1)} KB`;
      }
      renderRelationalInventory(relationalInventoryResults, relationalInventoryQuery);
    } catch (error) {
      if (statusElement) statusElement.textContent = error.message;
      buttons.forEach(button => { button.disabled = false; });
    } finally {
      byId('relationalProductImageCamera').value = '';
      byId('relationalProductImageGallery').value = '';
      relationalImageTarget = null;
    }
  }

  async function searchRelationalInventory() {
    const input = byId('inventorySearch'), panel = byId('relationalSearchPanel'), query = input.value.trim();
    if (!query) {
      panel.hidden = true;
      byId('relationalSearchResults').innerHTML = '';
      return;
    }
    const sequence = ++inventorySearchSequence, scope = byId('inventorySearchScope').value, sazFilter = byId('inventorySazFilter').value;
    panel.hidden = false;
    byId('relationalSearchInfo').textContent = 'Buscando en catálogo y existencias por sucursal…';
    byId('relationalSearchResults').innerHTML = '';
    try {
      if (!cloud()?.searchRelationalInventory) throw new Error('Actualiza la página para activar la búsqueda relacional.');
      const results = await cloud().searchRelationalInventory(query, scope, sazFilter);
      if (sequence !== inventorySearchSequence) return;
      renderRelationalInventory(results, query);
    } catch (error) {
      if (sequence !== inventorySearchSequence) return;
      byId('relationalSearchInfo').textContent = error.message;
      byId('relationalSearchResults').innerHTML = '<p class="muted">Inicia sesión y pulsa Sincronizar ahora para consultar Supabase.</p>';
    }
  }

  function queueRelationalInventorySearch() {
    clearTimeout(inventorySearchTimer);
    inventorySearchTimer = setTimeout(searchRelationalInventory, 300);
  }

  byId('branchStockOpen').addEventListener('click', openDialog);
  byId('branchStockClose').addEventListener('click', closeDialog);
  byId('branchStockDialog').addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
  byId('branchStockBranch').addEventListener('change', () => {
    if (selectedBranchId()) localStorage.setItem(BRANCH_MEMORY_KEY, selectedBranchId());
    renderBulkState();
  });
  byId('branchStockStyle').addEventListener('input', queueSearch);
  byId('branchStockColor').addEventListener('input', queueSearch);
  byId('branchStockSaveOne').addEventListener('click', saveManual);
  byId('branchStockQueueUnknown').addEventListener('click', queueUnknownManual);
  byId('branchStockTemplate').addEventListener('click', () => workbookDownload(templateRows(), 'CLAREMM_Plantilla_Existencias_Sucursal.xlsx', [
    'Una fila representa una talla de un estilo y color.', 'La sucursal se selecciona dentro de CLAREMM Scan y se aplica a todo el archivo.',
    'Establecer cantidades reemplaza solamente las variantes incluidas; Sumar entrada agrega la cantidad al stock actual.',
    'Para crear un producto desconocido completa Marca, Tipo de línea y Material, escribe SI en Crear producto y autoriza la creación dentro de la app.',
  ]));
  byId('branchStockChooseFile').addEventListener('click', () => byId('branchStockFile').click());
  byId('branchStockFile').addEventListener('change', chooseBulkFile);
  byId('branchStockReload').addEventListener('click', async () => {
    await loadContext(true);
    if (bulkState) {
      bulkState.validation = await cloud().validateBranchStockRows(bulkState.rows);
      renderBulkState();
    }
  });
  byId('branchStockDownloadUnknown').addEventListener('click', () => workbookDownload(unknownRows(), 'CLAREMM_Productos_Desconocidos.xlsx', [
    'Completa Marca, Tipo de línea y Material para cada producto que quieras crear.', 'Cambia Crear producto a SI solo después de revisar el estilo y color.',
    'Vuelve a cargar este mismo archivo en Carga por sucursal y activa Crear productos desconocidos autorizados.', 'Las filas ambiguas deben revisarse; el importador no crea duplicados automáticamente.',
  ]));
  byId('branchStockAllowCreate').addEventListener('change', renderBulkState);
  byId('branchStockApplyFile').addEventListener('click', applyBulkFile);
  byId('inventorySearch').addEventListener('input', queueRelationalInventorySearch);
  byId('inventorySearchScope').addEventListener('change', queueRelationalInventorySearch);
  byId('inventorySazFilter').addEventListener('change', queueRelationalInventorySearch);
  byId('relationalProductImageCamera').addEventListener('change', event => saveRelationalProductImage(event.target.files?.[0]));
  byId('relationalProductImageGallery').addEventListener('change', event => saveRelationalProductImage(event.target.files?.[0]));
  document.addEventListener('claremm-cloud-session', event => {
    if (!event.detail?.signedIn && byId('branchStockDialog').open) loadContext(false);
    if (event.detail?.signedIn && byId('inventorySearch').value.trim()) queueRelationalInventorySearch();
  });
  renderBulkState();
})();
