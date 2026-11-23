import React, { useState } from 'react';
import { X, Download } from 'lucide-react';

export default function SazExportModal({ isOpen, onClose, products = [] }) {
  const [mode, setMode] = useState('uno');
  const [count, setCount] = useState(10);
  const [productId, setProductId] = useState(() => String(products[0]?.id || ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState('');
  if (!isOpen) return null;
  const download = async event => {
    event.preventDefault(); setBusy(true); setError(''); setSummary('');
    try {
      const params = new URLSearchParams({ modo: mode });
      if (mode === 'varios') params.set('cantidad', String(count));
      if (mode === 'uno' && productId) params.set('producto', productId);
      const response = await fetch(`/api/products/export-saz?${params}`);
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        if (response.status === 404 && (!body || body.message === 'Producto no encontrado')) {
          throw new Error('El servidor sigue ejecutando una versión anterior. Ejecuta reiniciar_backend_qa.bat y vuelve a descargar.');
        }
        throw new Error(body?.message || 'No se pudo exportar para SAZ.');
      }
      if (!response.headers.get('Content-Type')?.includes('spreadsheetml.sheet')) throw new Error('El servidor no devolvió un Excel. Reinicia el backend y vuelve a intentar.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url;
      link.download = 'CLAREMM_Alta_Masiva_SAZ.xlsx';
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setSummary(`Descargados ${response.headers.get('X-SAZ-Products')} producto(s), ${response.headers.get('X-SAZ-Rows')} filas por talla.`);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const input = 'w-full px-3 py-2.5 border border-slate-300 rounded-xl bg-white text-sm';
  return <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
    <form onSubmit={download} role="dialog" aria-modal="true" aria-labelledby="saz-title" className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden text-slate-800">
      <div className="flex justify-between items-center p-5 border-b border-slate-200">
        <h3 id="saz-title" className="font-bold">Alta masiva SAZ</h3>
        <button type="button" onClick={onClose} disabled={busy} aria-label="Cerrar" className="p-2"><X className="w-5 h-5" /></button>
      </div>
      <div className="p-5 space-y-4">
        <p className="text-sm">Descarga los datos con las 18 columnas de la plantilla SAZ, en el mismo orden.</p>
        <label className="block space-y-2"><span className="text-sm font-semibold">¿Cuántos productos quieres probar?</span>
          <select className={input} value={mode} onChange={e => { setMode(e.target.value); setSummary(''); }} disabled={busy}>
            <option value="uno">1 producto</option><option value="varios">Varios productos</option><option value="todos">Todos los productos activos</option>
          </select>
        </label>
        {mode === 'uno' && products.length > 0 && <label className="block space-y-2"><span className="text-sm font-semibold">Producto de la página actual</span>
          <select className={input} value={productId} onChange={e => setProductId(e.target.value)} disabled={busy}>
            {products.map(p => <option key={p.id} value={p.id}>{p.estilo} · {p.color} · {p.marca}</option>)}
          </select></label>}
        {mode === 'varios' && <label className="block space-y-2"><span className="text-sm font-semibold">Cantidad de productos</span><input className={input} type="number" min="1" step="1" required value={count} disabled={busy} onChange={e => setCount(e.target.value)} /></label>}
        <p className="text-xs text-slate-600">Cada producto incluye todas las tallas de su corrida: 1 producto puede generar varias filas. Varios y todos se toman del catálogo activo completo, del más reciente al más antiguo.</p>
        <p className="text-xs text-slate-600">SKU y SKU_PROV se dejan vacíos para esta prueba. La plantilla no lleva imágenes ni existencias.</p>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {summary && <p role="status" className="text-sm text-emerald-700">{summary}</p>}
      </div>
      <div className="p-5 bg-slate-50 flex justify-end gap-3">
        <button type="button" onClick={onClose} disabled={busy} className="px-4 py-2 border rounded-xl">Cerrar</button>
        <button type="submit" disabled={busy} className="px-4 py-2 bg-amber-700 text-white rounded-xl flex items-center gap-2 disabled:opacity-50"><Download className="w-4 h-4" />{busy ? 'Generando…' : 'Descargar para SAZ'}</button>
      </div>
    </form>
  </div>;
}
