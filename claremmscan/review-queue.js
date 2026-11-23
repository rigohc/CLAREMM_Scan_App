'use strict';

(() => {
  const byId = id => document.getElementById(id);
  const text = value => String(value ?? '').trim();
  const esc = value => text(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const cloud = () => window.claremmCloud;
  const currency = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
  let rows = [];

  function status(message, kind = '') {
    const element = byId('catalogReviewStatus');
    if (!element) return;
    element.textContent = message;
    element.className = `branchStockStatus ${kind}`.trim();
  }

  function kindLabel(row) {
    if (row.kind === 'material_mismatch') return 'Material por corregir';
    if (row.precio_origen === 'cero') return 'Precio en $0';
    if (row.precio_origen === 'heredado') return 'Precio heredado';
    return 'Ficha nueva';
  }

  function render() {
    const body = byId('catalogReviewRows');
    if (!body) return;
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="12" class="emptyRow">No hay fichas en esta cola.</td></tr>';
      byId('catalogReviewCount').textContent = '0';
      return;
    }
    byId('catalogReviewCount').textContent = String(rows.length);
    body.innerHTML = rows.map(row => {
      const priceMark = row.precio_origen === 'heredado' ? 'heredado' : row.precio_origen === 'cero' ? 'en $0' : row.precio_origen || '';
      const tipoMark = row.tipo_inferido ? 'inferido' : '';
      const mismatch = row.kind === 'material_mismatch' ? `Ficha ${esc(row.material)} · etiqueta ${esc(row.label_material)}` : esc(row.material || '—');
      return `<tr data-review-id="${esc(row.ficha_id)}">
        <td>${esc(row.estilo)}</td>
        <td>${esc(row.color)}</td>
        <td>${esc(row.marca || '—')}</td>
        <td>${esc(row.tipo || '—')}${tipoMark ? ` <small>${esc(tipoMark)}</small>` : ''}</td>
        <td>${mismatch}</td>
        <td>${esc(currency.format(Number(row.precio || 0)))}${priceMark ? ` <small>${esc(priceMark)}</small>` : ''}</td>
        <td>${esc((row.tallas || []).join(', ') || '—')}</td>
        <td>${esc(row.pares)}</td>
        <td>${esc(row.batch_id || '—')}</td>
        <td>${esc(row.estado_saz)}</td>
        <td>${esc(kindLabel(row))}</td>
        <td>
          <div class="catalogReviewRowActions">
            <button type="button" data-review-edit="${esc(row.ficha_id)}">Corregir</button>
            <button type="button" class="secondary" data-review-done="${esc(row.ficha_id)}">Revisado</button>
          </div>
        </td>
      </tr>`;
    }).join('');
  }

  async function load() {
    if (!cloud()?.listCatalogReview) return status('Actualiza la página para cargar la cola de revisión.', 'warn');
    try {
      status('Cargando revisión pendiente…');
      rows = await cloud().listCatalogReview({
        branch: byId('catalogReviewBranch').value,
        estado: byId('catalogReviewEstado').value,
      });
      render();
      status(rows.length ? `${rows.length} ficha(s) en cola.` : 'No hay pendientes con estos filtros.', rows.length ? 'ok' : '');
    } catch (error) {
      status(error.message || 'No se pudo cargar la cola.', 'warn');
    }
  }

  function rowById(id) {
    return rows.find(row => row.ficha_id === id);
  }

  async function markDone(id) {
    const row = rowById(id);
    if (!row) return;
    try {
      await cloud().reviewCatalogProduct(id, { motivo: 'Marcado como revisado desde la app', marcarRevisado: true });
      status(`${row.estilo} ${row.color} quedó revisado.`, 'ok');
      await load();
    } catch (error) {
      status(error.message || 'No se pudo marcar.', 'warn');
    }
  }

  async function editRow(id) {
    const row = rowById(id);
    if (!row) return;
    const precio = prompt(`Precio para ${row.estilo} ${row.color}`, String(row.precio || 0));
    if (precio == null) return;
    const tipo = prompt('Tipo (DAMA / NIÑOS / CABALLERO)', row.tipo || '');
    if (tipo == null) return;
    const material = prompt('Material (SINTETICO / PIEL)', row.kind === 'material_mismatch' ? (row.label_material || 'SINTETICO') : (row.material || 'SINTETICO'));
    if (material == null) return;
    const motivo = prompt('Motivo de la corrección', 'Corrección del encargado') || 'Corrección del encargado';
    try {
      await cloud().reviewCatalogProduct(id, { precio, tipo, material, motivo, marcarRevisado: true });
      status(`${row.estilo} ${row.color} se corrigió y quedó revisado.`, 'ok');
      await load();
    } catch (error) {
      status(error.message || 'No se pudo corregir.', 'warn');
    }
  }

  function exportExcel() {
    if (!window.XLSX) return status('No está disponible el generador de Excel.', 'warn');
    const sheet = rows.map(row => ({
      Estilo: row.estilo,
      Color: row.color,
      Marca: row.marca,
      Tipo: row.tipo,
      'Tipo inferido': row.tipo_inferido ? 'SI' : 'NO',
      Material: row.material,
      'Material etiqueta': row.label_material,
      Precio: row.precio,
      'Precio origen': row.precio_origen,
      Tallas: (row.tallas || []).join(', '),
      Pares: row.pares,
      Lote: row.batch_id,
      'Estado SAZ': row.estado_saz,
      'Estado revisión': row.estado_revision,
      Origen: kindLabel(row),
      Fecha: row.created_at,
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(sheet), 'Revision');
    XLSX.writeFile(workbook, 'CLAREMM_Revision_Pendiente.xlsx');
  }

  async function openDialog() {
    const dialog = byId('catalogReviewDialog');
    dialog?.showModal();
    try {
      const context = await cloud().loadBranchStockContext();
      const select = byId('catalogReviewBranch');
      if (select && context?.branches?.length) {
        const current = select.value;
        select.innerHTML = ['<option value="">Todas</option>', ...context.branches.map(branch => `<option value="${esc(branch.code)}">${esc(branch.name)}</option>`)].join('');
        if (current) select.value = current;
      }
    } catch (error) {
      status(error.message || 'Inicia sesión para ver la cola.', 'warn');
    }
    load();
  }

  function closeDialog() {
    byId('catalogReviewDialog')?.close();
  }

  byId('catalogReviewOpen')?.addEventListener('click', openDialog);
  byId('catalogReviewClose')?.addEventListener('click', closeDialog);
  byId('catalogReviewReload')?.addEventListener('click', load);
  byId('catalogReviewExport')?.addEventListener('click', exportExcel);
  byId('catalogReviewBranch')?.addEventListener('change', load);
  byId('catalogReviewEstado')?.addEventListener('change', load);
  byId('catalogReviewRows')?.addEventListener('click', event => {
    const done = event.target.closest('[data-review-done]');
    const edit = event.target.closest('[data-review-edit]');
    if (done) markDone(done.getAttribute('data-review-done'));
    if (edit) editRow(edit.getAttribute('data-review-edit'));
  });
})();
