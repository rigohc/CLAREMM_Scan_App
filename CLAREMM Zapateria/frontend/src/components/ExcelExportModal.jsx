import React, { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';

const getTodayDate = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export default function ExcelExportModal({ isOpen, onClose, onExport }) {
  const [type, setType] = useState('todos');
  const [dateFrom, setDateFrom] = useState(getTodayDate);
  const [dateTo, setDateTo] = useState(getTodayDate);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    const today = getTodayDate();
    setType('todos');
    setDateFrom(today);
    setDateTo(today);
    setError('');
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (event) => {
    event.preventDefault();
    if (dateFrom > dateTo) {
      setError('La fecha inicial no puede ser posterior a la fecha final.');
      return;
    }

    onExport({ type, dateFrom, dateTo });
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden animate-fadeIn text-slate-800"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50/80">
          <div>
            <h3 className="font-bold text-slate-900">Exportar catálogo a Excel</h3>
            <p className="text-xs text-slate-500 mt-1">Elige el tipo de producto y el periodo de registro.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition"
            aria-label="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-bold text-slate-700">Productos</span>
            <select
              value={type}
              onChange={(event) => setType(event.target.value)}
              className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-sm text-slate-900 focus:outline-none focus:border-amber-500"
            >
              <option value="todos">Todos los productos</option>
              <option value="zapatos">Solo zapatos</option>
              <option value="ropa">Solo ropa</option>
            </select>
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block space-y-1.5">
              <span className="text-xs font-bold text-slate-700">Desde</span>
              <input
                type="date"
                required
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-sm text-slate-900 focus:outline-none focus:border-amber-500"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-bold text-slate-700">Hasta</span>
              <input
                type="date"
                required
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-sm text-slate-900 focus:outline-none focus:border-amber-500"
              />
            </label>
          </div>

          <p className="text-[11px] text-slate-500">
            El rango usa la fecha en que cada producto se registró en el sistema.
          </p>
          {error && <p className="text-xs font-semibold text-red-700">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-slate-300 text-slate-600 hover:text-slate-900 text-xs font-bold hover:bg-slate-100 transition"
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="px-5 py-2 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold transition shadow-sm flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Descargar Excel
          </button>
        </div>
      </form>
    </div>
  );
}
