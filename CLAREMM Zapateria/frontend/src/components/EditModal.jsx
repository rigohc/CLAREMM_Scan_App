import React, { useState, useEffect, useMemo } from 'react';
import { Edit3, X, Save, Upload, AlertCircle, Camera, Barcode, AlertTriangle } from 'lucide-react';
import { 
  DEFAULT_TEMPORADA,
  getFormattedDateDDMMYY, 
  formatCorrida,
  getProductFieldOptions
} from '../constants';
import { safeFetchJson } from '../utils/api';
import SearchableInput from './SearchableInput';

export default function EditModal({ isOpen, onClose, product, onProductUpdated, productOptions = {} }) {
  const [formData, setFormData] = useState({
    codigo_barras: '',
    estilo: '',
    color: '',
    acabado: '',
    descripcion: '',
    corrida: '',
    estado: '',
    fecha_alta: '',
    marca: '',
    temporada: DEFAULT_TEMPORADA,
    proveedor: '',
    sublinea: '',
    departamento: '',
    clasificacion: '',
    linea: '',
    suela: '',
    plantilla: '',
    tacon: '',
    forro: '',
    catalogo: '',
    comprador: '',
    pagina: '',
    status: '',
    observaciones: getFormattedDateDDMMYY(),
    precio: '',
    costo: ''
  });

  const [newImageFile, setNewImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);
  const [barcodeAlert, setBarcodeAlert] = useState(null);
  const searchableOptions = useMemo(() => {
    const fields = [
      'color', 'acabado', 'corrida', 'marca', 'proveedor', 'sublinea', 'temporada',
      'departamento', 'clasificacion', 'linea', 'suela', 'plantilla', 'tacon', 'forro',
      'catalogo', 'status'
    ];
    return Object.fromEntries(fields.map(field => [
      field,
      getProductFieldOptions(field, productOptions)
    ]));
  }, [productOptions]);

  useEffect(() => {
    if (product) {
      setFormData({
        codigo_barras: product.codigo_barras || '',
        estilo: product.estilo || '',
        color: product.color || '',
        acabado: product.acabado || '',
        descripcion: product.descripcion || '',
        corrida: formatCorrida(product.corrida || ''),
        estado: product.estado || '',
        fecha_alta: product.fecha_alta || '',
        marca: product.marca || '',
        temporada: product.temporada || DEFAULT_TEMPORADA,
        proveedor: product.proveedor || '',
        sublinea: product.sublinea || '',
        departamento: product.departamento || '',
        clasificacion: product.clasificacion || '',
        linea: product.linea || '',
        suela: product.suela || '',
        plantilla: product.plantilla || '',
        tacon: product.tacon || '',
        forro: product.forro || '',
        catalogo: product.catalogo || '',
        comprador: product.comprador || '',
        pagina: product.pagina !== undefined && product.pagina !== null ? product.pagina : '',
        status: product.status !== undefined && product.status !== null ? product.status : '',
        observaciones: product.observaciones || getFormattedDateDDMMYY(),
        precio: product.precio !== undefined && product.precio !== null ? product.precio : '',
        costo: product.costo !== undefined && product.costo !== null ? product.costo : ''
      });
      setImagePreview(product.imagen || null);
      setNewImageFile(null);
      setError(null);
      setBarcodeAlert(null);
    }
  }, [product]);

  if (!isOpen || !product) return null;

  const handleMarcaChange = (val) => {
    setFormData(prev => ({ ...prev, marca: val }));
  };

  const handlePrecioChange = (val) => {
    const cleaned = val.replace(/[^0-9.]/g, '');
    const pNum = parseFloat(cleaned);
    const cVal = (!isNaN(pNum) && pNum > 0) ? (pNum * 0.70).toFixed(2) : '';
    setFormData(prev => ({
      ...prev,
      precio: val,
      costo: cVal
    }));
  };

  const handleCostoChange = (val) => {
    setFormData(prev => ({
      ...prev,
      costo: val
    }));
  };

  const checkBarcodeDuplicate = async (barcode) => {
    if (!barcode || !barcode.trim()) {
      setBarcodeAlert(null);
      return;
    }
    try {
      const data = await safeFetchJson(`/api/products/check-barcode?barcode=${encodeURIComponent(barcode.trim())}&excludeId=${product.id}`);
      if (data && data.exists) {
        setBarcodeAlert({
          barcode: barcode.trim(),
          product: data.product,
          message: data.message
        });
      } else {
        setBarcodeAlert(null);
      }
    } catch (e) {
      console.warn('Barcode check error:', e);
    }
  };

  const handleBarcodeChange = (val) => {
    setFormData(prev => ({ ...prev, codigo_barras: val }));
    checkBarcodeDuplicate(val);
  };

  const handleImageChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setNewImageFile(file);
    const reader = new FileReader();
    reader.onload = (event) => {
      setImagePreview(event.target.result);
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!formData.estilo.trim()) {
      setError('El estilo es obligatorio.');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const submitData = new FormData();
      Object.keys(formData).forEach(key => {
        submitData.append(key, formData[key] || '');
      });

      if (newImageFile) {
        submitData.append('imagen', newImageFile);
      }

      const data = await safeFetchJson(`/api/products/${product.id}`, {
        method: 'PUT',
        body: submitData
      });

      if (data && data.success) {
        if (onProductUpdated) onProductUpdated(data.product);
        onClose();
      } else {
        setError(data?.message || 'Error al actualizar el producto.');
      }
    } catch (err) {
      setError('Error de conexión: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="relative w-full max-w-3xl bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col text-slate-800">
        {/* Header Light */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50/80">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-amber-50 border border-amber-300 text-amber-700">
              <Edit3 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900">Editar Producto #{product.id}</h3>
              <p className="text-xs text-slate-500">Modifica los detalles del calzado en el catálogo</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="p-6 overflow-y-auto space-y-5 flex-1 bg-white">
          {/* Duplicate Barcode Alert */}
          {barcodeAlert && (
            <div className="p-3.5 bg-red-50 border border-red-300 rounded-xl text-red-900 text-xs flex items-start space-x-2.5 animate-fadeIn">
              <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-red-800">⚠️ ALERTA: CÓDIGO DE BARRAS REPETIDO</p>
                <p className="mt-0.5 font-medium">{barcodeAlert.message}</p>
              </div>
            </div>
          )}

          {/* Images: Original and 100x100 Rendered */}
          <div className="flex flex-col sm:flex-row gap-4 items-center sm:items-start p-3.5 bg-slate-50/70 border border-slate-200 rounded-xl">
            {/* Foto Original */}
            <div className="flex flex-col items-center">
              <div className="relative w-28 h-28 rounded-xl border border-slate-200 bg-white overflow-hidden shrink-0 group shadow-xs">
                {imagePreview ? (
                  <img
                    src={imagePreview}
                    alt="Vista previa calzado"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-slate-400">
                    <Camera className="w-6 h-6 mb-1" />
                    <span className="text-[10px]">Sin foto</span>
                  </div>
                )}
                <label className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center cursor-pointer text-white">
                  <Upload className="w-4 h-4 mb-1" />
                  <span className="text-[10px] font-bold">Cambiar</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleImageChange}
                  />
                </label>
              </div>
              <span className="text-[10px] font-medium text-slate-500 mt-1">Foto Original</span>
            </div>

            {/* Foto 100x100 */}
            <div className="flex flex-col items-center">
              <div className="relative w-[100px] h-[100px] rounded-xl border-2 border-amber-300 bg-white p-0.5 overflow-hidden shrink-0 shadow-xs flex items-center justify-center">
                {(product.imagen_thumbnail || imagePreview) ? (
                  <img
                    src={product.imagen_thumbnail || imagePreview}
                    alt="100x100 px"
                    className="w-full h-full object-cover rounded-lg"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-slate-400">
                    <Camera className="w-5 h-5 mb-1 text-slate-300" />
                    <span className="text-[9px]">100×100</span>
                  </div>
                )}
              </div>
              <span className="text-[10px] font-bold text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 mt-1">
                100×100 px
              </span>
            </div>

            <div className="flex-1 text-xs text-slate-500 flex flex-col justify-center space-y-1.5 pl-2">
              <p className="font-semibold text-slate-800">Fotografías del producto</p>
              <p className="text-[11px] leading-relaxed">
                El sistema conserva la <strong className="text-slate-700">Foto Original</strong> en alta resolución y renderiza automáticamente la versión <strong className="text-amber-800">100×100 píxeles</strong>.
              </p>
              {product.ficha_imagen && (
                <div className="pt-1">
                  <span className="text-[10px] text-amber-900 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 font-medium">
                    ✓ Ficha técnica protegida a resolución original
                  </span>
                </div>
              )}
            </div>
          </div>

            <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
              {/* Código de barras */}
              <div className="sm:col-span-2">
                <label className="text-xs font-bold text-slate-700 flex items-center space-x-1.5 mb-1">
                  <Barcode className="w-4 h-4 text-amber-600" />
                  <span>Código de Barras</span>
                </label>
                <input
                  type="text"
                  value={formData.codigo_barras}
                  onChange={(e) => handleBarcodeChange(e.target.value)}
                  placeholder="Ej. 7501234567890"
                  className={`w-full px-3 py-2 bg-white border rounded-xl font-mono text-sm text-slate-900 focus:outline-none transition shadow-2xs ${
                    barcodeAlert
                      ? 'border-red-500 bg-red-50/50 text-red-900'
                      : 'border-slate-300 focus:border-amber-500'
                  }`}
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Estilo / Modelo <span className="text-amber-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.estilo}
                  onChange={(e) => setFormData({ ...formData, estilo: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-sm text-slate-900 focus:outline-none focus:border-amber-500 shadow-2xs"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Color</label>
                <SearchableInput
                  value={formData.color}
                  onChange={(value) => setFormData(prev => ({ ...prev, color: value }))}
                  options={searchableOptions.color}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-sm text-slate-900 focus:outline-none focus:border-amber-500 shadow-2xs"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Corrida de tallas <span className="text-amber-600">*</span>
                </label>
                <SearchableInput
                  required
                  pattern="[0-9]+([.][0-9]{1,2})?-[0-9]+([.][0-9]{1,2})?"
                  title="Usa el formato de talla inicial-final, por ejemplo 21.50-27.00."
                  value={formData.corrida}
                  onChange={(value) => setFormData(prev => ({ ...prev, corrida: formatCorrida(value) }))}
                  options={searchableOptions.corrida}
                  placeholder="21.50-27.00"
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-sm font-mono text-slate-900 focus:outline-none focus:border-amber-500 shadow-2xs"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Marca</label>
                <SearchableInput
                  value={formData.marca}
                  onChange={handleMarcaChange}
                  options={searchableOptions.marca}
                  placeholder="Ej. Claremm Royale"
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-sm text-slate-900 focus:outline-none focus:border-amber-500 shadow-2xs"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Acabado / Material</label>
                <SearchableInput
                  value={formData.acabado}
                  onChange={(value) => setFormData(prev => ({ ...prev, acabado: value }))}
                  options={searchableOptions.acabado}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-sm text-slate-900 focus:outline-none focus:border-amber-500 shadow-2xs"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Sublínea</label>
                <SearchableInput
                  value={formData.sublinea}
                  onChange={(value) => setFormData(prev => ({ ...prev, sublinea: value }))}
                  options={searchableOptions.sublinea}
                  placeholder="Escribe o busca una sublínea"
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-sm text-slate-900 focus:outline-none focus:border-amber-500 shadow-2xs"
                />
              </div>
            </div>

          {/* Detailed Specifications & Prices */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 border-t border-slate-200 pt-4">
            <div>
              <label className="text-xs font-bold text-slate-700 flex items-center justify-between mb-1">
                <span>Temporada</span>
                <span className="text-[9px] bg-amber-50 text-amber-800 px-1 rounded font-medium border border-amber-200">
                  CLAREMM 26
                </span>
              </label>
              <SearchableInput
                value={formData.temporada}
                onChange={(value) => setFormData(prev => ({ ...prev, temporada: value }))}
                options={searchableOptions.temporada}
                placeholder="CLAREMM 26"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:border-amber-500 shadow-2xs"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 flex items-center justify-between mb-1">
                <span>Proveedor</span>
              </label>
              <SearchableInput
                value={formData.proveedor}
                onChange={(value) => setFormData(prev => ({ ...prev, proveedor: value }))}
                options={searchableOptions.proveedor}
                placeholder="Escribe o busca un proveedor"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900 focus:outline-none focus:border-amber-500 shadow-2xs"
              />
            </div>

            {/* Departamento */}
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">Departamento</label>
              <SearchableInput
                value={formData.departamento}
                onChange={(value) => setFormData(prev => ({ ...prev, departamento: value }))}
                options={searchableOptions.departamento}
                placeholder="Escribe o busca un departamento"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:border-amber-500 shadow-2xs"
              />
            </div>

            {/* Clasificación Select */}
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">Clasificación</label>
              <SearchableInput
                value={formData.clasificacion}
                onChange={(value) => setFormData(prev => ({ ...prev, clasificacion: value }))}
                options={searchableOptions.clasificacion}
                placeholder="Escribe o busca una clasificación"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:border-amber-500 shadow-2xs cursor-pointer"
              />
            </div>

            {/* Línea Select */}
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">
                Línea de Calzado <span className="text-amber-600">*</span>
              </label>
              <SearchableInput
                required
                value={formData.linea}
                onChange={(value) => setFormData(prev => ({ ...prev, linea: value }))}
                options={searchableOptions.linea}
                placeholder="Escribe o busca una línea"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:border-amber-500 shadow-2xs cursor-pointer"
              />
            </div>

            {/* Suela */}
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">Suela</label>
              <SearchableInput
                value={formData.suela}
                onChange={(value) => setFormData(prev => ({ ...prev, suela: value }))}
                options={searchableOptions.suela}
                placeholder="Escribe o busca una suela"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:border-amber-500 shadow-2xs"
              />
            </div>

            {/* Plantilla */}
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">Plantilla</label>
              <SearchableInput
                value={formData.plantilla}
                onChange={(value) => setFormData(prev => ({ ...prev, plantilla: value }))}
                options={searchableOptions.plantilla}
                placeholder="Escribe o busca una plantilla"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:border-amber-500 shadow-2xs"
              />
            </div>

            {/* Tacón */}
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">Tacón</label>
              <SearchableInput
                value={formData.tacon}
                onChange={(value) => setFormData(prev => ({ ...prev, tacon: value }))}
                options={searchableOptions.tacon}
                placeholder="Escribe o busca un tacón"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:border-amber-500 shadow-2xs"
              />
            </div>

            {/* Forro */}
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">Forro</label>
              <SearchableInput
                value={formData.forro}
                onChange={(value) => setFormData(prev => ({ ...prev, forro: value }))}
                options={searchableOptions.forro}
                placeholder="Escribe o busca un forro"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:border-amber-500 shadow-2xs"
              />
            </div>

            {/* Catálogo */}
            <div>
              <label className="text-xs font-bold text-slate-700 flex items-center justify-between mb-1">
                <span>Catálogo <span className="text-amber-600">*</span></span>
              </label>
              <SearchableInput
                required
                value={formData.catalogo}
                onChange={(value) => setFormData(prev => ({ ...prev, catalogo: value }))}
                options={searchableOptions.catalogo}
                placeholder="Ej. Catálogo 2026"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-sm text-slate-900 focus:outline-none focus:border-amber-500 shadow-2xs"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">Status</label>
              <SearchableInput
                type="number"
                step="1"
                value={formData.status}
                onChange={(value) => setFormData(prev => ({ ...prev, status: value }))}
                options={searchableOptions.status}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-sm text-slate-900 focus:outline-none focus:border-amber-500 shadow-2xs"
              />
            </div>

            {/* Observaciones */}
            <div>
              <label className="text-xs font-bold text-slate-700 flex items-center justify-between mb-1">
                <span>Observaciones</span>
                <span className="text-[9px] bg-slate-100 text-slate-600 px-1 rounded font-mono">
                  dd/mm/yy
                </span>
              </label>
              <input
                type="text"
                value={formData.observaciones}
                onChange={(e) => setFormData({ ...formData, observaciones: e.target.value })}
                placeholder="dd/mm/yy"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-sm font-mono font-semibold text-slate-900 focus:outline-none focus:border-amber-500 shadow-2xs"
              />
            </div>

            {/* PRECIO ($) */}
            <div className="bg-amber-50/50 p-2.5 rounded-xl border border-amber-200">
              <label className="text-xs font-bold text-slate-800 block mb-1">
                Precio de Venta ($)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2 text-sm font-bold text-slate-500">$</span>
                <input
                  type="text"
                  value={formData.precio}
                  onChange={(e) => handlePrecioChange(e.target.value)}
                  placeholder="0.00"
                  className="w-full pl-7 pr-3 py-1.5 bg-white border border-slate-300 rounded-lg text-sm font-bold text-slate-900 focus:outline-none focus:border-amber-500 shadow-2xs"
                />
              </div>
            </div>

            {/* COSTO (-30%) ($) */}
            <div className="bg-amber-50/50 p-2.5 rounded-xl border border-amber-200">
              <label className="text-xs font-bold text-amber-900 flex items-center justify-between mb-1">
                <span>Costo (-30%) ($)</span>
                <span className="text-[9px] bg-amber-200 text-amber-900 px-1 rounded font-bold">-30%</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2 text-sm font-bold text-amber-700">$</span>
                <input
                  type="text"
                  value={formData.costo}
                  onChange={(e) => handleCostoChange(e.target.value)}
                  placeholder="0.00"
                  className="w-full pl-7 pr-3 py-1.5 bg-white border border-amber-300 rounded-lg text-sm font-bold text-amber-900 focus:outline-none focus:border-amber-500 shadow-2xs"
                />
              </div>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-300 text-red-800 text-xs rounded-xl flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          {/* Footer buttons */}
          <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-600 hover:text-slate-900 text-sm font-semibold hover:bg-slate-100 transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="gold-gradient-btn px-6 py-2.5 rounded-xl text-sm font-bold flex items-center space-x-2 disabled:opacity-50 shadow-sm"
            >
              <Save className="w-4 h-4 text-slate-950" />
              <span>{isSaving ? 'Guardando...' : 'Guardar Cambios'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
