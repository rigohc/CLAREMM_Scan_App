import React from 'react';
import { X, ExternalLink } from 'lucide-react';

export default function ImageViewerModal({ isOpen, onClose, imageUrl, title = "Imagen de Calzado" }) {
  if (!isOpen || !imageUrl) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4">
      <div className="relative max-w-4xl w-full bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xl flex flex-col text-slate-800">
        {/* Header Light */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50/80">
          <div className="flex items-center space-x-2">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
            <h3 className="text-sm font-bold text-slate-900">{title}</h3>
          </div>
          <div className="flex items-center space-x-2">
            <a
              href={imageUrl}
              target="_blank"
              rel="noreferrer"
              className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition"
              title="Abrir en pestaña nueva"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Image body */}
        <div className="p-4 flex items-center justify-center bg-slate-50/50 min-h-[300px] max-h-[75vh] overflow-auto">
          <img
            src={imageUrl}
            alt={title}
            className="max-h-[70vh] w-auto object-contain rounded-xl shadow-md border border-slate-200"
          />
        </div>
      </div>
    </div>
  );
}
