/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V4 · module: branch inventory · genre: modern-minimal · theme: existing CLAREMM tokens */
'use strict';

(() => {
  const BASE_BRANCH_CODE = 'JUAREZ';
  const BASE_BRANCH_NAME = 'CLAREMM ZAPATERIA JUAREZ';
  const BRANCH_MEMORY_KEY = 'claremmscan-branch-stock-target-v1';
  const byId = id => document.getElementById(id);
  const text = value => String(value ?? '').trim();
  const normalized = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ');
  const compactEstilo = value => normalized(value).replace(/\s+/g, '').replace(/^0+(?=\d)/, '');
  const catalogCorrida = value => normalized(value).replace(/[–—]/g, '-').replace(/\s+/g, '').replace(/(\d+)\.0(?!\d)/g, '$1');
  const matchesStyleCorrida = (product, estilo, corrida) => compactEstilo(product.estilo) === compactEstilo(estilo) && catalogCorrida(product.corrida) === catalogCorrida(corrida);
  const corridaContainsSize = (corrida, size) => {
    const match = catalogCorrida(corrida).match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
    const value = Number(String(size).replace(',', '.'));
    return Boolean(match) && Number.isFinite(value) && value >= Number(match[1]) && value <= Number(match[2]);
  };
  const resolveReviewCorrida = (review, results) => {
    if (catalogCorrida(review?.corrida)) return review.corrida;
    const ofStyle = (results || []).filter(result => compactEstilo(result.product.estilo) === compactEstilo(review?.estilo));
    if (review?.talla) {
      const bySize = ofStyle.filter(result => corridaContainsSize(result.product.corrida, review.talla) || (result.sizes || []).some(item => Number(item.size) === Number(review.talla)));
      const unique = [...new Set(bySize.map(result => catalogCorrida(result.product.corrida)))];
      if (unique.length === 1) return bySize[0].product.corrida;
    }
    const unique = [...new Set(ofStyle.map(result => catalogCorrida(result.product.corrida)))];
    if (unique.length === 1) return ofStyle[0].product.corrida;
    return ofStyle[0]?.product.corrida || '';
  };
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
  let prepHydrateSequence = 0;
  let relationalInventoryResults = [];
  let relationalInventoryQuery = '';
  let relationalImageTarget = null;
  let relationalEdit = null;
  let stylePriceReview = null;
  let inventoryPhotoBusy = false;
  let productDuplicate = null;
  let productDuplicatePhoto = null;
  let productDuplicateSaving = false;
  let recentStockRows = [];
  let recentImageTarget = null;
  const localImagePreview = new Map();
  const FICHA_FIELDS = [
    { key: 'precio', label: 'Precio de venta' },
    { key: 'marca', label: 'Marca' },
    { key: 'proveedor', label: 'Proveedor' },
    { key: 'temporada', label: 'Temporada' },
    { key: 'sublinea', label: 'Sublinea' },
    { key: 'departamento', label: 'Departamento' },
    { key: 'clasificacion', label: 'Clasificacion' },
    { key: 'linea', label: 'Linea' },
    { key: 'corrida', label: 'Corrida de tallas' },
    { key: 'acabado', label: 'Material/Acabado' },
  ];
  const currency = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
  const isNuevoFicha = (product, totalQuantity = 0, imageUrl = '') => !text(product?.imagen) && !text(imageUrl) && !(Number(product?.precio) > 0) && !(Number(totalQuantity) > 0);

  function setRelationalPreview(active) {
    byId('inventoryCard')?.classList.toggle('isRelationalPreview', Boolean(active));
  }

  function juarezBranch() {
    return (context?.branches || []).find(branch => normalized(branch.code) === BASE_BRANCH_CODE || normalized(branch.name) === normalized(BASE_BRANCH_NAME))
      || { id: '61d4f1c7-db48-426d-a64e-64dfb3e3d1df', code: BASE_BRANCH_CODE, name: BASE_BRANCH_NAME };
  }

  function isPrepFilter() {
    return byId('inventorySazFilter')?.value === 'prep';
  }

  function isLocalFichaId(id) {
    return text(id).startsWith('local:');
  }

  function keepCardPagination() {
    return Boolean(byId('inventoryCard')?.classList.contains('isPrepCards'));
  }

  function withLocalPreview(result) {
    if (!result?.product) return result;
    const preview = localImagePreview.get(result.product.id);
    if (preview?.url) {
      result.imageUrl = result.imageUrl || preview.url;
      if (preview.path && !text(result.product.imagen)) result.product.imagen = preview.path;
    }
    return result;
  }

  function proposedPriceFor(product) {
    const proposed = text(stylePriceReview?.precio);
    if (!proposed || !product) return '';
    return matchesStyleCorrida(product, stylePriceReview.estilo, stylePriceReview.corrida) ? proposed : '';
  }

  function fieldValue(product, key) {
    if (key === 'precio') {
      const proposed = proposedPriceFor(product);
      return currency.format(Number((proposed || product.precio) || 0));
    }
    return text(product[key]) || '—';
  }

  function fichaMarkup(product, productId) {
    return FICHA_FIELDS.map(field => {
      const editing = relationalEdit?.productId === productId && relationalEdit.field === field.key;
      const proposed = field.key === 'precio' ? proposedPriceFor(product) : '';
      const value = field.key === 'precio' ? String(proposed || product.precio || '') : text(product[field.key]);
      const body = editing
        ? `<input data-edit-input="${esc(field.key)}" value="${esc(value)}" inputmode="${field.key === 'precio' ? 'decimal' : 'text'}" aria-label="${esc(field.label)}"${window.ClaremmSazCatalog?.datalistId?.(field.key) ? ` list="${esc(window.ClaremmSazCatalog.datalistId(field.key))}"` : ''}>`
        : `<button type="button" data-edit-field="${esc(field.key)}"${field.key === 'precio' ? ` data-relational-price="${esc(productId)}"` : ''}>${esc(fieldValue(product, field.key))}</button>`;
      return `<div class="relationalField${editing ? ' isEditing' : ''}${proposed ? ' isProposed' : ''}" data-field="${esc(field.key)}"><dt>${esc(field.label)}</dt><dd>${body}</dd></div>`;
    }).join('');
  }

  function cardMarkup(result) {
    const product = result.product, productId = product.id;
    const lineage = [text(product.linea) || 'Sin línea', text(product.corrida) || 'Sin corrida'];
    const proposed = proposedPriceFor(product);
    const priceLabel = proposed
      ? `<span class="priceShift">${esc(currency.format(Number(product.precio || 0)))} → ${esc(currency.format(Number(proposed)))}</span>`
      : `<span>${esc(currency.format(Number(product.precio || 0)))}</span>`;
    const notice = proposed
      ? 'Precio precargado desde la foto. Revisa y confirma arriba para aplicarlo a los colores de este estilo y corrida.'
      : (result.notice || 'Toca un dato para editarlo en la ficha. El precio se aplica a los colores del mismo estilo y la misma corrida.');
    const sazClass = result.sazStockAuditPending ? 'isPending' : result.sazRegistered ? 'isLoaded' : result.sazPreloaded ? 'isPreloaded' : 'isPending';
    const sazLabel = result.sazPreloadedWithoutStock ? 'Precargado sin stock'
      : result.sazStockAuditPending ? 'Pendiente en SAZ'
      : result.sazRegistered ? 'Registrado en SAZ'
      : result.sazPreloaded ? 'Ya precargado en SAZ' : 'Pendiente de SAZ';
    const branchStocks = result.branchStocks?.length
      ? result.branchStocks
      : (result.branch ? [{ branch: result.branch, sizes: result.sizes || [], totalQuantity: result.totalQuantity || 0 }] : []);
    const totalQuantity = Number(result.totalQuantity || 0) || branchStocks.reduce((sum, stock) => sum + Number(stock.totalQuantity || 0), 0);
    const isNew = isNuevoFicha(product, totalQuantity, result.imageUrl);
    const preloadedNotice = isNew
      ? 'Ficha nueva: sin existencia en sucursales, sin foto y sin precio. Tómale foto y captura el precio para el encargado.'
      : result.sazPreloaded && !proposed
      ? 'Recuperado de un SAZ antiguo. El precio puede estar desactualizado; revísalo antes de usarlo.'
      : notice;
    const branchMeta = branchStocks.map(stock => `<span class="relationalBranchStock">${esc(stock.branch.name)} <strong>${esc(stock.totalQuantity)} par(es)</strong></span>`).join('');
    const sizeChips = branchStocks.flatMap(stock => (stock.sizes || []).map(item => {
      const branchTag = branchStocks.length > 1 ? ` · ${esc(stock.branch.code || stock.branch.name)}` : '';
      return `<span class="relationalSize">${esc(item.size)} × ${esc(item.quantity)}${branchTag}</span>`;
    })).join('');
    const nuevoTag = isNew ? '<span class="sazStatus isNew">NUEVO</span>' : '';
    return `<article class="relationalResultCard${result.sazPreloaded ? ' isPreloaded' : ''}${isNew ? ' isNew' : ''}" data-relational-product-id="${esc(productId)}" data-relational-branch-id="${esc(result.branch?.id || '')}">
      <div class="relationalResultTitle"><strong>${esc(product.estilo)} · ${esc(product.color)}</strong>${priceLabel}</div>
      <p class="relationalLineage"><span>${esc(lineage[0])}</span><span>${esc(lineage[1])}</span></p>
      <div class="relationalResultMeta"><span>${esc(product.marca || 'Sin marca')}</span>${branchMeta}${nuevoTag}<span class="sazStatus ${sazClass}">${sazLabel}</span></div>
      <dl class="relationalFicha">${fichaMarkup(product, productId)}</dl>
      <small class="relationalEditHint" data-relational-notice="${esc(productId)}">${esc(preloadedNotice)}</small>
      <div class="relationalProductActions"><button type="button" class="secondary" data-relational-duplicate="${esc(productId)}">Duplicar ficha</button></div>
      <div class="relationalSizes">${sizeChips}</div>
      <div class="relationalImage"><div class="relationalImagePreview">${result.imageUrl ? `<button type="button" class="imageThumb" data-image-preview="${esc(result.imageUrl)}" aria-label="Ver foto grande de ${esc(product.estilo)} ${esc(product.color)}"><img src="${esc(result.imageUrl)}" alt="Producto ${esc(product.estilo)} ${esc(product.color)}"></button>` : '<span>Sin imagen</span>'}</div><div class="relationalImageControls"><button type="button" data-relational-image="camera" data-product-id="${esc(productId)}">Tomar foto</button><button type="button" class="secondary" data-relational-image="gallery" data-product-id="${esc(productId)}">Elegir imagen</button><small data-relational-image-status="${esc(productId)}">${esc(result.imageMessage || (result.imageUrl ? 'Imagen compartida entre ambos inventarios.' : 'PNG máximo 100 KB · aplica por estilo y color.'))}</small></div></div>
    </article>`;
  }

  function status(message, kind = '') {
    const element = byId('branchStockStatus');
    element.textContent = message;
    element.className = `branchStockStatus ${kind}`.trim();
  }

  function selectedBranchId() {
    return byId('branchStockBranch').value;
  }

  function selectedBranch() {
    return (context?.branches || []).find(branch => branch.id === selectedBranchId()) || null;
  }

  function renderBranchProtection() {
    const note = byId('branchStockProtection');
    if (!note) return;
    const juarez = isBaseBranch(selectedBranch());
    note.hidden = !juarez;
    note.textContent = juarez
      ? 'Protección JUÁREZ activa: puedes agregar tallas o ajustar cantidades hacia arriba. Cualquier intento de reducir existencias se omite y queda reportado.'
      : '';
  }

  function renderRecentStock(rows, message = '') {
    const list = byId('branchStockRecentList');
    if (!list) return;
    if (message) {
      recentStockRows = [];
      list.innerHTML = `<li class="branchStockRecentItem"><strong>${esc(message)}</strong></li>`;
      return;
    }
    recentStockRows = Array.isArray(rows) ? rows : [];
    if (!recentStockRows.length) {
      list.innerHTML = '<li class="branchStockRecentItem"><strong>Aún no hay existencias registradas en esta sucursal.</strong></li>';
      return;
    }
    const ordered = [...recentStockRows].sort((left, right) => Number(Boolean(text(left.imagen))) - Number(Boolean(text(right.imagen))));
    list.innerHTML = ordered.map(row => {
      const isNew = isNuevoFicha(row, row.sizes?.length ? 1 : 0);
      const missingImage = !text(row.imagen);
      const key = esc(row.id || `${row.estilo}|${row.color}`);
      const photoButtons = missingImage
        ? `<div class="branchStockRecentActions"><button type="button" data-recent-image="camera" data-recent-id="${key}">Tomar foto</button><button type="button" class="secondary" data-recent-image="gallery" data-recent-id="${key}">Elegir imagen</button><small data-recent-image-status="${key}">PNG máximo 100 KB</small></div>`
        : '';
      return `<li class="branchStockRecentItem${isNew ? ' isNew' : ''}${missingImage ? ' noImage' : ''}" data-recent-id="${key}"><strong>${esc(row.estilo)} · ${esc(row.color)}${missingImage ? ' <span class="sazStatus isMissingImage">Sin foto</span>' : ''}${isNew ? ' <span class="sazStatus isNew">NUEVO</span>' : ''}</strong><span class="branchStockRecentSizes">${esc((row.sizes || []).join(', ') || 'Sin talla')}</span>${photoButtons}</li>`;
    }).join('');
  }

  function recentRowById(id) {
    return recentStockRows.find(row => (row.id || `${row.estilo}|${row.color}`) === id);
  }

  async function saveRecentProductImage(file) {
    if (!file) return;
    const target = recentImageTarget;
    if (!target) return;
    const row = recentRowById(target);
    const item = document.querySelector(`[data-recent-id="${CSS.escape(target)}"]`);
    const statusElement = item?.querySelector('[data-recent-image-status]');
    const buttons = [...(item?.querySelectorAll('[data-recent-image]') || [])];
    try {
      if (!row?.id) throw new Error('No se identificó la ficha para guardar la foto.');
      const snapshot = window.ClaremmStore?.snapshotImageFile ? await window.ClaremmStore.snapshotImageFile(file) : file;
      if (window.ClaremmStore?.isImageFile && !window.ClaremmStore.isImageFile(snapshot)) throw new Error('Selecciona un archivo de imagen.');
      if (!window.ClaremmStore?.compressProductImage) throw new Error('Actualiza la página para activar el compresor de imágenes.');
      if (!cloud()?.uploadRelationalProductImage) throw new Error('Actualiza la página para subir la foto desde el historial.');
      buttons.forEach(button => { button.disabled = true; });
      if (statusElement) statusElement.textContent = 'Comprimiendo imagen…';
      const blob = await window.ClaremmStore.compressProductImage(snapshot);
      if (statusElement) statusElement.textContent = 'Guardando en Supabase…';
      const saved = await cloud().uploadRelationalProductImage({ productId: row.id, blob });
      await window.ClaremmStore.putImageFromCloud(saved.fileName, blob).catch(() => {});
      await window.ClaremmStore.refreshImageIndicators?.({ silent: true });
      row.imagen = saved.path || saved.fileName || '1';
      renderRecentStock(recentStockRows);
      status(`Foto guardada en ${row.estilo} · ${row.color}.`, 'ok');
    } catch (error) {
      if (statusElement) statusElement.textContent = error.message;
      buttons.forEach(button => { button.disabled = false; });
      status(error.message, 'warn');
    } finally {
      byId('branchRecentImageCamera').value = '';
      byId('branchRecentImageGallery').value = '';
      recentImageTarget = null;
    }
  }

  async function refreshRecentStock() {
    const list = byId('branchStockRecentList');
    if (!list) return;
    const branchId = selectedBranchId();
    if (!branchId) {
      renderRecentStock([], 'Selecciona una sucursal para ver lo último registrado.');
      return;
    }
    if (!cloud()?.listRecentBranchStock) {
      renderRecentStock([], 'Actualiza la página para ver las últimas existencias.');
      return;
    }
    renderRecentStock([], 'Cargando últimas existencias…');
    try {
      const rows = await cloud().listRecentBranchStock(branchId, 100);
      renderRecentStock(rows);
    } catch (error) {
      renderRecentStock([], error.message || 'No se pudieron leer las últimas existencias.');
    }
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
    container.innerHTML = products.map((product, index) => {
      const isNew = isNuevoFicha(product, product.totalQuantity);
      return `<button type="button" class="catalogResult${isNew ? ' isNew' : ''}" data-product-index="${index}"><span><strong>${esc(product.estilo)} · ${esc(product.color)}${isNew ? ' <span class="sazStatus isNew">NUEVO</span>' : ''}</strong><small>${esc([product.marca, product.linea, product.acabado].filter(Boolean).join(' · ') || 'Sin datos adicionales')}</small></span><span class="catalogResultMark">${product.sizes?.length || 0} talla(s)</span></button>`;
    }).join('');
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
    const planned = window.ClaremmInventorySearch?.plan?.(style || query);
    if (planned?.wait) return renderSearchResults([]);
    const sequence = ++searchSequence;
    byId('branchCatalogResults').innerHTML = '<small>Buscando en el catálogo…</small>';
    try {
      const products = await cloud().searchBranchCatalog(query);
      if (sequence !== searchSequence) return;
      const folded = value => normalized(value).replace(/[\/\-_,+|.]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).sort().join(' ');
      const saz = window.ClaremmSazCatalog;
      const exact = products.filter(product => {
      const styleOk = !style || compactEstilo(product.estilo) === compactEstilo(style) || (planned?.mode !== 'exact-estilo' && normalized(product.estilo).includes(normalized(style)));
      const colorOk = !color
        || saz?.matches?.('color', product.color, color)
        || folded(product.color) === folded(color)
        || normalized(product.color).includes(normalized(color))
        || normalized(color).includes(normalized(product.color).replace(/[\/\-]/g, ' '));
      return styleOk && colorOk;
    });
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
      productId: product?.id || '', estilo: normalized(byId('branchStockStyle').value), color: window.ClaremmSazCatalog?.resolve?.('color', byId('branchStockColor').value) || normalized(byId('branchStockColor').value),
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
      if (!result.appliedRows && result.protectedRows?.length) {
        status(result.protectedRows[0].reason || 'JUÁREZ no permite reducir existencias.', 'warn');
        button.disabled = false;
        return;
      }
      if (!result.appliedRows && result.unchangedRows?.length) {
        status(result.unchangedRows[0].reason || 'La existencia ya tenía esa cantidad.', 'ok');
        button.disabled = false;
        return;
      }
      status(`Guardado: ${row.estilo} · ${row.color} · talla ${row.talla} en ${result.branch.name}.`, 'ok');
      resetManual();
      refreshRecentStock();
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
    marca: ['marca', 'brand'], linea: ['linea', 'tipodelinea', 'tipolinea', 'tipodelcalzado', 'categoria', 'line'], material: ['material', 'acabado', 'sintetico'], precio: ['precio', 'price'],
    notas: ['notas', 'nota', 'observaciones', 'notes'], createProduct: ['crearproducto', 'crearproductos', 'crear', 'accion', 'action'],
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
      estilo: normalized(valueByAliases(indexed, HEADER_ALIASES.estilo)), color: window.ClaremmSazCatalog?.resolve?.('color', valueByAliases(indexed, HEADER_ALIASES.color)) || normalized(valueByAliases(indexed, HEADER_ALIASES.color)),
      talla: normalizedSize(valueByAliases(indexed, HEADER_ALIASES.talla)), cantidad: Number(quantityValue), quantityPresent: text(quantityValue) !== '',
      marca: normalized(valueByAliases(indexed, HEADER_ALIASES.marca)), linea: normalized(valueByAliases(indexed, HEADER_ALIASES.linea)),
      material: normalized(valueByAliases(indexed, HEADER_ALIASES.material)), precio: text(valueByAliases(indexed, HEADER_ALIASES.precio)).replace(/[^0-9.-]/g, ''),
      notas: text(valueByAliases(indexed, HEADER_ALIASES.notas)), createProduct: ['SI', 'YES', 'TRUE', '1', 'CREAR', 'OK', 'X'].includes(createValue),
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
    return (bulkState?.validation.unknown || []).filter(row => row.willCreate).length;
  }

  function unknownHelpText() {
    const unknown = bulkState?.validation.unknown || [];
    if (!unknown.length && !manualUnknown.length) return '';
    const creatable = unknown.filter(row => row.willCreate).length;
    const missing = unknown.filter(row => row.canCreate && !row.willCreate);
    const estiloHits = unknown.filter(row => row.estiloExists).length;
    if (creatable) {
      return `Hay ${unknown.length} ficha(s) sin color exacto. ${creatable} se pueden crear con los datos del mismo estilo. Activa “Crear productos desconocidos autorizados” y aplica el archivo.`;
    }
    if (estiloHits) {
      return `Hay ${unknown.length} color(es) nuevos de estilos que sí existen. Activa la casilla de creación para darlos de alta copiando marca, línea y material del estilo.`;
    }
    if (missing.length) {
      const sample = missing.slice(0, 3).map(row => `${row.estilo} ${row.color}${row.missingFields?.length ? ` (falta ${row.missingFields.join(', ')})` : ''}`).join('; ');
      return `Hay productos desconocidos incompletos. Completa Marca, Tipo de línea y Material, o deja Crear=SI. Ejemplo: ${sample}.`;
    }
    return 'Hay productos desconocidos. Descarga el Excel, completa Marca, Tipo de línea y Material, cambia “Crear producto” a SI y vuelve a cargarlo.';
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
    const help = byId('branchStockUnknownHelp');
    if (help) help.textContent = unknownHelpText() || 'Hay productos desconocidos. Descarga el Excel, completa Marca, Tipo de línea y Material, cambia “Crear producto” a SI y vuelve a cargarlo.';
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
      Material: row.material || '', Precio: row.precio || '', Notas: row.notas || '', 'Crear producto': row.willCreate || row.createProduct ? 'SI' : 'NO', Motivo: row.reason || 'No existe en el catálogo',
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
      const blocked = (bulkState.validation.unknown || []).filter(row => !row.willCreate);
      const blockedNote = blocked.length ? ` ${blocked.length} aún no se pueden crear: ${blocked.slice(0, 3).map(row => `${row.estilo} ${row.color}`).join(', ')}.` : '';
      status(`Archivo revisado: ${bulkState.validation.known.length} fila(s) encontradas, ${bulkState.validation.unknown.length} desconocidas${creatable ? ` y ${creatable} listas para creación autorizada` : ''}.${blockedNote}`, bulkState.validation.unknown.length ? 'warn' : 'ok');
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
      const leftover = (result.unknown || []).map(row => `${row.estilo} ${row.color}${row.reason ? ` (${row.reason})` : ''}`).slice(0, 6);
      const unknownMessage = result.unknown.length ? ` Quedaron ${result.unknown.length} fila(s) sin aplicar${leftover.length ? `: ${leftover.join('; ')}` : ''}.` : '';
      const protectedMessage = result.protectedRows?.length ? ` Protección JUÁREZ omitió ${result.protectedRows.length} reducción(es).` : '';
      const unchangedMessage = result.unchangedRows?.length ? ` ${result.unchangedRows.length} talla(s) ya tenían esa cantidad.` : '';
      status(`Listo: ${result.appliedRows} talla(s) y ${result.appliedPairs} par(es) ajustados en ${result.branch.name}.${result.createdProducts ? ` Se crearon ${result.createdProducts} producto(s) autorizados.` : ''}${protectedMessage}${unchangedMessage}${unknownMessage}`, result.unknown.length || result.protectedRows?.length ? 'warn' : 'ok');
      bulkState.validation = await cloud().validateBranchStockRows(bulkState.rows);
      renderBulkState();
      refreshRecentStock();
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
      const eligible = context.branches;
      byId('branchStockBranch').innerHTML = eligible.length
        ? `<option value="">Selecciona una sucursal</option>${eligible.map(branch => `<option value="${esc(branch.id)}">${esc(branch.name)} (${esc(branch.code)})</option>`).join('')}`
        : '<option value="">No hay sucursales activas</option>';
      const remembered = localStorage.getItem(BRANCH_MEMORY_KEY);
      if (eligible.some(branch => branch.id === remembered)) byId('branchStockBranch').value = remembered;
      updateGate(eligible.length ? '' : 'Crea o activa una sucursal en Supabase para habilitar la carga.', eligible.length);
      renderBranchProtection();
      renderBulkState();
      status(eligible.length ? 'Sucursales listas. En JUÁREZ solo se permiten ajustes que conserven o aumenten existencias.' : 'No hay sucursales disponibles.', eligible.length ? 'ok' : 'warn');
      refreshRecentStock();
    } catch (error) {
      context = null;
      byId('branchStockBranch').innerHTML = '<option value="">Inicia sesión para consultar sucursales</option>';
      updateGate(error.message);
      status(error.message, 'warn');
      renderRecentStock([], error.message);
    }
  }

  function openDialog() {
    const dialog = byId('branchStockDialog');
    if (!dialog.open) dialog.showModal();
    loadContext(false);
  }
  function closeDialog() { byId('branchStockDialog').close(); }

  function renderStylePriceReview() {
    const box = byId('stylePriceReview');
    if (!box) return;
    if (!stylePriceReview) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    const colors = new Set(relationalInventoryResults.filter(result => matchesStyleCorrida(result.product, stylePriceReview.estilo, stylePriceReview.corrida)).map(result => result.product.color));
    const info = byId('stylePriceReviewInfo');
    const proposal = byId('stylePriceProposal');
    const corridaLabel = text(stylePriceReview.corrida) || 'sin corrida';
    if (info) {
      info.textContent = stylePriceReview.precio
        ? `Estilo ${stylePriceReview.estilo} · corrida ${corridaLabel}: el precio se precargó en ${Math.max(colors.size, 1)} color(es). Confirma para guardarlo solo en esa corrida.`
        : `Estilo ${stylePriceReview.estilo} · corrida ${corridaLabel}. No se leyó precio en la foto; escríbelo y confirma para aplicarlo a esa corrida.`;
    }
    if (proposal && document.activeElement !== proposal) proposal.value = stylePriceReview.precio || '';
  }

  function duplicateImageName() {
    const estilo = normalized(productDuplicate?.source?.estilo).replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');
    const color = normalized(byId('productDuplicateColor')?.value || productDuplicate?.color).replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');
    return estilo && color ? `${estilo}-${color}.png` : '';
  }

  function duplicateHint() {
    if (!productDuplicate) return 'Mismo estilo, otro color. Ajusta corrida, precio, talla y foto.';
    const sameRun = catalogCorrida(byId('productDuplicateCorrida')?.value) === catalogCorrida(productDuplicate.source.corrida);
    return sameRun
      ? `Duplicando ${productDuplicate.source.estilo} · ${productDuplicate.source.color}. Si dejas la misma corrida, el precio se aplica a todos los colores de ese estilo y corrida.`
      : `Duplicando ${productDuplicate.source.estilo} · ${productDuplicate.source.color}. Corrida distinta: el precio queda en este grupo de estilo y corrida.`;
  }

  function renderProductDuplicate() {
    const box = byId('productDuplicate');
    if (!box) return;
    if (!productDuplicate) {
      box.hidden = true;
      productDuplicatePhoto = null;
      if (byId('productDuplicateCameraFile')) byId('productDuplicateCameraFile').value = '';
      if (byId('productDuplicateGalleryFile')) byId('productDuplicateGalleryFile').value = '';
      return;
    }
    box.hidden = false;
    const source = productDuplicate.source;
    if (byId('productDuplicateEstilo')) byId('productDuplicateEstilo').value = source.estilo || '';
    if (byId('productDuplicateColor') && document.activeElement !== byId('productDuplicateColor')) byId('productDuplicateColor').value = productDuplicate.color || '';
    if (byId('productDuplicateCorrida') && document.activeElement !== byId('productDuplicateCorrida')) byId('productDuplicateCorrida').value = productDuplicate.corrida || source.corrida || '';
    if (byId('productDuplicatePrecio') && document.activeElement !== byId('productDuplicatePrecio')) byId('productDuplicatePrecio').value = productDuplicate.precio ?? source.precio ?? '';
    if (byId('productDuplicateTalla') && document.activeElement !== byId('productDuplicateTalla')) byId('productDuplicateTalla').value = productDuplicate.talla || '';
    if (byId('productDuplicateCantidad') && document.activeElement !== byId('productDuplicateCantidad')) byId('productDuplicateCantidad').value = productDuplicate.cantidad || '1';
    if (byId('productDuplicateInfo')) byId('productDuplicateInfo').textContent = duplicateHint();
    if (byId('productDuplicatePhotoInfo')) {
      const fileName = duplicateImageName();
      byId('productDuplicatePhotoInfo').textContent = productDuplicatePhoto
        ? `Foto lista. Se guardará como ${fileName || 'ESTILO-COLOR.png'} (máximo 100 KB), solo en este color.`
        : fileName
          ? `Sin foto. Si tomas una, se guardará como ${fileName}. La imagen original no se copia.`
          : 'Sin foto. Escribe el color para nombrar la imagen estilo-color. La original no se copia.';
    }
  }

  function openProductDuplicate(productId) {
    const result = findRelationalResult(productId);
    if (!result) return;
    productDuplicate = {
      sourceId: productId,
      source: result.product,
      color: '',
      corrida: result.product.corrida || '',
      precio: result.product.precio || '',
      talla: result.sizes?.[0]?.size || '',
      cantidad: '1',
    };
    productDuplicatePhoto = null;
    renderProductDuplicate();
    byId('productDuplicate')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function cancelProductDuplicate() {
    productDuplicate = null;
    renderProductDuplicate();
  }

  async function saveProductDuplicate() {
    if (!productDuplicate || inventoryPhotoBusy || productDuplicateSaving) return;
    const color = window.ClaremmSazCatalog?.resolve?.('color', byId('productDuplicateColor').value) || text(byId('productDuplicateColor').value);
    const corrida = window.ClaremmSazCatalog?.resolve?.('corrida', byId('productDuplicateCorrida').value) || text(byId('productDuplicateCorrida').value);
    const precio = text(byId('productDuplicatePrecio').value);
    const talla = text(byId('productDuplicateTalla').value);
    const cantidad = text(byId('productDuplicateCantidad').value) || '1';
    if (!cloud()?.duplicateRelationalProduct) return alert('Actualiza la página para duplicar fichas.');
    const info = byId('productDuplicateInfo');
    if (!color) return alert('Escribe el color de la nueva ficha.');
    if (normalized(color) === normalized(productDuplicate.source.color)) return alert('Cambia el color. Ese estilo y color ya está en esta ficha.');
    if (!corrida) return alert('Escribe la corrida a la que va a pertenecer.');
    if (!validSize(talla)) return alert('Escribe una talla válida.');
    if (!validQuantity(cantidad, 'add')) return alert('La cantidad debe ser un entero de al menos 1.');
    if (!Number.isFinite(numericPrice(precio)) || numericPrice(precio) < 0) return alert('Escribe un precio válido. Si es otra corrida, ajústalo aquí.');
    productDuplicateSaving = true;
    if (info) info.textContent = 'Guardando ficha duplicada…';
    try {
      let blob = null;
      if (productDuplicatePhoto) {
        if (!window.ClaremmStore?.compressProductImage) throw new Error('Actualiza la página para comprimir la foto.');
        blob = await window.ClaremmStore.compressProductImage(productDuplicatePhoto);
      }
      const payload = { productId: productDuplicate.sourceId, color, precio, corrida, size: talla, quantity: cantidad };
      if (blob) payload.blob = blob;
      const saved = await cloud().duplicateRelationalProduct(payload);
      if (blob && saved.fileName) {
        await window.ClaremmStore.putImageFromCloud?.(saved.fileName, blob).catch(() => {});
      }
      if (blob) await window.ClaremmStore.refreshImageIndicators?.();
      const result = {
        product: saved.product,
        branch: saved.branch,
        sizes: saved.sizes || [],
        totalQuantity: saved.totalQuantity || 0,
        sazRegistered: false,
        sazPreloaded: false,
        imageUrl: saved.imageUrl || '',
        imageMessage: saved.imageMessage || '',
        notice: saved.notice,
      };
      const existingIndex = relationalInventoryResults.findIndex(item => item.product.id === result.product.id);
      if (existingIndex >= 0) relationalInventoryResults.splice(existingIndex, 1, result);
      else relationalInventoryResults.unshift(result);
      if (catalogCorrida(corrida) === catalogCorrida(productDuplicate.source.corrida)) {
        for (const item of relationalInventoryResults.filter(item => matchesStyleCorrida(item.product, result.product.estilo, corrida))) {
          item.product.precio = result.product.precio;
        }
      }
      productDuplicate = null;
      renderProductDuplicate();
      renderRelationalInventory(relationalInventoryResults, relationalInventoryQuery, { keepPagination: keepCardPagination() });
    } catch (error) {
      if (info) info.textContent = error.message;
    } finally {
      productDuplicateSaving = false;
    }
  }

  function setInventoryPhotoBusy(busy, options = {}) {
    inventoryPhotoBusy = busy;
    ['inventorySearchCamera', 'inventorySearchGallery'].forEach(id => {
      const button = byId(id);
      if (button) button.disabled = busy;
    });
    if (!options.keepConfirmEnabled) {
      ['stylePriceConfirm', 'stylePriceCancel'].forEach(id => {
        const button = byId(id);
        if (button) button.disabled = busy;
      });
    }
  }

  function renderRelationalInventory(results, query, options = {}) {
    const panel = byId('relationalSearchPanel'), container = byId('relationalSearchResults'), info = byId('relationalSearchInfo');
    const title = byId('relationalSearchTitle');
    relationalInventoryResults = (results || []).map(withLocalPreview);
    relationalInventoryQuery = query;
    panel.hidden = false;
    if (options.keepPagination) {
      setRelationalPreview(false);
      byId('inventoryCard')?.classList.add('isPrepCards');
      if (title) title.textContent = options.title || 'Faltantes SAZ';
    } else {
      byId('inventoryCard')?.classList.remove('isPrepCards');
      setRelationalPreview(true);
      if (title) title.textContent = options.title || 'Inventario relacional';
    }
    renderStylePriceReview();
    if (!results.length) {
      info.textContent = options.emptyInfo || `Sin fichas relacionales para “${query}”.`;
      container.innerHTML = options.emptyHtml || '<p class="muted">No hay ficha para esa búsqueda en el catálogo relacional. Si la foto leyó mal el estilo, corrígelo en el buscador.</p>';
      return;
    }
    const pairs = results.reduce((sum, result) => sum + Number(result.totalQuantity || 0), 0);
    info.textContent = options.info || `${results.length} ficha(s) · ${pairs} par(es) encontrados. Toca un dato para corregirlo.`;
    const active = document.activeElement;
    const keepFocus = options.keepFocus && active?.hasAttribute?.('data-edit-input') ? { field: active.getAttribute('data-edit-input'), productId: active.closest('[data-relational-product-id]')?.dataset.relationalProductId } : null;
    container.innerHTML = results.map(cardMarkup).join('');
    if (keepFocus) focusRelationalField(keepFocus.productId, keepFocus.field);
  }

  function applyHydratedImages(results, hydrated) {
    for (const next of hydrated || []) {
      const current = (results || []).find(item => item.product.id === next.product.id && item.branch.id === next.branch.id);
      if (!current || !next.imageUrl || current.imageUrl === next.imageUrl) continue;
      current.imageUrl = next.imageUrl;
      current.imageMessage = current.imageMessage || 'Imagen compartida entre ambos inventarios.';
      const preview = document.querySelector(`[data-relational-product-id="${CSS.escape(current.product.id)}"][data-relational-branch-id="${CSS.escape(current.branch.id)}"] .relationalImagePreview`);
      if (preview) preview.innerHTML = `<img src="${esc(next.imageUrl)}" alt="Producto ${esc(current.product.estilo)} ${esc(current.product.color)}">`;
    }
  }

  async function showFichas(fichas, options = {}) {
    const excel = window.ClaremmSazPrepExcel;
    const branch = juarezBranch();
    const results = (fichas || []).map(ficha => excel?.toRelationalResult?.(ficha, branch) || {
      product: {
        id: ficha.ficha_id || `local:${ficha.estilo}|${ficha.color}`,
        estilo: ficha.estilo,
        color: ficha.color,
        marca: ficha.marca || '',
        linea: ficha.linea || '',
        corrida: ficha.corrida || '',
        acabado: ficha.acabado || '',
        precio: Number(ficha.precio || 0),
        imagen: typeof ficha.imagen === 'string' ? ficha.imagen : '',
      },
      branch,
      sizes: [],
      totalQuantity: Number(ficha.pares || 0),
      sazRegistered: false,
      imageUrl: '',
      notice: 'Toca un dato para corregirlo. Igual que al buscar por estilo.',
    });
    renderRelationalInventory(results, options.query || 'faltantes SAZ', {
      keepPagination: options.keepPagination !== false,
      title: options.title || 'Faltantes SAZ',
      info: options.info,
      emptyInfo: options.emptyInfo,
      emptyHtml: options.emptyHtml || '<p class="muted">No hay fichas pendientes de SAZ para mostrar. Cuando aparezcan, toca un dato para corregirlo al instante.</p>',
    });
    const sequence = ++prepHydrateSequence;
    if (!cloud()?.hydrateRelationalImages) return;
    try {
      const hydrated = await cloud().hydrateRelationalImages(results);
      if (sequence !== prepHydrateSequence) return;
      applyHydratedImages(relationalInventoryResults, hydrated);
    } catch {}
  }

  function clearPrepCards() {
    byId('inventoryCard')?.classList.remove('isPrepCards');
    const title = byId('relationalSearchTitle');
    if (title) title.textContent = 'Inventario relacional';
    if (byId('inventorySearch')?.value.trim()) return;
    const panel = byId('relationalSearchPanel');
    if (panel) panel.hidden = true;
    setRelationalPreview(false);
  }

  function replaceRelationalCard(result) {
    const card = document.querySelector(`[data-relational-product-id="${CSS.escape(result.product.id)}"][data-relational-branch-id="${CSS.escape(result.branch.id)}"]`);
    if (!card) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = cardMarkup(result);
    card.replaceWith(wrap.firstElementChild);
  }

  function focusRelationalField(productId, field) {
    const input = document.querySelector(`[data-relational-product-id="${CSS.escape(productId)}"] [data-edit-input="${CSS.escape(field)}"]`);
    if (!input) return;
    input.focus();
    input.select();
  }

  function findRelationalResult(productId) {
    return relationalInventoryResults.find(item => item.product.id === productId);
  }

  async function saveRelationalField(productId, field, rawValue) {
    const result = findRelationalResult(productId);
    if (!result || !cloud()?.updateRelationalProductField) return;
    const notice = document.querySelector(`[data-relational-notice="${CSS.escape(productId)}"]`);
    try {
      const saved = await cloud().updateRelationalProductField({ productId, field, value: rawValue });
      if (field === 'precio') {
        const precio = saved.precio;
        for (const item of relationalInventoryResults.filter(item => matchesStyleCorrida(item.product, result.product.estilo, result.product.corrida))) {
          item.product.precio = precio;
          item.notice = `Precio actualizado en ${saved.updated} ficha(s) del mismo estilo y corrida.`;
        }
      } else {
        result.product[field] = saved.value;
        result.notice = `${FICHA_FIELDS.find(item => item.key === field)?.label || field} actualizado.`;
      }
      relationalEdit = null;
      window.ClaremmStore?.patchSazPrepFicha?.({
        estilo: result.product.estilo,
        color: result.product.color,
        ficha_id: isLocalFichaId(result.product.id) ? '' : result.product.id,
        precio: field === 'precio' ? saved.precio : result.product.precio,
        corrida: result.product.corrida,
        marca: result.product.marca,
        linea: result.product.linea,
        acabado: result.product.acabado,
        proveedor: result.product.proveedor,
        temporada: result.product.temporada,
        sublinea: result.product.sublinea,
        departamento: result.product.departamento,
        clasificacion: result.product.clasificacion,
      });
      if (field === 'precio') {
        for (const item of relationalInventoryResults.filter(item => matchesStyleCorrida(item.product, result.product.estilo, result.product.corrida))) replaceRelationalCard(item);
      } else {
        replaceRelationalCard(result);
      }
    } catch (error) {
      if (notice) notice.textContent = error.message;
    }
  }

  function startRelationalEdit(productId, field) {
    const result = findRelationalResult(productId);
    if (!result) return;
    if (isLocalFichaId(productId)) {
      result.notice = 'Esta ficha aún no está en el catálogo. Inicia sesión para corregirla igual que al buscar por estilo.';
      replaceRelationalCard(result);
      return;
    }
    relationalEdit = { productId, field };
    replaceRelationalCard(result);
    focusRelationalField(productId, field);
  }

  async function saveRelationalProductImage(file) {
    if (!file) return;
    const target = relationalImageTarget;
    if (!target) return;
    const card = document.querySelector(`[data-relational-product-id="${CSS.escape(target.product.id)}"]`);
    const statusElement = card?.querySelector('[data-relational-image-status]');
    const buttons = [...(card?.querySelectorAll('[data-relational-image]') || [])];
    buttons.forEach(button => { button.disabled = true; });
    if (statusElement) statusElement.textContent = 'Comprimiendo imagen…';
    try {
      const snapshot = window.ClaremmStore?.snapshotImageFile ? await window.ClaremmStore.snapshotImageFile(file) : file;
      if (window.ClaremmStore?.isImageFile && !window.ClaremmStore.isImageFile(snapshot)) throw new Error('Selecciona un archivo de imagen.');
      if (!window.ClaremmStore?.compressProductImage) throw new Error('Actualiza la página para activar el compresor de imágenes.');
      const blob = await window.ClaremmStore.compressProductImage(snapshot);
      const localUrl = URL.createObjectURL(blob);
      localImagePreview.set(target.product.id, { url: localUrl, path: '' });
      for (const result of relationalInventoryResults.filter(item => item.product.id === target.product.id)) {
        result.product.imagen = result.product.imagen || '1';
        result.imageUrl = localUrl;
        result.imageMessage = 'Foto lista. Guardando…';
        replaceRelationalCard(result);
      }
      if (statusElement) statusElement.textContent = 'Guardando en Supabase…';
      const saved = await cloud().uploadRelationalProductImage({ productId: target.product.id, blob });
      await window.ClaremmStore.putImageFromCloud(saved.fileName, blob).catch(() => {});
      await window.ClaremmStore.refreshImageIndicators?.({ silent: true });
      localImagePreview.set(target.product.id, { url: saved.imageUrl || localUrl, path: saved.path || '' });
      for (const result of relationalInventoryResults.filter(item => item.product.id === target.product.id)) {
        result.product.imagen = saved.path;
        result.imageUrl = saved.imageUrl || localUrl;
        result.imageMessage = `Imagen compartida en ambos inventarios · ${(saved.size / 1024).toFixed(1)} KB`;
        replaceRelationalCard(result);
      }
      window.ClaremmStore?.patchSazPrepFicha?.({
        estilo: target.product.estilo,
        color: target.product.color,
        sin_imagen: false,
        imagen: saved.path || true,
      }, { silent: true });
    } catch (error) {
      if (statusElement) statusElement.textContent = error.message;
      buttons.forEach(button => { button.disabled = false; });
    } finally {
      byId('relationalProductImageCamera').value = '';
      byId('relationalProductImageGallery').value = '';
      relationalImageTarget = null;
    }
  }

  async function searchRelationalInventory(options = {}) {
    const input = byId('inventorySearch'), panel = byId('relationalSearchPanel'), query = input.value.trim();
    const planned = window.ClaremmInventorySearch?.plan?.(query);
    if (!query || planned?.wait || planned?.mode === 'idle') {
      if (isPrepFilter()) {
        setRelationalPreview(false);
        window.ClaremmStore?.renderPrepFichaCards?.();
        return;
      }
      clearPrepCards();
      panel.hidden = !query;
      setRelationalPreview(Boolean(query));
      relationalEdit = null;
      stylePriceReview = null;
      productDuplicate = null;
      renderStylePriceReview();
      renderProductDuplicate();
      byId('relationalSearchResults').innerHTML = '';
      byId('relationalSearchInfo').textContent = planned?.message || '';
      return;
    }
    const sequence = options.sequence || ++inventorySearchSequence;
    if (isPrepFilter()) {
      setRelationalPreview(false);
      window.ClaremmStore?.renderPrepFichaCards?.(undefined, { force: true });
      return;
    }
    const scope = byId('inventorySearchScope').value, sazFilter = byId('inventorySazFilter').value;
    const catalogFilter = sazFilter === 'prep' ? 'all' : sazFilter;
    panel.hidden = false;
    setRelationalPreview(true);
    byId('relationalSearchInfo').textContent = 'Buscando en catálogo y existencias por sucursal…';
    try {
      if (!cloud()?.searchRelationalInventory) throw new Error('Actualiza la página para activar la búsqueda relacional.');
      const results = await cloud().searchRelationalInventory(query, scope, catalogFilter, { includeEmpty: true });
      if (sequence !== inventorySearchSequence) return;
      relationalEdit = null;
      if (stylePriceReview) stylePriceReview.corrida = resolveReviewCorrida(stylePriceReview, results);
      if (sazFilter === 'prep' && !results.length) {
        window.ClaremmStore?.renderPrepFichaCards?.(undefined, { force: true });
        return;
      }
      renderRelationalInventory(results, query);
      if (!cloud()?.hydrateRelationalImages) return;
      const hydrated = await cloud().hydrateRelationalImages(results);
      if (sequence !== inventorySearchSequence) return;
      applyHydratedImages(relationalInventoryResults, hydrated);
    } catch (error) {
      if (sequence !== inventorySearchSequence || error?.name === 'AbortError' || error?.aborted) return;
      if (isPrepFilter()) {
        window.ClaremmStore?.renderPrepFichaCards?.(undefined, { force: true });
        byId('relationalSearchInfo').textContent = error.message;
        return;
      }
      setRelationalPreview(false);
      byId('relationalSearchInfo').textContent = error.message;
      byId('relationalSearchResults').innerHTML = '<p class="muted">Inicia sesión y pulsa Sincronizar ahora para consultar Supabase.</p>';
    }
  }

  function queueRelationalInventorySearch() {
    clearTimeout(inventorySearchTimer);
    const sequence = ++inventorySearchSequence;
    inventorySearchTimer = setTimeout(() => searchRelationalInventory({ sequence }), window.ClaremmInventorySearch?.LIMITS?.DEBOUNCE_MS || 280);
  }

  async function searchInventoryByPhoto(file) {
    if (!file || inventoryPhotoBusy) return;
    clearTimeout(inventorySearchTimer);
    const sequence = ++inventorySearchSequence;
    const panel = byId('relationalSearchPanel');
    panel.hidden = false;
    setRelationalPreview(true);
    byId('relationalSearchInfo').textContent = 'Leyendo estilo y precio de la foto…';
    setInventoryPhotoBusy(true);
    try {
      const snapshot = window.ClaremmStore?.snapshotImageFile ? await window.ClaremmStore.snapshotImageFile(file) : file;
      if (!window.ClaremmStore?.readWithVision) throw new Error('Actualiza la página para leer la etiqueta con la cámara.');
      const vision = await window.ClaremmStore.readWithVision(snapshot);
      if (sequence !== inventorySearchSequence) return;
      const row = (vision.rows || []).find(item => item.estilo) || vision.rows?.[0] || {};
      const estilo = text(row.estilo);
      const precio = window.ClaremmStore.parseVisiblePrice?.(row.precio || vision.rawText) || text(row.precio);
      if (!estilo) throw new Error('No se leyó un estilo en la foto. Acerca la etiqueta e inténtalo de nuevo.');
      byId('inventorySearch').value = estilo;
      byId('inventorySearchScope').value = 'style';
      stylePriceReview = { estilo, corrida: '', talla: text(row.talla), precio, rawText: vision.rawText || '', provider: vision.provider || '' };
      renderStylePriceReview();
      await searchRelationalInventory({ sequence });
    } catch (error) {
      if (sequence !== inventorySearchSequence) return;
      byId('relationalSearchInfo').textContent = error.message;
    } finally {
      setInventoryPhotoBusy(false);
      byId('inventorySearchCameraFile').value = '';
      byId('inventorySearchGalleryFile').value = '';
    }
  }

  async function confirmStylePrice() {
    if (!stylePriceReview || inventoryPhotoBusy) return;
    const estilo = text(byId('inventorySearch').value) || stylePriceReview.estilo;
    const precio = text(byId('stylePriceProposal').value);
    if (!estilo) return alert('No hay un estilo para aplicar el precio.');
    const corrida = stylePriceReview.corrida || resolveReviewCorrida(stylePriceReview, relationalInventoryResults);
    if (!precio) return alert('Escribe el precio y confírmalo para aplicarlo a los colores de este estilo y corrida.');
    if (!catalogCorrida(corrida)) return alert('No se identificó la corrida. El precio solo se aplica cuando coinciden estilo y corrida.');
    inventoryPhotoBusy = true;
    setInventoryPhotoBusy(true, { keepConfirmEnabled: true });
    const info = byId('stylePriceReviewInfo');
    if (info) info.textContent = `Guardando precio ${precio} en ${estilo} · corrida ${corrida}…`;
    try {
      if (!cloud()?.updateRelationalStylePrice) throw new Error('Actualiza la página para guardar el precio del estilo y la corrida.');
      const saved = await cloud().updateRelationalStylePrice(estilo, precio, corrida);
      for (const result of relationalInventoryResults.filter(item => matchesStyleCorrida(item.product, estilo, saved.corrida || corrida))) {
        result.product.precio = saved.precio;
        result.notice = `Precio confirmado en ${saved.updated} ficha(s) del mismo estilo y corrida.`;
      }
      stylePriceReview = null;
      renderStylePriceReview();
      renderRelationalInventory(relationalInventoryResults, relationalInventoryQuery, { keepPagination: keepCardPagination() });
    } catch (error) {
      if (info) info.textContent = error.message;
    } finally {
      inventoryPhotoBusy = false;
      setInventoryPhotoBusy(false);
    }
  }

  function cancelStylePrice() {
    stylePriceReview = null;
    renderStylePriceReview();
    if (relationalInventoryResults.length) renderRelationalInventory(relationalInventoryResults, relationalInventoryQuery, { keepPagination: keepCardPagination() });
  }

  byId('branchStockOpen').addEventListener('click', openDialog);
  byId('branchStockClose').addEventListener('click', closeDialog);
  byId('branchStockDialog').addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
  byId('branchStockBranch').addEventListener('change', () => {
    if (selectedBranchId()) localStorage.setItem(BRANCH_MEMORY_KEY, selectedBranchId());
    renderBranchProtection();
    renderBulkState();
    refreshRecentStock();
  });
  byId('branchStockStyle').addEventListener('input', queueSearch);
  byId('branchStockColor').addEventListener('input', queueSearch);
  byId('branchStockSaveOne').addEventListener('click', saveManual);
  byId('branchStockQueueUnknown').addEventListener('click', queueUnknownManual);
  byId('branchStockTemplate').addEventListener('click', () => workbookDownload(templateRows(), 'CLAREMM_Plantilla_Existencias_Sucursal.xlsx', [
    'Una fila representa una talla de un estilo y color.', 'La sucursal se selecciona dentro de CLAREMM Scan y se aplica a todo el archivo.',
    'Establecer cantidades reemplaza solamente las variantes incluidas; Sumar entrada agrega la cantidad al stock actual.',
    'En CLAREMM ZAPATERIA JUAREZ (JUAREZ), cualquier reducción se omite: solo se conserva o aumenta la existencia.',
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
  byId('branchStockRecentList').addEventListener('click', event => {
    const button = event.target.closest('[data-recent-image]');
    if (!button) return;
    recentImageTarget = button.dataset.recentId;
    byId(button.dataset.recentImage === 'camera' ? 'branchRecentImageCamera' : 'branchRecentImageGallery').click();
  });
  byId('branchRecentImageCamera').addEventListener('change', event => saveRecentProductImage(event.target.files?.[0]));
  byId('branchRecentImageGallery').addEventListener('change', event => saveRecentProductImage(event.target.files?.[0]));
  byId('inventorySearch').addEventListener('input', queueRelationalInventorySearch);
  byId('inventorySearch').addEventListener('search', queueRelationalInventorySearch);
  byId('inventorySearchScope').addEventListener('change', queueRelationalInventorySearch);
  byId('inventorySazFilter').addEventListener('change', queueRelationalInventorySearch);
  byId('inventorySearchCamera').addEventListener('click', () => byId('inventorySearchCameraFile').click());
  byId('inventorySearchGallery').addEventListener('click', () => byId('inventorySearchGalleryFile').click());
  byId('inventorySearchCameraFile').addEventListener('change', event => searchInventoryByPhoto(event.target.files?.[0]));
  byId('inventorySearchGalleryFile').addEventListener('change', event => searchInventoryByPhoto(event.target.files?.[0]));
  byId('stylePriceConfirm').addEventListener('click', confirmStylePrice);
  byId('stylePriceCancel').addEventListener('click', cancelStylePrice);
  byId('productDuplicateCamera').addEventListener('click', () => byId('productDuplicateCameraFile').click());
  byId('productDuplicateGallery').addEventListener('click', () => byId('productDuplicateGalleryFile').click());
  const takeDuplicatePhoto = event => {
    const file = event.target.files?.[0];
    if (!file) return;
    productDuplicatePhoto = file;
    const fileName = duplicateImageName();
    if (productDuplicate && byId('productDuplicatePhotoInfo')) {
      byId('productDuplicatePhotoInfo').textContent = `Foto lista. Se guardará como ${fileName || 'ESTILO-COLOR.png'} (máximo 100 KB), solo en este color.`;
    }
    event.target.value = '';
  };
  byId('productDuplicateCameraFile').addEventListener('change', takeDuplicatePhoto);
  byId('productDuplicateGalleryFile').addEventListener('change', takeDuplicatePhoto);
  byId('productDuplicateSave').addEventListener('click', () => { void saveProductDuplicate(); });
  byId('productDuplicateCancel').addEventListener('click', cancelProductDuplicate);
  ['productDuplicateColor', 'productDuplicateCorrida', 'productDuplicatePrecio', 'productDuplicateTalla', 'productDuplicateCantidad'].forEach(id => {
    byId(id).addEventListener('input', () => {
      if (!productDuplicate) return;
      productDuplicate.color = text(byId('productDuplicateColor').value);
      productDuplicate.corrida = text(byId('productDuplicateCorrida').value);
      productDuplicate.precio = text(byId('productDuplicatePrecio').value);
      productDuplicate.talla = text(byId('productDuplicateTalla').value);
      productDuplicate.cantidad = text(byId('productDuplicateCantidad').value) || '1';
      if (byId('productDuplicateInfo')) byId('productDuplicateInfo').textContent = duplicateHint();
      const fileName = duplicateImageName();
      if (byId('productDuplicatePhotoInfo')) byId('productDuplicatePhotoInfo').textContent = productDuplicatePhoto
        ? `Foto lista. Se guardará como ${fileName || 'ESTILO-COLOR.png'} (máximo 100 KB), solo en este color.`
        : fileName
          ? `Sin foto. Si tomas una, se guardará como ${fileName}. La imagen original no se copia.`
          : 'Sin foto. Escribe el color para nombrar la imagen estilo-color. La original no se copia.';
    });
  });
  byId('stylePriceProposal').addEventListener('input', () => {
    if (!stylePriceReview) return;
    stylePriceReview.precio = text(byId('stylePriceProposal').value);
    for (const result of relationalInventoryResults) replaceRelationalCard(result);
  });
  byId('relationalProductImageCamera').addEventListener('change', event => saveRelationalProductImage(event.target.files?.[0]));
  byId('relationalProductImageGallery').addEventListener('change', event => saveRelationalProductImage(event.target.files?.[0]));
  byId('relationalSearchResults').addEventListener('click', async event => {
    const previewButton = event.target.closest('[data-image-preview]');
    if (previewButton) {
      window.ClaremmStore?.openImagePreview?.(previewButton.dataset.imagePreview, previewButton.getAttribute('aria-label') || 'Foto del producto');
      return;
    }
    const duplicateButton = event.target.closest('[data-relational-duplicate]');
    if (duplicateButton) {
      if (isLocalFichaId(duplicateButton.dataset.relationalDuplicate)) return;
      openProductDuplicate(duplicateButton.dataset.relationalDuplicate);
      return;
    }
    const imageButton = event.target.closest('[data-relational-image]');
    if (imageButton) {
      const result = findRelationalResult(imageButton.dataset.productId);
      if (!result) return;
      relationalImageTarget = result;
      byId(imageButton.dataset.relationalImage === 'camera' ? 'relationalProductImageCamera' : 'relationalProductImageGallery').click();
      return;
    }
    const fieldButton = event.target.closest('[data-edit-field]');
    if (!fieldButton) return;
    const card = fieldButton.closest('[data-relational-product-id]');
    if (!card) return;
    const open = byId('relationalSearchResults').querySelector('[data-edit-input]');
    if (open) {
      const openCard = open.closest('[data-relational-product-id]');
      if (openCard?.dataset.relationalProductId === card.dataset.relationalProductId && open.dataset.editInput === fieldButton.dataset.editField) return;
      if (openCard) await saveRelationalField(openCard.dataset.relationalProductId, open.dataset.editInput, open.value);
    }
    startRelationalEdit(card.dataset.relationalProductId, fieldButton.dataset.editField);
  });
  byId('relationalSearchResults').addEventListener('keydown', event => {
    const input = event.target.closest('[data-edit-input]');
    if (!input) return;
    const card = input.closest('[data-relational-product-id]');
    if (event.key === 'Enter') {
      event.preventDefault();
      saveRelationalField(card.dataset.relationalProductId, input.dataset.editInput, input.value);
    } else if (event.key === 'Escape') {
      relationalEdit = null;
      renderRelationalInventory(relationalInventoryResults, relationalInventoryQuery, { keepPagination: keepCardPagination() });
    }
  });
  byId('relationalSearchResults').addEventListener('focusout', event => {
    const input = event.target.closest('[data-edit-input]');
    if (!input) return;
    const card = input.closest('[data-relational-product-id]');
    const next = event.relatedTarget;
    if (card?.contains(next)) return;
    window.setTimeout(() => {
      if (relationalEdit?.productId === card?.dataset.relationalProductId && relationalEdit.field === input.dataset.editInput && document.activeElement !== input) {
        saveRelationalField(card.dataset.relationalProductId, input.dataset.editInput, input.value);
      }
    }, 0);
  });
  document.addEventListener('claremm-cloud-session', event => {
    if (!event.detail?.signedIn && byId('branchStockDialog').open) loadContext(false);
    if (event.detail?.signedIn) {
      cloud()?.loadBranchStockContext?.().catch(() => {});
      if (byId('inventorySearch').value.trim()) queueRelationalInventorySearch();
      else if (isPrepFilter()) window.ClaremmStore?.renderPrepFichaCards?.();
    }
  });
  window.ClaremmFichaCards = { showFichas, clearPrep: clearPrepCards };
  if (isPrepFilter()) window.ClaremmStore?.renderPrepFichaCards?.();
  renderBulkState();
})();
