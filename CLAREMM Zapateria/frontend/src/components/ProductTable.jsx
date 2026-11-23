import React, { useMemo, useState } from 'react';
import { 
  Search, Filter, ChevronLeft, ChevronRight, Edit2, 
  Trash2, Eye, Download, Image as ImageIcon, Sparkles, PlusCircle, Tag
} from 'lucide-react';
import { formatCorrida, getProductFieldOptions } from '../constants';

export default function ProductTable({
  products,
  pagination,
  loading,
  searchTerm,
  onSearchChange,
  filterMarca,
  onFilterMarcaChange,
  filterLinea,
  onFilterLineaChange,
  filterClasificacion,
  onFilterClasificacionChange,
  filterDateFrom,
  onFilterDateFromChange,
  filterDateTo,
  onFilterDateToChange,
  onPageChange,
  onLimitChange,
  onEditProduct,
  onDeleteProduct,
  onViewImage,
  onOpenCapture,
  onManageStock,
  onExportExcel,
  onDownloadProductImages,
  downloadingImages,
  productOptions = {}
}) {
  const [hoveredRow, setHoveredRow] = useState(null);
  const filterOptions = useMemo(() => ({
    clasificacion: getProductFieldOptions('clasificacion', productOptions),
    linea: getProductFieldOptions('linea', productOptions)
  }), [productOptions]);

  // Classification badge color styling for light mode
  const getBadgeClass = (clasif) => {
    const val = (clasif || '').toUpperCase();
    if (val.includes('CABALLERO')) return 'bg-blue-50 text-blue-700 border-blue-200';
    if (val.includes('DAMA')) return 'bg-pink-50 text-pink-700 border-pink-200';
    if (val.includes('NIÑO') || val.includes('NIÑA')) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (val.includes('DANZA') || val.includes('RODEO') || val.includes('VAQUERA')) return 'bg-purple-50 text-purple-700 border-purple-200';
    if (val.includes('DEPORTE') || val.includes('FUTBOL')) return 'bg-teal-50 text-teal-700 border-teal-200';
    return 'bg-amber-50 text-amber-800 border-amber-200';
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm space-y-4 p-3.5 sm:p-6">
      {/* Table Toolbar / Controls (Optimized for Mobile & Desktop) */}
      <div className="flex flex-col gap-3">
        {/* Top search row */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Buscar estilo, color, acabado, marca..."
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 hover:bg-white focus:bg-white border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition shadow-xs"
            />
          </div>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-row sm:shrink-0">
            <button
              type="button"
              onClick={onManageStock}
              className="min-w-0 px-2 sm:px-4 py-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-200 rounded-xl text-[11px] sm:text-xs font-semibold flex items-center justify-center gap-1.5 transition shadow-xs"
              title="Consultar o capturar existencia por talla"
            >
              <Tag className="w-4 h-4 text-emerald-700" />
              <span>Existencias</span>
            </button>
            <button
              type="button"
              onClick={onExportExcel}
              className="min-w-0 px-2 sm:px-4 py-2.5 bg-slate-50 hover:bg-slate-100 text-slate-700 hover:text-slate-900 border border-slate-200 rounded-xl text-[11px] sm:text-xs font-semibold flex items-center justify-center gap-1.5 transition shadow-xs"
              title="Elegir tipo de producto y rango de fechas para exportar a Excel"
            >
              <Download className="w-4 h-4 text-amber-600" />
              <span>Exportar Excel</span>
            </button>
            <button
              type="button"
              onClick={onDownloadProductImages}
              disabled={downloadingImages}
              className="col-span-2 min-w-0 px-2 sm:px-4 py-2.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 rounded-xl text-[11px] sm:text-xs font-semibold flex items-center justify-center gap-1.5 transition shadow-xs disabled:opacity-60 disabled:cursor-wait sm:col-span-1"
              title="Descargar fotos con nombre ESTILO-COLOR para el agente SAZ"
            >
              <ImageIcon className="w-4 h-4 text-amber-700" />
              <span>{downloadingImages ? 'Preparando ZIP...' : 'Imágenes para SAZ'}</span>
            </button>
          </div>
        </div>

        {/* Filter Dropdowns Row (Mobile Friendly) */}
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
          {/* 1. Clasificación Filter */}
          <select
            value={filterClasificacion}
            onChange={(e) => onFilterClasificacionChange(e.target.value)}
            className="w-full px-3 py-2 bg-slate-50 hover:bg-white border border-slate-200 rounded-xl text-xs text-slate-700 font-semibold focus:outline-none focus:border-amber-500 transition shadow-xs cursor-pointer"
          >
            <option value="">Todas las Clasificaciones</option>
            {filterOptions.clasificacion.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          {/* 2. Línea Filter */}
          <select
            value={filterLinea}
            onChange={(e) => onFilterLineaChange(e.target.value)}
            className="w-full px-3 py-2 bg-slate-50 hover:bg-white border border-slate-200 rounded-xl text-xs text-slate-700 font-semibold focus:outline-none focus:border-amber-500 transition shadow-xs cursor-pointer truncate"
          >
            <option value="">Todas las Líneas</option>
            {filterOptions.linea.map(l => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>

          <label className="flex flex-col gap-1 text-[10px] font-semibold text-slate-500">
            Fecha de registro desde
            <input
              type="date"
              value={filterDateFrom}
              max={filterDateTo || undefined}
              onChange={(e) => onFilterDateFromChange(e.target.value)}
              aria-label="Fecha de registro desde"
              className="w-full min-h-9 px-3 py-2 bg-slate-50 hover:bg-white border border-slate-200 rounded-xl text-xs text-slate-700 font-semibold focus:outline-none focus:border-amber-500 transition shadow-xs"
            />
          </label>

          <label className="flex flex-col gap-1 text-[10px] font-semibold text-slate-500">
            Fecha de registro hasta
            <input
              type="date"
              value={filterDateTo}
              min={filterDateFrom || undefined}
              onChange={(e) => onFilterDateToChange(e.target.value)}
              aria-label="Fecha de registro hasta"
              className="w-full min-h-9 px-3 py-2 bg-slate-50 hover:bg-white border border-slate-200 rounded-xl text-xs text-slate-700 font-semibold focus:outline-none focus:border-amber-500 transition shadow-xs"
            />
          </label>

          {/* Items per page selector */}
          <div className="col-span-2 flex items-center space-x-2 lg:col-span-1">
            <select
              value={pagination.limit}
              onChange={(e) => onLimitChange(Number(e.target.value))}
              className="w-full min-w-0 px-3 py-2 bg-slate-50 hover:bg-white border border-slate-200 rounded-xl text-xs text-slate-700 font-medium focus:outline-none focus:border-amber-500 shadow-xs cursor-pointer"
            >
              <option value={5}>5 productos por página</option>
              <option value={10}>10 productos por página</option>
              <option value={25}>25 productos por página</option>
              <option value={50}>50 productos por página</option>
            </select>
          </div>
        </div>
      </div>

      {/* DESKTOP & TABLET VIEW: LIGHT PREMIUM TABLE REPLICATING EXACT EXCEL FORMAT */}
      <div className="hidden md:block overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm text-slate-700 whitespace-nowrap">
          <thead className="bg-slate-50/90 text-slate-700 text-[11px] font-bold tracking-wider border-b border-slate-200 sticky top-0 z-10">
            <tr>
              <th className="py-3.5 px-4 text-left">Estilo</th>
              <th className="py-3.5 px-4 text-left">Color</th>
              <th className="py-3.5 px-4 text-left">Acabado</th>
              <th className="py-3.5 px-4 text-left">Descripcion</th>
              <th className="py-3.5 px-4 text-left">Corrida</th>
              <th className="py-3.5 px-4 text-left">Estado</th>
              <th className="py-3.5 px-4 text-center">Fecha Alta</th>
              <th className="py-3.5 px-4 text-left">Linea</th>
              <th className="py-3.5 px-4 text-left">Sublinea</th>
              <th className="py-3.5 px-4 text-left">Plantilla</th>
              <th className="py-3.5 px-4 text-left">Temporada</th>
              <th className="py-3.5 px-4 text-left">Clasificacion</th>
              <th className="py-3.5 px-4 text-left">Marca</th>
              <th className="py-3.5 px-4 text-right">Costo</th>
              <th className="py-3.5 px-4 text-right">Precio</th>
              <th className="py-3.5 px-4 text-center">Status</th>
              <th className="py-3.5 px-4 text-center">Observaciones</th>
              <th className="py-3.5 px-4 text-left">Catalogo</th>
              <th className="py-3.5 px-4 text-left">Comprador</th>
              <th className="py-3.5 px-4 text-center">Pagina</th>
              <th className="py-3.5 px-4 text-center">imagen</th>
              <th className="py-3.5 px-4 text-right sticky right-0 bg-slate-50/95 shadow-sm">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-sans">
            {loading ? (
              <tr>
                <td colSpan="22" className="py-12 text-center text-slate-500">
                  <div className="flex flex-col items-center justify-center space-y-2">
                    <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-xs">Cargando catálogo en tiempo real...</span>
                  </div>
                </td>
              </tr>
            ) : products.length === 0 ? (
              <tr>
                <td colSpan="22" className="py-12 text-center text-slate-500">
                  <div className="max-w-sm mx-auto space-y-3">
                    <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center mx-auto">
                      <ImageIcon className="w-6 h-6" />
                    </div>
                    <p className="text-sm font-semibold text-slate-800">No se encontraron productos</p>
                    <p className="text-xs text-slate-500">
                      {searchTerm ? 'Intenta modificar tus filtros de búsqueda.' : 'Aún no hay productos registrados en el catálogo.'}
                    </p>
                    <button
                      type="button"
                      onClick={onOpenCapture}
                      className="gold-gradient-btn px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center space-x-1.5 shadow-sm"
                    >
                      <PlusCircle className="w-3.5 h-3.5 text-slate-950" />
                      <span>Capturar Nuevo Producto</span>
                    </button>
                  </div>
                </td>
              </tr>
            ) : (
              products.map((p) => (
                <tr
                  key={p.id}
                  onMouseEnter={() => setHoveredRow(p.id)}
                  onMouseLeave={() => setHoveredRow(null)}
                  className="hover:bg-amber-50/40 transition group"
                >
                  {/* 1. Estilo */}
                  <td className="py-3 px-4 font-semibold text-slate-900">
                    <span className="font-mono text-amber-900 font-bold bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                      {p.estilo || 'S/E'}
                    </span>
                    {p.codigo_barras && (
                      <div className="text-[10px] text-slate-400 font-mono mt-0.5" title={`Código: ${p.codigo_barras}`}>
                        {p.codigo_barras}
                      </div>
                    )}
                  </td>

                  {/* 2. Color */}
                  <td className="py-3 px-4 text-slate-800 font-medium">
                    {p.color || <span className="text-slate-400">—</span>}
                  </td>

                  {/* 3. Acabado */}
                  <td className="py-3 px-4 text-slate-700">
                    {p.acabado || <span className="text-slate-400">—</span>}
                  </td>

                  {/* 4. Descripcion */}
                  <td className="py-3 px-4 text-slate-600 text-xs max-w-[180px] truncate" title={p.descripcion || ''}>
                    {p.descripcion || <span className="text-slate-400">—</span>}
                  </td>

                  {/* 5. Corrida */}
                  <td className="py-3 px-4 text-xs font-mono font-medium text-slate-800">
                    {p.corrida ? (
                      <span className="bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                        {formatCorrida(p.corrida)}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>

                  {/* 6. Estado */}
                  <td className="py-3 px-4 text-slate-600 text-xs">
                    {p.estado || <span className="text-slate-400">—</span>}
                  </td>

                  {/* 7. Fecha Alta */}
                  <td className="py-3 px-4 text-center text-xs font-mono text-slate-700">
                    {p.fecha_alta || '—'}
                  </td>

                  {/* 8. Linea */}
                  <td className="py-3 px-4 text-amber-800 font-semibold text-xs">
                    {p.linea || <span className="text-slate-400">—</span>}
                  </td>

                  {/* 9. Sublinea */}
                  <td className="py-3 px-4 text-slate-700 text-xs">
                    {p.sublinea || <span className="text-slate-400">—</span>}
                  </td>

                  {/* 10. Plantilla */}
                  <td className="py-3 px-4 text-xs font-semibold text-slate-700">
                    <span className="bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                      {p.plantilla || '—'}
                    </span>
                  </td>

                  {/* 11. Temporada */}
                  <td className="py-3 px-4 text-slate-600 text-xs font-medium">
                    {p.temporada || 'CLAREMM 26'}
                  </td>

                  {/* 12. Clasificacion */}
                  <td className="py-3 px-4">
                    <span className={`inline-block text-[11px] px-2.5 py-0.5 rounded-full border font-bold ${getBadgeClass(p.clasificacion)}`}>
                      {p.clasificacion || '—'}
                    </span>
                  </td>

                  {/* 13. Marca */}
                  <td className="py-3 px-4 font-bold text-slate-900">
                    {p.marca || <span className="text-slate-400">—</span>}
                  </td>

                  {/* 14. Costo */}
                  <td className="py-3 px-4 font-mono font-bold text-right">
                    {p.costo !== undefined && p.costo !== null && Number(p.costo) > 0 ? (
                      <span className="bg-amber-50 text-amber-900 px-2 py-0.5 rounded-md border border-amber-300">
                        ${Number(p.costo).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    ) : (
                      <span className="text-slate-400 font-sans text-xs">—</span>
                    )}
                  </td>

                  {/* 15. Precio */}
                  <td className="py-3 px-4 font-mono font-bold text-slate-900 text-right">
                    {p.precio !== undefined && p.precio !== null && Number(p.precio) > 0 ? (
                      <span className="bg-slate-100 text-slate-900 px-2.5 py-1 rounded-md border border-slate-200">
                        ${Number(p.precio).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    ) : (
                      <span className="text-slate-400 font-sans text-xs">—</span>
                    )}
                  </td>

                  {/* 16. Status */}
                  <td className="py-3 px-4 text-center">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      {p.status !== undefined && p.status !== null ? p.status : '—'}
                    </span>
                  </td>

                  {/* 17. Observaciones */}
                  <td className="py-3 px-4 text-center text-xs font-mono">
                    <span className="bg-amber-50 text-amber-900 px-2 py-0.5 rounded border border-amber-200 font-bold text-[11px]">
                      {p.observaciones || '—'}
                    </span>
                  </td>

                  {/* 18. Catalogo */}
                  <td className="py-3 px-4 text-xs font-mono text-slate-700">
                    {p.catalogo || <span className="text-slate-400">—</span>}
                  </td>

                  {/* 19. Comprador */}
                  <td className="py-3 px-4 text-xs text-slate-700">
                    <span className="bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                      {p.comprador || '—'}
                    </span>
                  </td>

                  {/* 20. Pagina */}
                  <td className="py-3 px-4 text-center font-mono text-xs text-slate-700">
                    {p.pagina !== undefined && p.pagina !== null ? p.pagina : '—'}
                  </td>

                  {/* 21. imagen */}
                  <td className="py-3 px-3 text-center">
                    <div
                      onClick={() => (p.imagen_thumbnail || p.imagen) && onViewImage(p.imagen_thumbnail || p.imagen, `Foto - Estilo: ${p.estilo}`)}
                      className="relative w-14 h-14 mx-auto rounded-xl border border-slate-200 bg-slate-50 p-0.5 overflow-hidden flex items-center justify-center cursor-pointer hover:border-amber-500 hover:shadow-md transition group/thumb"
                      title="Fotografía del producto. Clic para ampliar."
                    >
                      {(p.imagen_thumbnail || p.imagen) ? (
                        <>
                          <img
                            src={p.imagen_thumbnail || p.imagen}
                            alt={`Foto ${p.estilo}`}
                            className="w-full h-full object-cover rounded-lg group-hover/thumb:scale-105 transition duration-300"
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center text-white rounded-lg">
                            <Eye className="w-4 h-4" />
                          </div>
                        </>
                      ) : (
                        <ImageIcon className="w-5 h-5 text-slate-300" />
                      )}
                    </div>
                  </td>

                  {/* Acciones */}
                  <td className="py-3 px-4 text-right sticky right-0 bg-white group-hover:bg-[#FFFDF7] transition shadow-xs">
                    <div className="flex items-center justify-end space-x-1">
                      {p.ficha_imagen && (
                        <button
                          type="button"
                          onClick={() => onViewImage(p.ficha_imagen, `Ficha Técnica: ${p.estilo}`)}
                          className="p-2 text-slate-400 hover:text-amber-800 hover:bg-amber-50 rounded-lg transition"
                          title="Ver Ficha Técnica IA"
                        >
                          <Sparkles className="w-4 h-4 text-amber-600" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onEditProduct(p)}
                        className="p-2 text-slate-500 hover:text-amber-800 hover:bg-amber-100/70 rounded-lg transition"
                        title="Editar información del producto"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteProduct(p)}
                        className="p-2 text-slate-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition"
                        title="Ocultar producto del catálogo"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* MOBILE RESPONSIVE VIEW: LIGHT CARDS */}
      <div className="block md:hidden space-y-3">
        {loading ? (
          <div className="py-8 text-center text-xs text-slate-500">Cargando...</div>
        ) : products.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500">No hay productos</div>
        ) : (
          products.map(p => (
            <div
              key={p.id}
              className="min-w-0 overflow-hidden bg-white border border-slate-200 rounded-xl p-3 sm:p-4 space-y-3 shadow-xs"
            >
              {/* Mobile Image Gallery: Both Original & 100x100 */}
              <div className="flex min-w-0 items-start gap-2 sm:gap-2.5">
                {/* 1. Foto Original */}
                <div className="flex flex-col items-center shrink-0">
                  <div
                    onClick={() => p.imagen && onViewImage(p.imagen, `Foto Original - Estilo: ${p.estilo}`)}
                    className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center cursor-pointer shadow-xs"
                    title="Foto Original"
                  >
                    {p.imagen ? (
                      <img src={p.imagen} alt={`Original ${p.estilo}`} className="w-full h-full object-cover" />
                    ) : (
                      <ImageIcon className="w-5 h-5 text-slate-400" />
                    )}
                  </div>
                  <span className="text-[9px] font-medium text-slate-500 mt-1">Original</span>
                </div>

                {/* 2. Foto 100x100 */}
                <div className="flex flex-col items-center shrink-0">
                  <div
                    onClick={() => (p.imagen_thumbnail || p.imagen) && onViewImage(p.imagen_thumbnail || p.imagen, `Foto 100×100 px - Estilo: ${p.estilo}`)}
                    className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl border-2 border-amber-300 bg-white p-0.5 overflow-hidden flex items-center justify-center cursor-pointer shadow-xs"
                    title="Foto 100x100"
                  >
                    {(p.imagen_thumbnail || p.imagen) ? (
                      <img src={p.imagen_thumbnail || p.imagen} alt={`100x100 ${p.estilo}`} className="w-full h-full object-cover rounded-lg" />
                    ) : (
                      <ImageIcon className="w-5 h-5 text-slate-300" />
                    )}
                  </div>
                  <span className="text-[9px] font-bold text-amber-800 bg-amber-50 px-1 rounded border border-amber-200 mt-1">100×100</span>
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0 pl-1">
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-1">
                    <span className="min-w-0 font-mono text-amber-900 font-bold text-sm break-words">{p.estilo}</span>
                    <span className={`max-w-full text-[10px] px-2 py-0.5 rounded-full border shrink-0 ${getBadgeClass(p.clasificacion)}`}>
                      {p.clasificacion || 'General'}
                    </span>
                  </div>
                  <p className="text-xs font-bold text-slate-900 mt-0.5 truncate">{p.marca || 'Sin marca'}</p>
                  <p className="text-xs text-amber-800 truncate">{p.linea || 'Sin línea'} • {p.color || 'Color n/a'}</p>
                  {p.codigo_barras && (
                    <p className="text-[11px] font-mono text-slate-500 mt-0.5 truncate">Cód: {p.codigo_barras}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-2 gap-y-2 text-[11px] pt-2 border-t border-slate-100 text-slate-500 [&>div]:min-w-0 [&>div]:break-words">
                <div>Color: <span className="text-slate-800 font-medium">{p.color || '—'}</span></div>
                <div>Acabado: <span className="text-slate-800 font-medium">{p.acabado || '—'}</span></div>
                <div>Corrida: <span className="text-slate-800 font-medium font-mono">{formatCorrida(p.corrida) || '—'}</span></div>
                <div>Fecha Alta: <span className="text-slate-800 font-medium">{p.fecha_alta || '—'}</span></div>
                <div>Temporada: <span className="text-slate-800 font-medium">{p.temporada || '—'}</span></div>
                <div>Plantilla: <span className="text-slate-800 font-medium">{p.plantilla || '—'}</span></div>
                <div>Catálogo: <span className="text-slate-800 font-medium">{p.catalogo || '—'}</span></div>
                <div>Comprador: <span className="text-slate-800 font-medium">{p.comprador || '—'}</span></div>
                <div>Página: <span className="text-slate-800 font-medium">{p.pagina !== undefined && p.pagina !== null ? p.pagina : '—'}</span></div>
                <div>Status: <span className="text-emerald-700 font-bold">{p.status !== undefined && p.status !== null ? p.status : '—'}</span></div>
                <div>Línea: <span className="text-slate-800 font-medium">{p.linea || '—'}</span></div>
                <div>Sublínea: <span className="text-slate-800 font-medium">{p.sublinea || '—'}</span></div>
                <div className="col-span-2">Observaciones: <span className="text-amber-900 font-mono font-bold">{p.observaciones || '—'}</span></div>
              </div>

              {/* Mobile Price & Cost Banner */}
              <div className="flex items-center justify-between p-2 rounded-lg bg-amber-50/50 border border-amber-200/70 text-xs">
                <div>
                  <span className="text-slate-500 text-[10px] block">Precio Venta:</span>
                  <span className="font-mono font-bold text-slate-900">
                    {p.precio ? `$${Number(p.precio).toLocaleString('es-MX', { minimumFractionDigits: 2 })}` : '—'}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-amber-800 text-[10px] block font-medium">Costo (-30%):</span>
                  <span className="font-mono font-bold text-amber-900">
                    {p.costo ? `$${Number(p.costo).toLocaleString('es-MX', { minimumFractionDigits: 2 })}` : '—'}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                {p.ficha_imagen ? (
                  <button
                    type="button"
                    onClick={() => onViewImage(p.ficha_imagen, `Ficha: ${p.estilo}`)}
                    className="text-[11px] text-amber-800 font-bold flex items-center space-x-1"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                    <span>Ver Ficha IA</span>
                  </button>
                ) : <span />}

                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => onEditProduct(p)}
                    className="p-1.5 bg-slate-50 text-amber-800 rounded-lg border border-slate-200"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteProduct(p)}
                    className="p-1.5 bg-slate-50 text-red-700 rounded-lg border border-slate-200"
                    title="Ocultar producto del catálogo"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Pagination Footer */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 text-xs text-slate-500 border-t border-slate-100">
        <div>
          Mostrando página <span className="font-bold text-slate-800">{pagination.page}</span> de{' '}
          <span className="font-bold text-slate-800">{pagination.totalPages}</span> ({pagination.total} productos en total)
        </div>

        <div className="flex items-center space-x-2">
          <button
            type="button"
            disabled={pagination.page <= 1}
            onClick={() => onPageChange(pagination.page - 1)}
            className="p-2 rounded-xl border border-slate-200 bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50 disabled:opacity-40 disabled:pointer-events-none transition shadow-xs"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          {/* Page numbers */}
          <div className="flex items-center space-x-1">
            {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
              const pNum = i + 1;
              return (
                <button
                  key={pNum}
                  type="button"
                  onClick={() => onPageChange(pNum)}
                  className={`w-8 h-8 rounded-xl font-mono text-xs font-bold transition ${
                    pagination.page === pNum
                      ? 'gold-gradient-btn text-slate-950 shadow-xs'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {pNum}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            disabled={pagination.page >= pagination.totalPages}
            onClick={() => onPageChange(pagination.page + 1)}
            className="p-2 rounded-xl border border-slate-200 bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50 disabled:opacity-40 disabled:pointer-events-none transition shadow-xs"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
