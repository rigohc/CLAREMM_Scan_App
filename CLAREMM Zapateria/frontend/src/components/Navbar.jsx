import React from 'react';
import { Camera, FileSpreadsheet, Key, Sparkles, Radio } from 'lucide-react';

export default function Navbar({
  onOpenCapture,
  onOpenImport,
  onOpenSazExport,
  onOpenApiKey,
  geminiKeyActive,
  realtimeConnected
}) {
  return (
    <header className="sticky top-0 z-30 w-full bg-white/95 backdrop-blur-xl border-b border-amber-200/60 shadow-sm">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-16 sm:h-20 flex items-center justify-between">
        {/* Brand identity */}
        <div className="flex items-center space-x-2.5 sm:space-x-3.5">
          <div className="relative">
            <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl sm:rounded-2xl bg-gradient-to-br from-amber-400 via-amber-500 to-amber-700 flex items-center justify-center shadow-md shadow-amber-500/20 text-white font-black text-lg sm:text-xl tracking-tighter">
              CL
            </div>
            <div className="absolute -bottom-1 -right-1 w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full bg-white flex items-center justify-center border border-amber-400 shadow-xs">
              <Sparkles className="w-2 sm:w-2.5 h-2 sm:h-2.5 text-amber-600" />
            </div>
          </div>

          <div>
            <div className="flex items-center space-x-1.5 sm:space-x-2">
              <h1 className="text-lg sm:text-2xl font-black tracking-wider uppercase font-sans text-slate-900">
                CLAREMM
              </h1>
              <span className="text-[9px] sm:text-[10px] font-bold tracking-widest uppercase px-1.5 sm:px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-300">
                VIP
              </span>
            </div>
            <p className="text-[11px] text-slate-500 font-medium hidden sm:block">
              Zapatería de Alta Gama • Panel de Control & Digitalización IA
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-1.5 sm:space-x-3">
          {/* Real-time SSE indicator */}
          <div className="hidden lg:flex items-center space-x-2 px-3 py-1.5 rounded-full bg-slate-100 border border-slate-200 text-xs">
            <span className="relative flex h-2 w-2">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${realtimeConnected ? 'bg-emerald-400' : 'bg-amber-400'}`}></span>
              <span className={`relative inline-flex rounded-full h-2 w-2 ${realtimeConnected ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
            </span>
            <span className="text-slate-700 text-[11px] font-semibold">
              {realtimeConnected ? 'En Vivo' : 'Conectando...'}
            </span>
          </div>

          {/* Gemini API Key config button */}
          <button
            type="button"
            onClick={onOpenApiKey}
            className={`p-2 sm:px-3 sm:py-2 rounded-xl text-xs font-semibold flex items-center space-x-1.5 border transition ${
              geminiKeyActive
                ? 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100/70 shadow-xs'
                : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100 animate-pulse'
            }`}
            title="Configurar o verificar API Key de Gemini"
          >
            <Key className="w-3.5 h-3.5 text-amber-600" />
            <span className="hidden sm:inline">
              {geminiKeyActive ? 'Gemini AI Activo' : 'Configurar Key'}
            </span>
          </button>

          {/* Button 1: Importar Excel */}
          <button
            type="button"
            onClick={onOpenImport}
            className="px-2.5 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs font-semibold bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 border border-slate-200 hover:border-slate-300 flex items-center space-x-1.5 sm:space-x-2 transition shadow-xs"
            title="Importar productos masivamente desde archivo Excel"
          >
            <FileSpreadsheet className="w-3.5 sm:w-4 h-3.5 sm:h-4 text-emerald-600" />
            <span className="hidden sm:inline">Importar Excel</span>
            <span className="sm:hidden font-medium">Excel</span>
          </button>

          <button type="button" onClick={onOpenSazExport}
            className="px-2.5 sm:px-4 py-2 rounded-xl text-xs font-semibold bg-amber-50 text-amber-900 border border-amber-300 hover:bg-amber-100 flex items-center gap-1.5"
            title="Descargar plantilla de alta masiva SAZ">
            <FileSpreadsheet className="w-4 h-4" /><span>Alta SAZ</span>
          </button>
          {/* Button 2: Capturar Producto */}
          <button
            type="button"
            onClick={onOpenCapture}
            className="gold-gradient-btn px-3 sm:px-5 py-2 sm:py-2.5 rounded-xl text-xs font-bold flex items-center space-x-1.5 sm:space-x-2 shadow-md hover:shadow-lg"
            title="Capturar nuevo producto con cámara y ficha técnica"
          >
            <Camera className="w-3.5 sm:w-4 h-3.5 sm:h-4 text-slate-950" />
            <span>Capturar</span>
          </button>
        </div>
      </div>
    </header>
  );
}
