'use strict';

(() => {
  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  let pending = null;

  function setStatus(message, kind = '') {
    const element = byId('sazReconcileStatus');
    element.textContent = message;
    element.className = `branchStockStatus ${kind}`.trim();
  }

  function closeDialog() {
    byId('sazReconcileDialog').close();
    byId('sazReconcileFile').value = '';
    pending = null;
  }

  function renderPreview(parsed, preview) {
    byId('sazReconcileFileName').textContent = parsed.fileName;
    byId('sazReconcileProducts').textContent = String(preview.validProducts);
    byId('sazReconcilePairs').textContent = String(preview.pairs);
    byId('sazReconcileMissing').textContent = String(preview.missingProducts);
    byId('sazReconcileBlocked').textContent = String(preview.blockedRows.length);
    byId('sazReconcileSummary').textContent = `Coincidieron ${preview.matchedProducts} producto(s): ${preview.scannerProducts} del escáner y ${preview.preloadedProducts} precargado(s), incluidas las altas nuevas. Las fichas con saldo pendiente se identifican por talla.`;
    byId('sazReconcilePlan').textContent = `Plan: crear ${preview.missingProducts} ficha(s), actualizar ${preview.statusRowsToUpdate} estado(s) y aumentar ${preview.pairsToAdd} par(es) en ${preview.stockRowsToRaise} talla(s). Precio e imagen: 0 cambios.`;
    const issues = [
      ...preview.blockedRows.map(row => `<li>Fila ${esc(row.row)} · ${esc(row.estilo)} ${esc(row.color)}: ${row.reason === 'existencia_negativa' ? `existencia negativa (${esc(row.negatives?.map(item => `${item.size}: ${item.quantity}`).join(', '))})` : 'el total no cuadra'}; se omitirá esta ficha.</li>`),
      ...preview.missingSample.map(row => `<li>Nuevo precargado: ${esc(row.estilo)} · ${esc(row.color)} · ${esc(row.pairs)} par(es).</li>`),
    ];
    byId('sazReconcileIssues').hidden = !issues.length;
    byId('sazReconcileIssueList').innerHTML = issues.join('');
    byId('sazReconcileApply').disabled = !preview.validProducts;
    setStatus('Vista previa lista. Revisa el plan antes de aplicar.', preview.blockedRows.length ? 'warn' : 'ok');
  }

  async function chooseFile(file) {
    if (!file) return;
    const dialog = byId('sazReconcileDialog');
    if (!dialog.open) dialog.showModal();
    byId('sazReconcileApply').disabled = true;
    byId('sazReconcileFileName').textContent = file.name;
    setStatus('Leyendo el Excel SAZ…');
    try {
      const parsed = await window.ClaremmSazReconcile.readFile(file);
      const preview = await window.claremmCloud.previewSazReconciliation(parsed, message => setStatus(message));
      pending = { parsed, preview };
      renderPreview(parsed, preview);
    } catch (error) {
      pending = null;
      setStatus(error.message || 'No se pudo preparar la conciliación.', 'warn');
    }
  }

  async function apply() {
    if (!pending) return;
    const button = byId('sazReconcileApply');
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    setStatus('Aplicando conciliación en Supabase…');
    try {
      const result = await window.claremmCloud.applySazReconciliation(pending.parsed, message => setStatus(message));
      setStatus(`Listo: ${result.productsCreated} producto(s) creados como YA PRECARGADO EN SAZ, ${result.stockRowsRaised} talla(s) aumentadas y ${result.pairsAdded} par(es) agregados. ${result.protectedRows?.length || 0} reducción(es) de JUÁREZ se ignoraron y ${result.blockedRows.length} incidencia(s) quedaron omitidas.`, result.blockedRows.length || result.protectedRows?.length ? 'warn' : 'ok');
      byId('sazReconcilePlan').textContent = 'Conciliación terminada. JUÁREZ no tuvo ninguna reducción; precios e imágenes permanecieron intactos.';
      byId('status').textContent = `Excel SAZ conciliado: ${result.scannerProducts} producto(s) del escáner y ${result.preloadedProducts} precargado(s).`;
      pending = null;
      window.ClaremmStore?.refreshSazPrepCatalog?.().catch(() => {});
    } catch (error) {
      button.disabled = false;
      setStatus(error.message || 'No se pudo aplicar la conciliación.', 'warn');
    } finally {
      button.removeAttribute('aria-busy');
    }
  }

  byId('sazReconcileOpen').addEventListener('click', () => byId('sazReconcileFile').click());
  byId('sazReconcileFile').addEventListener('change', event => chooseFile(event.target.files?.[0]));
  byId('sazReconcileApply').addEventListener('click', apply);
  byId('sazReconcileClose').addEventListener('click', closeDialog);
  byId('sazReconcileCancel').addEventListener('click', closeDialog);
  byId('sazReconcileDialog').addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
})();
