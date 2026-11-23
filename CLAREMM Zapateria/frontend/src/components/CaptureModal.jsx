import React, { useEffect, useMemo, useRef, useState } from 'react';
import { 
  Camera, Upload, Sparkles, AlertTriangle, CheckCircle2, 
  X, Save, RefreshCw, Layers, Tag, Eye, Info, Barcode
} from 'lucide-react';
import confetti from 'canvas-confetti';
import WebcamViewfinder from './WebcamViewfinder';
import SizeQuantityGrid from './SizeQuantityGrid';
import { 
  DEFAULT_TEMPORADA,
  getFormattedDateDDMMYY,
  formatCorrida,
  getProductFieldOptions
} from '../constants';
import { safeFetchJson } from '../utils/api';
import { getSizesForCorrida } from '../utils/inventory';
import SearchableInput from './SearchableInput';

const createInitialFormData = () => ({
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

export default function CaptureModal({ isOpen, onClose, onProductSaved, onOpenApiKeyModal, productOptions = {} }) {
  // Photos state
  const [productPhoto, setProductPhoto] = useState(null);
  const [productPhotoPreview, setProductPhotoPreview] = useState(null);
  const [matchedCatalogImage, setMatchedCatalogImage] = useState(null);
  const [imageLookupStatus, setImageLookupStatus] = useState('idle');
  const [imageLookupMessage, setImageLookupMessage] = useState('');
  
  const [fichaPhoto, setFichaPhoto] = useState(null);
  const [fichaPhotoPreview, setFichaPhotoPreview] = useState(null);

  // Webcam modal states
  const [activeCameraTarget, setActiveCameraTarget] = useState(null);

  // AI Extraction states
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionResult, setExtractionResult] = useState(null);
  const [aiDetectedFields, setAiDetectedFields] = useState(new Set());

  // Duplicate Barcode Alert state
  const [barcodeAlert, setBarcodeAlert] = useState(null);

  // Product form fields
  const [formData, setFormData] = useState(createInitialFormData);
  const captureBodyRef = useRef(null);
  const [sizeQuantities, setSizeQuantities] = useState({});
  const stockSizes = useMemo(() => getSizesForCorrida(formData.corrida), [formData.corrida]);

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(null);
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
    const validSizes = new Set(stockSizes);
    setSizeQuantities(previous => Object.fromEntries(
      Object.entries(previous).filter(([size]) => validSizes.has(size))
    ));
  }, [stockSizes]);

  useEffect(() => {
    const estilo = formData.estilo.trim();
    const color = formData.color.trim();
    if (!isOpen || saveSuccess || productPhoto || !estilo || !color) return undefined;

    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      setImageLookupStatus('loading');
      const query = new URLSearchParams({ estilo, color });
      const data = await safeFetchJson(`/api/product-images/lookup?${query}`, {
        signal: controller.signal
      });
      if (controller.signal.aborted) return;

      if (!data.success) {
        setImageLookupStatus('error');
        setImageLookupMessage(data.message || 'No se pudo consultar la carpeta de imágenes.');
      } else if (data.found) {
        setMatchedCatalogImage({ estilo, color, filename: data.filename });
        setProductPhotoPreview(data.imageUrl);
        setImageLookupStatus('found');
      } else {
        setImageLookupStatus('not-found');
      }
    }, 250);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [isOpen, formData.estilo, formData.color, productPhoto, saveSuccess]);

  if (!isOpen) return null;

  const handleMarcaChange = (val) => {
    setFormData(prev => ({ ...prev, marca: val }));
  };

  const handleStyleColorChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setSaveSuccess(null);
    if (!productPhoto) {
      setMatchedCatalogImage(null);
      setImageLookupStatus('idle');
      setImageLookupMessage('');
      setProductPhotoPreview(null);
    }
  };

  // Auto-calculate costo by subtracting 30% from precio
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

  // Real-time Barcode Duplicate Check (guaranteed safe against pattern mismatch errors)
  const checkBarcodeDuplicate = async (barcode) => {
    if (!barcode || !barcode.trim()) {
      setBarcodeAlert(null);
      return;
    }
    try {
      const data = await safeFetchJson(`/api/products/check-barcode?barcode=${encodeURIComponent(barcode.trim())}`);
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

  const clearCaptureMedia = () => {
    setProductPhoto(null);
    setProductPhotoPreview(null);
    setMatchedCatalogImage(null);
    setImageLookupStatus('idle');
    setImageLookupMessage('');
    setFichaPhoto(null);
    setFichaPhotoPreview(null);
    setExtractionResult(null);
    setAiDetectedFields(new Set());
    setBarcodeAlert(null);
  };

  // Automatic Gemini AI extraction triggered as soon as photo is taken or file uploaded
  const triggerAutoExtraction = async (photoOverride = null, previewOverride = null) => {
    const photoToUse = photoOverride || fichaPhoto;
    const previewToUse = previewOverride || fichaPhotoPreview;

    if (!photoToUse && !previewToUse) {
      alert('Por favor captura o sube primero la fotografía de la ficha técnica / código de barras.');
      return;
    }

    setIsExtracting(true);
    setExtractionResult(null);
    setSaveSuccess(null);

    try {
      let data;
      // If photo is a base64 string, post directly as JSON to bypass Multer and maximize speed
      if (typeof photoToUse === 'string' && photoToUse.startsWith('data:')) {
        data = await safeFetchJson('/api/ai/extract-ficha', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fichaBase64: photoToUse })
        });
      } else if (photoToUse instanceof File) {
        const apiFormData = new FormData();
        apiFormData.append('ficha', photoToUse);
        data = await safeFetchJson('/api/ai/extract-ficha', {
          method: 'POST',
          body: apiFormData
        });
      } else if (typeof previewToUse === 'string' && previewToUse.startsWith('data:')) {
        data = await safeFetchJson('/api/ai/extract-ficha', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fichaBase64: previewToUse })
        });
      }

      if (data && data.success) {
        if (!productPhoto && (
          (data.extractedData?.estilo && data.extractedData.estilo !== formData.estilo)
          || (data.extractedData?.color && data.extractedData.color !== formData.color)
        )) {
          setMatchedCatalogImage(null);
          setImageLookupStatus('idle');
          setProductPhotoPreview(null);
        }
        const foundFields = new Set(data.foundFields);
        const extractedUpdates = Object.fromEntries(
          Object.entries(data.extractedData || {}).filter(([field, value]) => (
            foundFields.has(field)
            && value !== null
            && value !== undefined
            && String(value).trim() !== ''
          ))
        );
        setFormData(prev => ({ ...prev, ...extractedUpdates }));

        setAiDetectedFields(foundFields);
        setExtractionResult({
          success: true,
          foundFields: data.foundFields,
          missingFields: data.missingFields,
          completionRate: data.completionRate,
          modelUsed: data.modelUsed,
          elapsedSeconds: data.elapsedSeconds
        });

        if (data.duplicateBarcodeFound) {
          setBarcodeAlert({
            barcode: data.duplicateBarcodeFound.barcode,
            product: data.duplicateBarcodeFound.existingProduct,
            message: data.duplicateBarcodeFound.warning
          });
        } else if (data.extractedData?.codigo_barras) {
          checkBarcodeDuplicate(data.extractedData.codigo_barras);
        }
      } else {
        setExtractionResult({
          success: false,
          error: data?.error,
          message: data?.message || 'No se pudo extraer la información con Gemini.',
          missingFields: data?.missingFields || ['estilo', 'color', 'acabado', 'marca', 'temporada', 'proveedor', 'sublinea', 'clasificacion', 'linea']
        });
      }
    } catch (err) {
      console.error('Error during AI extraction:', err);
      setExtractionResult({
        success: false,
        message: 'Error de conexión con el servicio de IA: ' + err.message,
        missingFields: ['estilo', 'color', 'acabado', 'marca', 'temporada', 'proveedor', 'sublinea', 'clasificacion', 'linea']
      });
    } finally {
      setIsExtracting(false);
    }
  };

  // Handle file uploads (automatically extracts if target is ficha/barcode)
  const handleFileUpload = (e, target) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSaveSuccess(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target.result;
      if (target === 'product') {
        setProductPhoto(file);
        setProductPhotoPreview(dataUrl);
        setMatchedCatalogImage(null);
        setImageLookupStatus('idle');
        setImageLookupMessage('');
      } else {
        setFichaPhoto(file);
        setFichaPhotoPreview(dataUrl);
        // Instant automatic OCR extraction upon file upload
        triggerAutoExtraction(file, dataUrl);
      }
    };
    reader.readAsDataURL(file);
  };

  // Handle webcam capture (automatically extracts if target is ficha/barcode)
  const handleWebcamCapture = (dataUrl) => {
    if (activeCameraTarget === 'product') {
      setSaveSuccess(null);
      setProductPhoto(dataUrl);
      setProductPhotoPreview(dataUrl);
      setMatchedCatalogImage(null);
      setImageLookupStatus('idle');
      setImageLookupMessage('');
    } else if (activeCameraTarget === 'ficha') {
      setFichaPhoto(dataUrl);
      setFichaPhotoPreview(dataUrl);
      // Instant automatic OCR extraction upon camera snapshot acceptance
      triggerAutoExtraction(dataUrl, dataUrl);
    }
    setActiveCameraTarget(null);
  };

  // Manual button trigger alias
  const handleExtractWithGemini = () => {
    triggerAutoExtraction();
  };

  // Save product
  const handleSave = async (e) => {
    e.preventDefault();
    if (!formData.estilo.trim()) {
      setSaveError('El campo "Estilo" es obligatorio.');
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(null);

    try {
      const submitData = new FormData();
      Object.keys(formData).forEach(key => {
        submitData.append(key, formData[key] || '');
      });
      const initialStock = Object.entries(sizeQuantities)
        .filter(([, quantity]) => quantity !== '')
        .map(([size, quantity]) => ({ size, quantity: Number(quantity) }));
      if (initialStock.length) {
        submitData.append('stockItems', JSON.stringify(initialStock));
      }

      const currentMatch = matchedCatalogImage?.estilo === formData.estilo.trim()
        && matchedCatalogImage?.color === formData.color.trim();
      let useCatalogImage = Boolean(currentMatch);
      if (!productPhoto && !useCatalogImage && formData.estilo.trim() && formData.color.trim()) {
        const query = new URLSearchParams({
          estilo: formData.estilo.trim(),
          color: formData.color.trim()
        });
        const lookup = await safeFetchJson(`/api/product-images/lookup?${query}`);
        if (!lookup.success) {
          throw new Error(lookup.message || 'No se pudo consultar la carpeta de imágenes.');
        }
        useCatalogImage = Boolean(lookup.found);
      }

      if (productPhoto instanceof File) {
        submitData.append('imagen', productPhoto);
      } else if (typeof productPhoto === 'string' && productPhoto.startsWith('data:')) {
        submitData.append('imagenBase64', productPhoto);
      } else if (useCatalogImage) {
        submitData.append('imagenCatalogo', 'true');
      }

      if (fichaPhoto instanceof File) {
        submitData.append('ficha_imagen', fichaPhoto);
      } else if (typeof fichaPhoto === 'string' && fichaPhoto.startsWith('data:')) {
        submitData.append('fichaBase64', fichaPhoto);
      }

      const result = await safeFetchJson('/api/products', {
        method: 'POST',
        body: submitData
      });

      if (result.success) {
        const stockCount = initialStock.reduce((total, item) => total + item.quantity, 0);
        try {
          confetti({
            particleCount: 80,
            spread: 70,
            origin: { y: 0.6 },
            colors: ['#D4AF37', '#F3E5AB', '#AA7C11', '#10B981']
          });
        } catch (e) {}

        if (onProductSaved) {
          onProductSaved(result.product);
        }
        clearCaptureMedia();
        setSizeQuantities({});
        setSaveSuccess(
          stockCount > 0
            ? `Producto guardado con ${stockCount} pares de existencia inicial. Los datos se conservaron para capturar el siguiente.`
            : 'Producto guardado. Los datos se conservaron para capturar el siguiente.'
        );
        requestAnimationFrame(() => {
          captureBodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
        });
      } else {
        setSaveError(result.message || 'Error al guardar el producto.');
      }
    } catch (err) {
      setSaveError('Error de red al guardar: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    clearCaptureMedia();
    setFormData(createInitialFormData());
    setSaveError(null);
    setSaveSuccess(null);
    onClose();
  };

  const fieldLabels = {
    estilo: 'Estilo / Modelo',
    color: 'Color',
    acabado: 'Acabado / Material',
    marca: 'Marca',
    temporada: 'Temporada',
    proveedor: 'Proveedor',
    sublinea: 'Sublínea',
    departamento: 'Departamento',
    clasificacion: 'Clasificación',
    linea: 'Línea de Calzado',
    suela: 'Suela',
    plantilla: 'Plantilla',
    tacon: 'Tacón',
    forro: 'Forro',
    catalogo: 'Catálogo',
    observaciones: 'Observaciones',
    precio: 'Precio de Venta ($)',
    costo: 'Costo (-30%) ($)'
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-md flex items-center justify-center p-0 sm:p-5 overflow-y-auto">
        <div className="relative w-full max-w-5xl bg-white border border-slate-200 shadow-2xl rounded-none sm:rounded-2xl overflow-hidden my-auto animate-fadeIn h-dvh sm:h-auto max-h-dvh sm:max-h-[92vh] flex flex-col text-slate-800">
          {/* Header Light */}
          <div className="flex items-center justify-between gap-2 px-3 py-3 sm:px-6 sm:py-4 border-b border-slate-200 bg-slate-50/80 shrink-0">
            <div className="flex min-w-0 items-center space-x-2 sm:space-x-3">
              <div className="hidden sm:block p-2.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-700">
                <Camera className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center space-x-2">
                  <h3 className="font-bold text-slate-900 text-base sm:text-lg">Capturar Producto</h3>
                  <span className="hidden sm:inline-flex text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-300">
                    VIP DUAL CAPTURE & AI
                  </span>
                </div>
                <p className="hidden sm:block text-xs text-slate-500">
                  Toma la foto del producto y de la ficha técnica para extraer los datos con Gemini AI
                </p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="p-2 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Scrollable Body */}
          <div ref={captureBodyRef} className="min-h-0 p-3 sm:p-6 overflow-y-auto space-y-4 sm:space-y-6 flex-1 bg-white">
            {/* DUAL PHOTOGRAPHY SECTION */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-5">
              {/* PHOTO 1: PRODUCT */}
              <div className="bg-slate-50/70 border border-slate-200 rounded-xl p-3 sm:p-4 flex flex-col space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="w-6 h-6 rounded-full bg-amber-100 text-amber-800 font-bold text-xs flex items-center justify-center border border-amber-300">
                      1
                    </span>
                    <h4 className="text-sm font-bold text-slate-800">Foto 1: Calzado / Producto</h4>
                  </div>
                  {productPhotoPreview && (
                    <span className="text-[11px] text-emerald-700 font-semibold flex items-center space-x-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{matchedCatalogImage ? 'Encontrada por estilo y color' : 'Cargada'}</span>
                    </span>
                  )}
                </div>

                <div className="relative border-2 border-dashed border-slate-300 rounded-xl bg-white min-h-[150px] sm:min-h-[190px] flex items-center justify-center overflow-hidden group">
                  {productPhotoPreview ? (
                    <div className="relative w-full h-[150px] sm:h-[190px]">
                      <img
                        src={productPhotoPreview}
                        alt="Foto del calzado"
                        className="w-full h-full object-contain bg-slate-50"
                      />
                      {/* Miniatura 100x100 preview */}
                      <div className="absolute bottom-2 right-2 bg-white/95 backdrop-blur-sm border-2 border-amber-400 rounded-lg p-1.5 shadow-md flex items-center space-x-2 z-10">
                        <div className="w-12 h-12 rounded overflow-hidden border border-slate-200 bg-white shrink-0">
                          <img src={productPhotoPreview} alt="100x100" className="w-full h-full object-cover" />
                        </div>
                        <div className="text-[10px] pr-1">
                          <span className="font-bold text-amber-900 block leading-tight">100×100 px</span>
                          <span className="text-[9px] text-emerald-700 font-semibold">Generando</span>
                        </div>
                      </div>
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center space-x-2 z-20">
                        <button
                          type="button"
                          onClick={() => setActiveCameraTarget('product')}
                          className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-lg flex items-center space-x-1 transition shadow"
                        >
                          <Camera className="w-3.5 h-3.5" />
                          <span>Retomar</span>
                        </button>
                        <label className="cursor-pointer px-3 py-1.5 bg-white text-slate-800 hover:bg-slate-100 text-xs font-bold rounded-lg flex items-center space-x-1 transition shadow">
                          <Upload className="w-3.5 h-3.5" />
                          <span>Cambiar</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => handleFileUpload(e, 'product')}
                          />
                        </label>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 text-center space-y-3">
                      <div className="w-11 h-11 rounded-full bg-amber-50 text-amber-700 flex items-center justify-center mx-auto border border-amber-200">
                        <Camera className="w-5 h-5" />
                      </div>
                      <p className="text-xs text-slate-500 font-medium">Captura o sube la foto del calzado terminado</p>
                      <div className="flex items-center justify-center space-x-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setActiveCameraTarget('product')}
                          className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 text-xs font-bold rounded-lg flex items-center space-x-1 transition shadow-2xs"
                        >
                          <Camera className="w-3.5 h-3.5" />
                          <span>Abrir Cámara</span>
                        </button>
                        <label className="cursor-pointer px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 text-xs font-semibold rounded-lg flex items-center space-x-1 transition shadow-2xs">
                          <Upload className="w-3.5 h-3.5" />
                          <span>Subir Archivo</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => handleFileUpload(e, 'product')}
                          />
                        </label>
                      </div>
                    </div>
                  )}
                </div>
                {imageLookupStatus === 'loading' && (
                  <p className="text-[11px] text-slate-500">Buscando imagen para {formData.estilo}-{formData.color}...</p>
                )}
                {imageLookupStatus === 'found' && matchedCatalogImage && (
                  <p className="text-[11px] text-emerald-700">
                    Imagen de referencia: <strong>{matchedCatalogImage.filename}</strong>. Se guardará con el producto.
                  </p>
                )}
                {imageLookupStatus === 'not-found' && (
                  <p className="text-[11px] text-slate-500">No se encontró una imagen con el nombre estilo-color.</p>
                )}
                {imageLookupStatus === 'error' && (
                  <p className="text-[11px] text-red-700">{imageLookupMessage}</p>
                )}
              </div>

              {/* PHOTO 2: FICHA TÉCNICA */}
              <div className="bg-slate-50/70 border border-slate-200 rounded-xl p-3 sm:p-4 flex flex-col space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="w-6 h-6 rounded-full bg-amber-100 text-amber-800 font-bold text-xs flex items-center justify-center border border-amber-300">
                      2
                    </span>
                    <h4 className="text-sm font-bold text-slate-800">Foto 2: Ficha Técnica / Etiqueta</h4>
                  </div>
                  {fichaPhotoPreview && (
                    <span className="text-[11px] text-emerald-700 font-semibold flex items-center space-x-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Cargada</span>
                    </span>
                  )}
                </div>

                <div className="relative border-2 border-dashed border-slate-300 rounded-xl bg-white min-h-[150px] sm:min-h-[190px] flex items-center justify-center overflow-hidden group">
                  {fichaPhotoPreview ? (
                    <div className="relative w-full h-[150px] sm:h-[190px]">
                      <img
                        src={fichaPhotoPreview}
                        alt="Foto de la ficha técnica"
                        className="w-full h-full object-contain bg-slate-50"
                      />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center space-x-2">
                        <button
                          type="button"
                          onClick={() => setActiveCameraTarget('ficha')}
                          className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-lg flex items-center space-x-1 transition shadow"
                        >
                          <Camera className="w-3.5 h-3.5" />
                          <span>Retomar</span>
                        </button>
                        <label className="cursor-pointer px-3 py-1.5 bg-white text-slate-800 hover:bg-slate-100 text-xs font-bold rounded-lg flex items-center space-x-1 transition shadow">
                          <Upload className="w-3.5 h-3.5" />
                          <span>Cambiar</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => handleFileUpload(e, 'ficha')}
                          />
                        </label>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 text-center space-y-3">
                      <div className="w-11 h-11 rounded-full bg-amber-50 text-amber-700 flex items-center justify-center mx-auto border border-amber-200">
                        <Sparkles className="w-5 h-5" />
                      </div>
                      <p className="text-xs text-slate-500 font-medium">Captura la ficha técnica para extracción IA</p>
                      <div className="flex items-center justify-center space-x-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setActiveCameraTarget('ficha')}
                          className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 text-xs font-bold rounded-lg flex items-center space-x-1 transition shadow-2xs"
                        >
                          <Camera className="w-3.5 h-3.5" />
                          <span>Abrir Cámara</span>
                        </button>
                        <label className="cursor-pointer px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 text-xs font-semibold rounded-lg flex items-center space-x-1 transition shadow-2xs">
                          <Upload className="w-3.5 h-3.5" />
                          <span>Subir Archivo</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => handleFileUpload(e, 'ficha')}
                          />
                        </label>
                      </div>
                    </div>
                  )}
                </div>

                {/* AI Extract Button for Ficha (Auto-triggered upon photo capture/upload) */}
                <button
                  type="button"
                  disabled={!fichaPhotoPreview || isExtracting}
                  onClick={handleExtractWithGemini}
                  className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center space-x-2 transition ${
                    fichaPhotoPreview && !isExtracting
                      ? 'gold-gradient-btn'
                      : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
                  }`}
                >
                  <Sparkles className="w-4 h-4 text-amber-950" />
                  <span>
                    {isExtracting
                      ? '⚡ Extrayendo datos automáticamente (Flash-Lite)...'
                      : '⚡ Re-extraer Datos con Gemini Ultra-Fast OCR'}
                  </span>
                </button>
              </div>
            </div>

            {/* DUPLICATE BARCODE PROMINENT ALERT */}
            {barcodeAlert && (
              <div className="p-4 rounded-xl border border-red-300 bg-red-50 text-red-900 flex items-start space-x-3 shadow-sm animate-fadeIn">
                <AlertTriangle className="w-6 h-6 text-red-600 shrink-0 mt-0.5 animate-pulse" />
                <div className="space-y-1.5 flex-1">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold text-red-800 flex items-center space-x-2">
                      <span>⚠️ ALERTA: CÓDIGO DE BARRAS REPETIDO</span>
                    </h4>
                    <span className="text-[10px] font-mono bg-red-100 text-red-800 px-2 py-0.5 rounded border border-red-300 font-bold">
                      Código: {barcodeAlert.barcode}
                    </span>
                  </div>
                  <p className="text-xs text-red-800 font-medium">
                    {barcodeAlert.message}
                  </p>
                  <p className="text-[11px] text-slate-600">
                    💡 <strong>Acción recomendada:</strong> Verifica si se trata de un reabastecimiento del modelo existente, o ingresa un código de barras único para este nuevo producto.
                  </p>
                </div>
              </div>
            )}

            {/* AI EXTRACTION STATUS & NOTIFICATIONS */}
            {isExtracting && (
              <div className="p-4 rounded-xl border-2 border-amber-400 bg-amber-50/90 flex items-center space-x-3 shadow-sm animate-pulse">
                <div className="animate-spin text-amber-700">
                  <RefreshCw className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-amber-900 flex items-center space-x-1.5">
                    <span>⚡ Extrayendo datos automáticamente con Gemini AI...</span>
                  </h4>
                  <p className="text-xs text-amber-800 mt-0.5">
                    Leyendo código de barras, estilo, color, acabado, marca, precio, costo y clasificación en alta velocidad...
                  </p>
                </div>
              </div>
            )}

            {extractionResult && (
              <div className="space-y-2 animate-fadeIn">
                {extractionResult.success ? (
                  <div className={`p-4 rounded-xl border ${
                    extractionResult.missingFields.length === 0
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                      : 'bg-amber-50 border-amber-300 text-amber-900'
                  }`}>
                    <div className="flex items-start space-x-3">
                      {extractionResult.missingFields.length === 0 ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                      )}
                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <h4 className="text-sm font-bold">
                            {extractionResult.missingFields.length === 0
                              ? '¡Extracción 100% Exitosa!'
                              : `Extracción completada (${extractionResult.foundFields.length} campos identificados)`}
                          </h4>
                          <span className="text-[10px] bg-emerald-50 text-emerald-800 px-2.5 py-0.5 rounded-full font-mono font-bold border border-emerald-300 flex items-center space-x-1 shadow-2xs">
                            <span>⚡</span>
                            <span>{extractionResult.elapsedSeconds ? `${extractionResult.elapsedSeconds}s` : 'Ultra-rápido'}</span>
                            <span>•</span>
                            <span>{extractionResult.modelUsed}</span>
                          </span>
                        </div>

                        {extractionResult.missingFields.length > 0 ? (
                          <div className="text-xs space-y-1 text-amber-800">
                            <p>
                              <strong className="text-amber-900">Campos no detectados en la ficha: </strong>
                              {extractionResult.missingFields.map(f => fieldLabels[f] || f).join(', ')}.
                            </p>
                            <p className="text-slate-600 text-[11px]">
                              💡 Puedes llenarlos manualmente en los campos resaltados a continuación, o dejarlos vacíos si no aplican.
                            </p>
                          </div>
                        ) : (
                          <p className="text-xs text-emerald-800">
                            Todos los datos del calzado fueron identificados automáticamente. Revisa y guarda cuando estés listo.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl border border-red-200 bg-red-50 text-red-900 flex items-start justify-between">
                    <div className="flex items-start space-x-3">
                      <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                      <div>
                        <h4 className="text-sm font-bold text-red-800">No se pudo completar la extracción automática</h4>
                        <p className="text-xs text-red-700 mt-0.5">{extractionResult.message}</p>
                        <p className="text-xs text-slate-600 mt-1">
                          Puedes capturar los campos manualmente a continuación.
                        </p>
                      </div>
                    </div>
                    {extractionResult.error === 'NO_API_KEY' && (
                      <button
                        type="button"
                        onClick={onOpenApiKeyModal}
                        className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-lg transition"
                      >
                        Configurar Key
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* PRODUCT SPECIFICATION FORM */}
            <form id="capture-product-form" onSubmit={handleSave} className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <div className="flex items-center space-x-2">
                  <Tag className="w-4 h-4 text-amber-600" />
                  <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                    Datos del Producto
                  </h4>
                </div>
                <span className="text-xs text-slate-500">
                  {aiDetectedFields.size > 0 && `${aiDetectedFields.size} autocompletados por IA`}
                </span>
              </div>

              {/* 0. CÓDIGO DE BARRAS */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-800 flex items-center space-x-1.5">
                    <Barcode className="w-4 h-4 text-amber-600" />
                    <span>Código de Barras (EAN / UPC / SKU)</span>
                  </label>
                  {barcodeAlert ? (
                    <span className="text-[10px] text-red-700 font-bold bg-red-100 px-2 py-0.5 rounded border border-red-300 animate-pulse">
                      ⚠️ Código Repetido
                    </span>
                  ) : formData.codigo_barras ? (
                    <span className="text-[10px] text-emerald-700 font-semibold">✓ Código Disponible</span>
                  ) : (
                    <span className="text-[10px] text-slate-400">Opcional</span>
                  )}
                </div>
                <input
                  type="text"
                  value={formData.codigo_barras}
                  onChange={(e) => handleBarcodeChange(e.target.value)}
                  placeholder="Ej. 7501234567890 (Escanea o ingresa el código de barras)"
                  className={`w-full px-3.5 py-2.5 bg-white border rounded-xl font-mono text-sm text-slate-900 placeholder-slate-400 focus:outline-none transition shadow-2xs ${
                    barcodeAlert
                      ? 'border-red-500 bg-red-50/50 text-red-900 focus:border-red-500 focus:ring-1 focus:ring-red-500'
                      : 'border-slate-300 focus:border-amber-500'
                  }`}
                />
              </div>

              {/* 9 MAIN FIELDS IN SEPARATE INPUTS */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* 1. ESTILO */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-700">
                      Estilo / Modelo <span className="text-amber-600">*</span>
                    </label>
                    {aiDetectedFields.has('estilo') ? (
                      <span className="text-[10px] text-emerald-700 font-semibold">✓ Detectado</span>
                    ) : extractionResult?.missingFields?.includes('estilo') ? (
                      <span className="text-[10px] text-amber-700 font-semibold">⚠️ Vacío</span>
                    ) : null}
                  </div>
                  <input
                    type="text"
                    required
                    value={formData.estilo}
                    onChange={(e) => handleStyleColorChange('estilo', e.target.value)}
                    placeholder="Ej. OX-892, Mocasín Verona"
                    className={`w-full px-3.5 py-2.5 bg-white border rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-500 transition shadow-2xs ${
                      extractionResult?.missingFields?.includes('estilo') && !formData.estilo
                        ? 'border-amber-400 bg-amber-50/30'
                        : 'border-slate-300'
                    }`}
                  />
                </div>

                {/* 2. COLOR */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-700">Color</label>
                    {aiDetectedFields.has('color') ? (
                      <span className="text-[10px] text-emerald-700 font-semibold">✓ Detectado</span>
                    ) : extractionResult?.missingFields?.includes('color') ? (
                      <span className="text-[10px] text-amber-700 font-semibold">⚠️ Vacío</span>
                    ) : null}
                  </div>
                  <SearchableInput
                    value={formData.color}
                    onChange={(value) => handleStyleColorChange('color', value)}
                    options={searchableOptions.color}
                    placeholder="Ej. Negro, Miel, Café, Vino"
                    className={`w-full px-3.5 py-2.5 bg-white border rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-500 transition shadow-2xs ${
                      extractionResult?.missingFields?.includes('color') && !formData.color
                        ? 'border-amber-400 bg-amber-50/30'
                        : 'border-slate-300'
                    }`}
                  />
                </div>

                {/* 3. CORRIDA */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">
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
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm font-mono text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-500 transition shadow-2xs"
                  />
                </div>
                {stockSizes.length > 0 && (
                  <div className="col-span-full">
                    <SizeQuantityGrid
                      sizes={stockSizes}
                      values={sizeQuantities}
                      operation="set"
                      onChange={(size, quantity) => {
                        if (quantity !== '' && !/^\d+$/.test(quantity)) return;
                        setSizeQuantities(previous => ({ ...previous, [size]: quantity }));
                      }}
                    />
                  </div>
                )}
                {formData.corrida && !stockSizes.length && (
                  <p className="col-span-full rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
                    No se generó la cuadrícula: para existencias por talla usa una corrida con números enteros o medias tallas, por ejemplo 18-21 o 18-21.50.
                  </p>
                )}

                {/* 4. ACABADO */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-700">Acabado / Material</label>
                    {aiDetectedFields.has('acabado') ? (
                      <span className="text-[10px] text-emerald-700 font-semibold">✓ Detectado</span>
                    ) : extractionResult?.missingFields?.includes('acabado') ? (
                      <span className="text-[10px] text-amber-700 font-semibold">⚠️ Vacío</span>
                    ) : null}
                  </div>
                  <SearchableInput
                    value={formData.acabado}
                    onChange={(value) => setFormData(prev => ({ ...prev, acabado: value }))}
                    options={searchableOptions.acabado}
                    placeholder="Ej. Piel Napa, Gamuza, Charol"
                    className={`w-full px-3.5 py-2.5 bg-white border rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-500 transition shadow-2xs ${
                      extractionResult?.missingFields?.includes('acabado') && !formData.acabado
                        ? 'border-amber-400 bg-amber-50/30'
                        : 'border-slate-300'
                    }`}
                  />
                </div>

                {/* 4. MARCA */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-700">Marca</label>
                    {aiDetectedFields.has('marca') ? (
                      <span className="text-[10px] text-emerald-700 font-semibold">✓ Detectado</span>
                    ) : extractionResult?.missingFields?.includes('marca') ? (
                      <span className="text-[10px] text-amber-700 font-semibold">⚠️ Vacío</span>
                    ) : null}
                  </div>
                  <SearchableInput
                    value={formData.marca}
                    onChange={handleMarcaChange}
                    options={searchableOptions.marca}
                    placeholder="Ej. Claremm, Flexi, Quirelli"
                    className={`w-full px-3.5 py-2.5 bg-white border rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-500 transition shadow-2xs ${
                      extractionResult?.missingFields?.includes('marca') && !formData.marca
                        ? 'border-amber-400 bg-amber-50/30'
                        : 'border-slate-300'
                    }`}
                  />
                  <p className="text-[10px] text-slate-400">Proveedor y Sublínea se capturan por separado.</p>
                </div>

                {/* 5. TEMPORADA */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-700">Temporada</label>
                    <span className="text-[9px] bg-amber-50 text-amber-800 px-1.5 py-0.5 rounded font-medium border border-amber-200">
                      Default: CLAREMM 26
                    </span>
                  </div>
                  <SearchableInput
                    value={formData.temporada}
                    onChange={(value) => setFormData(prev => ({ ...prev, temporada: value }))}
                    options={searchableOptions.temporada}
                    placeholder="CLAREMM 26"
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:border-amber-500 transition shadow-2xs"
                  />
                </div>

                {/* 6. PROVEEDOR */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-1">
                      <label className="text-xs font-bold text-slate-700">Proveedor</label>
                    </div>
                    {aiDetectedFields.has('proveedor') ? (
                      <span className="text-[10px] text-emerald-700 font-semibold">✓ Detectado</span>
                    ) : null}
                  </div>
                  <SearchableInput
                    value={formData.proveedor}
                    onChange={(value) => setFormData(prev => ({ ...prev, proveedor: value }))}
                    options={searchableOptions.proveedor}
                    placeholder="Escribe o busca un proveedor"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-amber-500 transition shadow-2xs"
                  />
                </div>

                {/* 7. SUBLINEA */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-1">
                      <label className="text-xs font-bold text-slate-700">Sublínea</label>
                    </div>
                    {aiDetectedFields.has('sublinea') ? (
                      <span className="text-[10px] text-emerald-700 font-semibold">✓ Detectado</span>
                    ) : null}
                  </div>
                  <SearchableInput
                    value={formData.sublinea}
                    onChange={(value) => setFormData(prev => ({ ...prev, sublinea: value }))}
                    options={searchableOptions.sublinea}
                    placeholder="Escribe o busca una sublínea"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-amber-500 transition shadow-2xs"
                  />
                </div>

                {/* 8. DEPARTAMENTO */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Departamento</label>
                  <SearchableInput
                    value={formData.departamento}
                    onChange={(value) => setFormData(prev => ({ ...prev, departamento: value }))}
                    options={searchableOptions.departamento}
                    placeholder="Escribe o busca un departamento"
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:border-amber-500 transition shadow-2xs"
                  />
                </div>

                {/* 9. CLASIFICACION */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Clasificación</label>
                  <SearchableInput
                    value={formData.clasificacion}
                    onChange={(value) => setFormData(prev => ({ ...prev, clasificacion: value }))}
                    options={searchableOptions.clasificacion}
                    placeholder="Escribe o busca una clasificación"
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:border-amber-500 transition shadow-2xs cursor-pointer"
                  />
                </div>

                {/* 10. LINEA (SELECT CON LAS OPCIONES OFICIALES) */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-700">
                      Línea <span className="text-amber-600">*</span>
                    </label>
                    {aiDetectedFields.has('linea') ? (
                      <span className="text-[10px] text-emerald-700 font-semibold">✓ Detectado</span>
                    ) : null}
                  </div>
                  <SearchableInput
                    required
                    value={formData.linea}
                    onChange={(value) => setFormData(prev => ({ ...prev, linea: value }))}
                    options={searchableOptions.linea}
                    placeholder="Escribe o busca una línea"
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:border-amber-500 transition shadow-2xs cursor-pointer"
                  />
                </div>

                {/* 11. SUELA */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Suela</label>
                  <SearchableInput
                    value={formData.suela}
                    onChange={(value) => setFormData(prev => ({ ...prev, suela: value }))}
                    options={searchableOptions.suela}
                    placeholder="Escribe o busca una suela"
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:border-amber-500 transition shadow-2xs"
                  />
                </div>

                {/* 12. PLANTILLA */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Plantilla</label>
                  <SearchableInput
                    value={formData.plantilla}
                    onChange={(value) => setFormData(prev => ({ ...prev, plantilla: value }))}
                    options={searchableOptions.plantilla}
                    placeholder="Escribe o busca una plantilla"
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:border-amber-500 transition shadow-2xs"
                  />
                </div>

                {/* 13. TACON */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Tacón</label>
                  <SearchableInput
                    value={formData.tacon}
                    onChange={(value) => setFormData(prev => ({ ...prev, tacon: value }))}
                    options={searchableOptions.tacon}
                    placeholder="Escribe o busca un tacón"
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:border-amber-500 transition shadow-2xs"
                  />
                </div>

                {/* 14. FORRO */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Forro</label>
                  <SearchableInput
                    value={formData.forro}
                    onChange={(value) => setFormData(prev => ({ ...prev, forro: value }))}
                    options={searchableOptions.forro}
                    placeholder="Escribe o busca un forro"
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:border-amber-500 transition shadow-2xs"
                  />
                </div>

                {/* 15. CATALOGO */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-700">
                      Catálogo <span className="text-amber-600">*</span>
                    </label>
                  </div>
                  <SearchableInput
                    required
                    value={formData.catalogo}
                    onChange={(value) => setFormData(prev => ({ ...prev, catalogo: value }))}
                    options={searchableOptions.catalogo}
                    placeholder="Ej. Catálogo 2026"
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm text-slate-900 focus:outline-none focus:border-amber-500 transition shadow-2xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Status</label>
                  <SearchableInput
                    type="number"
                    step="1"
                    value={formData.status}
                    onChange={(value) => setFormData(prev => ({ ...prev, status: value }))}
                    options={searchableOptions.status}
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm text-slate-900 focus:outline-none focus:border-amber-500 transition shadow-2xs"
                  />
                </div>

                {/* 16. OBSERVACIONES (FORMATO DD/MM/YY) */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-700">Observaciones</label>
                    <span className="text-[9px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono font-medium border border-slate-200">
                      dd/mm/yy
                    </span>
                  </div>
                  <input
                    type="text"
                    value={formData.observaciones}
                    onChange={(e) => setFormData({ ...formData, observaciones: e.target.value })}
                    placeholder="dd/mm/yy"
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm font-mono font-semibold text-slate-900 focus:outline-none focus:border-amber-500 transition shadow-2xs"
                  />
                </div>

                {/* 10. PRECIO DE VENTA (OBTENIDO DE LA FICHA) */}
                <div className="space-y-1 bg-amber-50/40 p-3 rounded-xl border border-amber-200/80">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-800 flex items-center space-x-1">
                      <span>Precio de Venta ($)</span>
                    </label>
                    {aiDetectedFields.has('precio') ? (
                      <span className="text-[10px] text-emerald-700 font-semibold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                        ✓ Ficha IA
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400">Opcional</span>
                    )}
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-sm font-bold text-slate-500">$</span>
                    <input
                      type="text"
                      value={formData.precio}
                      onChange={(e) => handlePrecioChange(e.target.value)}
                      placeholder="0.00"
                      className="w-full pl-7 pr-3 py-2 bg-white border border-slate-300 rounded-xl text-sm font-bold text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-500 transition shadow-2xs"
                    />
                  </div>
                  <p className="text-[10px] text-slate-500">Obtenido de la ficha técnica al capturar la fotografía</p>
                </div>

                {/* 11. COSTO (DERIVADO: PRECIO - 30%) */}
                <div className="space-y-1 bg-amber-50/40 p-3 rounded-xl border border-amber-200/80">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-amber-900 flex items-center space-x-1">
                      <span>Costo (-30%) ($)</span>
                    </label>
                    <span className="text-[9px] bg-amber-100 text-amber-900 font-bold px-1.5 py-0.5 rounded border border-amber-300">
                      -30% Precio
                    </span>
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-sm font-bold text-amber-700">$</span>
                    <input
                      type="text"
                      value={formData.costo}
                      onChange={(e) => handleCostoChange(e.target.value)}
                      placeholder="0.00"
                      className="w-full pl-7 pr-3 py-2 bg-white border border-amber-300 rounded-xl text-sm font-bold text-amber-900 placeholder-amber-400 focus:outline-none focus:border-amber-500 transition shadow-2xs"
                    />
                  </div>
                  <p className="text-[10px] text-amber-800 font-medium">Derivado restando 30% al precio final (precio × 0.70)</p>
                </div>
              </div>

              {saveError && (
                <div className="p-3 bg-red-50 border border-red-300 text-red-800 text-xs rounded-xl flex items-center space-x-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
                  <span>{saveError}</span>
                </div>
              )}
              {saveSuccess && (
                <div className="p-3 bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs rounded-xl flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                  <span>{saveSuccess}</span>
                </div>
              )}
            </form>
          </div>

          {/* Footer with Guardar Button */}
          <div className="px-3 py-3 sm:px-6 sm:py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2 shrink-0">
            <button
              type="button"
              onClick={handleClose}
              className="px-3 sm:px-5 py-2.5 rounded-xl border border-slate-300 text-slate-600 hover:text-slate-900 text-xs sm:text-sm font-semibold hover:bg-slate-100 transition"
            >
              Cancelar
            </button>

            <button
              type="submit"
              form="capture-product-form"
              disabled={isSaving}
              className="gold-gradient-btn flex items-center justify-center space-x-2 px-4 sm:px-8 py-2.5 rounded-xl text-xs sm:text-sm font-bold shadow-md disabled:opacity-50"
            >
              <Save className="w-4 h-4 text-slate-950" />
              <span>{isSaving ? 'Guardando en Base de Datos...' : 'Guardar Producto'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* WEBCAM VIEWFINDER MODAL */}
      {activeCameraTarget && (
        <WebcamViewfinder
          title={activeCameraTarget === 'product' ? 'Tomar Foto del Calzado' : 'Tomar Foto de la Ficha Técnica'}
          onCapture={handleWebcamCapture}
          onClose={() => setActiveCameraTarget(null)}
        />
      )}
    </>
  );
}
