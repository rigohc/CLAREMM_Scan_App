import React, { useState } from 'react';
import { EyeOff, AlertTriangle, X } from 'lucide-react';
import { safeFetchJson } from '../utils/api';

export default function DeleteDialog({ isOpen, onClose, product, onConfirmDelete }) {
  const [isDeleting, setIsDeleting] = useState(false);

  if (!isOpen || !product) return null;

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const data = await safeFetchJson(`/api/products/${product.id}`, {
        method: 'DELETE'
      });
      if (data && data.success) {
        if (onConfirmDelete) onConfirmDelete(product.id);
        onClose();
      } else {
        alert(data?.message || 'Error al ocultar el producto.');
      }
    } catch (err) {
      alert('Error de conexión: ' + err.message);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="relative w-full max-w-md bg-white border border-amber-200 rounded-2xl shadow-2xl p-6 overflow-hidden animate-fadeIn text-slate-800">
        <div className="flex items-start space-x-4">
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 shrink-0">
            <EyeOff className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h3 className="font-bold text-slate-900 text-base">¿Ocultar este producto?</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              El producto se ocultará del catálogo y no se mostrará en la tabla ni exportaciones. Los datos permanecerán intactos en la base de datos sin eliminarse.
            </p>
            <div className="mt-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs">
              <span className="font-bold text-amber-800 font-mono">{product.estilo}</span>
              <span className="text-slate-600 font-medium"> — {product.marca || 'Sin marca'} ({product.color || 'Sin color'})</span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end space-x-3 mt-6 pt-4 border-t border-slate-100">
          <button
            type="button"
            disabled={isDeleting}
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-slate-300 text-slate-600 hover:text-slate-900 text-xs font-bold hover:bg-slate-100 transition"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={isDeleting}
            onClick={handleDelete}
            className="px-5 py-2 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold transition shadow-sm disabled:opacity-50"
          >
            {isDeleting ? 'Ocultando...' : 'Sí, Ocultar Producto'}
          </button>
        </div>
      </div>
    </div>
  );
}
