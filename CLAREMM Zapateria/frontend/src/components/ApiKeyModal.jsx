import React, { useState, useEffect } from 'react';
import { Key, CheckCircle, AlertCircle, ExternalLink, X, Eye, EyeOff } from 'lucide-react';
import { safeFetchJson } from '../utils/api';

export default function ApiKeyModal({ isOpen, onClose, onKeySaved }) {
  const [apiKey, setApiKey] = useState('');
  const [maskedKey, setMaskedKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null);

  useEffect(() => {
    if (isOpen) {
      fetchStatus();
    }
  }, [isOpen]);

  const fetchStatus = async () => {
    try {
      const data = await safeFetchJson('/api/settings/gemini-key');
      if (data && data.success) {
        setHasKey(data.hasKey);
        setMaskedKey(data.maskedKey || '');
      }
    } catch (e) {
      console.error('Error fetching key status:', e);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!apiKey.trim()) {
      setStatusMsg({ type: 'error', text: 'Por favor ingresa una clave válida.' });
      return;
    }

    setLoading(true);
    setStatusMsg(null);

    try {
      const data = await safeFetchJson('/api/settings/gemini-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim() })
      });

      if (data && data.success) {
        setHasKey(true);
        setStatusMsg({ type: 'success', text: 'API Key de Gemini guardada correctamente.' });
        if (onKeySaved) onKeySaved(apiKey.trim());
        setApiKey('');
        await fetchStatus();
        setTimeout(() => {
          onClose();
        }, 1200);
      } else {
        setStatusMsg({ type: 'error', text: data?.message || 'Error al guardar la clave.' });
      }
    } catch (err) {
      setStatusMsg({ type: 'error', text: 'Error de conexión con el servidor.' });
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="relative w-full max-w-lg bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden animate-fadeIn text-slate-800">
        {/* Header Light */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50/80">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-700">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900">Configuración Gemini AI</h3>
              <p className="text-xs text-slate-500">Extracción inteligente de fichas de calzado</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 bg-white">
          {/* Status banner */}
          <div className={`p-4 rounded-xl border flex items-center justify-between ${
            hasKey
              ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
              : 'bg-amber-50 border-amber-300 text-amber-900'
          }`}>
            <div className="flex items-center space-x-3">
              {hasKey ? (
                <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
              )}
              <div>
                <p className="text-sm font-bold">
                  {hasKey ? 'Gemini AI está activo y listo' : 'API Key no configurada'}
                </p>
                {hasKey && maskedKey && (
                  <p className="text-xs font-mono text-emerald-800 mt-0.5">Clave activa: {maskedKey}</p>
                )}
                {!hasKey && (
                  <p className="text-xs text-amber-800 mt-0.5">Se requiere para extraer datos de las fotos automáticamente.</p>
                )}
              </div>
            </div>
          </div>

          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                Ingresa o Actualiza tu Gemini API Key
              </label>
              <div className="relative">
                <input
                  type={showRaw ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="AIzaSy... o AQ...."
                  className="w-full pl-4 pr-10 py-3 bg-white border border-slate-300 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition shadow-2xs"
                />
                <button
                  type="button"
                  onClick={() => setShowRaw(!showRaw)}
                  className="absolute right-3 top-3 text-slate-400 hover:text-slate-700"
                >
                  {showRaw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {statusMsg && (
              <div className={`p-3 rounded-lg text-xs font-bold ${
                statusMsg.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-300' : 'bg-red-50 text-red-800 border border-red-300'
              }`}>
                {statusMsg.text}
              </div>
            )}

            <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
              <span>¿Necesitas una clave nueva?</span>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-amber-700 hover:text-amber-800 flex items-center space-x-1 font-bold transition"
              >
                <span>Google AI Studio</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <div className="pt-3 flex items-center justify-end space-x-3 border-t border-slate-100">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-600 hover:text-slate-900 text-sm font-semibold hover:bg-slate-100 transition"
              >
                Cerrar
              </button>
              <button
                type="submit"
                disabled={loading || !apiKey.trim()}
                className="gold-gradient-btn px-5 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50 shadow-sm"
              >
                {loading ? 'Guardando...' : 'Guardar y Activar'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
