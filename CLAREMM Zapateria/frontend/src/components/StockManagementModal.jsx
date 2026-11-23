import React, { useEffect, useState } from 'react';
import { Camera, Download, Search, X } from 'lucide-react';
import { safeFetchJson } from '../utils/api';
import { getSizesForCorrida } from '../utils/inventory';
import SizeQuantityGrid from './SizeQuantityGrid';
import WebcamViewfinder from './WebcamViewfinder';

const normalize = (value) => String(value || '').trim().toLocaleLowerCase();
const normalizeScannedSize = (value) => {
  const rawSize = String(value ?? '').trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(rawSize)) return '';
  const numericSize = Number(rawSize);
  return Number.isFinite(numericSize) ? String(numericSize) : '';
};

export default function StockManagementModal({ isOpen, onClose, onSaved }) {
  const [style, setStyle] = useState('');
  const [products, setProducts] = useState([]);
  const [product, setProduct] = useState(null);
  const [sizes, setSizes] = useState([]);
  const [currentQuantities, setCurrentQuantities] = useState({});
  const [quantities, setQuantities] = useState({});
  const [operation, setOperation] = useState('add');
  const [loading, setLoading] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [scanMode, setScanMode] = useState(false);
  const [pendingScan, setPendingScan] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    setStyle('');
    setProducts([]);
    setProduct(null);
    setSizes([]);
    setCurrentQuantities({});
    setQuantities({});
    setOperation('add');
    setError('');
    setMessage('');
    setScanMode(false);
    setPendingScan(null);
  }, [isOpen]);

  if (!isOpen) return null;

  const findProducts = async (value, color = '') => {
    const trimmedStyle = String(value || '').trim();
    if (!trimmedStyle) {
      setError('Escribe el estilo del producto.');
      return;
    }

    setLoading(true);
    setError('');
    setMessage('');
    setProduct(null);
    setSizes([]);
    setQuantities({});
    try {
      const params = new URLSearchParams({ estilo: trimmedStyle });
      const result = await safeFetchJson(`/api/products/lookup?${params}`);
      if (!result.success) throw new Error(result.message || 'No se pudo buscar el producto.');
      const matches = result.products || [];
      setProducts(matches);
      setStyle(trimmedStyle);
      if (!matches.length) {
        setError(`No encontré el estilo ${trimmedStyle}. Verifica el dato o captura primero el producto.`);
      } else {
        const colorMatch = color
          ? matches.find(item => normalize(item.color) === normalize(color))
          : null;
        if (colorMatch) {
          await selectProduct(colorMatch);
        } else if (matches.length === 1) {
          await selectProduct(matches[0]);
        } else {
          setMessage('Hay varios productos con este estilo. Elige el color y acabado correctos.');
        }
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  const selectProduct = async (candidate) => {
    setLoading(true);
    setError('');
    try {
      const result = await safeFetchJson(`/api/products/${candidate.id}/inventory`);
      if (!result.success) throw new Error(result.message || 'No se pudo cargar la corrida.');
      const availableSizes = result.sizes || [];
      setProduct(result.product);
      setSizes(availableSizes.map(item => item.size));
      setCurrentQuantities(Object.fromEntries(availableSizes.map(item => [item.size, item.quantity])));
      setQuantities({});
      setMessage('');
      setError('');
    } catch (requestError) {
      setError(requestError.message);
      setProduct(null);
    } finally {
      setLoading(false);
    }
  };

  const handleCameraCapture = async (photo) => {
    setCameraOpen(false);
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const result = await safeFetchJson('/api/ai/extract-ficha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fichaBase64: photo })
      });
      if (!result.success) throw new Error(result.message || 'No se pudo leer el estilo en la foto.');
      const extractedStyle = String(result.extractedData?.estilo || '').trim();
      const extractedColor = String(result.extractedData?.color || '').trim();
      if (!extractedStyle) throw new Error('La foto no permitió identificar el estilo. Busca el producto por estilo.');
      await findProducts(extractedStyle, extractedColor);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  const addScannedUnit = async (candidate, scannedSize) => {
    const availableSizes = getSizesForCorrida(candidate.corrida);
    if (!availableSizes.includes(scannedSize)) {
      throw new Error(`La talla ${scannedSize} no pertenece a la corrida ${candidate.corrida || 'del producto'}. No se modificó la existencia.`);
    }

    const result = await safeFetchJson(`/api/products/${candidate.id}/inventory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'add',
        items: [{ size: scannedSize, quantity: 1 }]
      })
    });
    if (!result.success) throw new Error(result.message || 'No se pudo sumar la existencia.');

    const updatedSizes = result.sizes || [];
    setProduct(result.product);
    setSizes(updatedSizes.map(item => item.size));
    setCurrentQuantities(Object.fromEntries(updatedSizes.map(item => [item.size, item.quantity])));
    setQuantities({});
    setProducts([]);
    setPendingScan(null);
    setMessage(`+1 par: ${result.product.estilo} · ${result.product.color || 'Sin color'} · talla ${scannedSize}. Total actual: ${updatedSizes.find(item => item.size === scannedSize)?.quantity ?? 1}.`);
    onSaved?.();
  };

  const handleQuickScanCapture = async (photo) => {
    setCameraOpen(false);
    setLoading(true);
    setError('');
    setMessage('');
    setProduct(null);
    setPendingScan(null);
    setProducts([]);
    try {
      const result = await safeFetchJson('/api/ai/extract-ficha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fichaBase64: photo })
      });
      if (!result.success) throw new Error(result.message || 'No se pudo leer la etiqueta.');

      const extractedStyle = String(result.extractedData?.estilo || '').trim();
      const extractedColor = String(result.extractedData?.color || '').trim();
      const scannedSize = normalizeScannedSize(result.extractedData?.talla);
      if (!extractedStyle) throw new Error('No pude identificar el estilo. No se modificó la existencia.');
      if (!scannedSize) throw new Error('No pude identificar una talla individual en la etiqueta. No se modificó la existencia.');

      const params = new URLSearchParams({ estilo: extractedStyle });
      const lookup = await safeFetchJson(`/api/products/lookup?${params}`);
      if (!lookup.success) throw new Error(lookup.message || 'No se pudo buscar el producto.');
      const matches = lookup.products || [];
      setStyle(extractedStyle);
      setProducts(matches);
      if (!matches.length) {
        throw new Error(`No encontré el estilo ${extractedStyle}. No se modificó la existencia.`);
      }

      const colorMatches = extractedColor
        ? matches.filter(item => normalize(item.color) === normalize(extractedColor))
        : [];
      const scan = { estilo: extractedStyle, color: extractedColor, talla: scannedSize };
      if (matches.length === 1 && (!extractedColor || colorMatches.length === 1)) {
        await addScannedUnit(matches[0], scannedSize);
      } else {
        setPendingScan(scan);
        const colorDescription = extractedColor ? `, color ${extractedColor}` : '';
        setMessage(`Leí estilo ${extractedStyle}${colorDescription}, talla ${scannedSize}. Hay más de un producto posible o el color requiere confirmación; elige el producto correcto. Aún no se modificó la existencia.`);
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  const handleScanCandidate = async (candidate) => {
    if (!pendingScan) {
      await selectProduct(candidate);
      return;
    }

    setLoading(true);
    setError('');
    setMessage('');
    try {
      await addScannedUnit(candidate, pendingScan.talla);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  const handleModeChange = (nextScanMode) => {
    setScanMode(nextScanMode);
    setProducts([]);
    setProduct(null);
    setSizes([]);
    setCurrentQuantities({});
    setQuantities({});
    setPendingScan(null);
    setError('');
    setMessage('');
  };

  const handleSave = async () => {
    if (!product) return;
    const items = Object.entries(quantities)
      .filter(([, quantity]) => quantity !== '')
      .map(([size, quantity]) => ({ size, quantity: Number(quantity) }));
    if (!items.length) {
      setError('Captura al menos una cantidad. Deja vacías las tallas que no quieras modificar.');
      return;
    }
    if (items.some(item => !Number.isSafeInteger(item.quantity) || item.quantity < 0)) {
      setError('Las cantidades deben ser números enteros no negativos.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const result = await safeFetchJson(`/api/products/${product.id}/inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation, items })
      });
      if (!result.success) throw new Error(result.message || 'No se pudo guardar la existencia.');
      const changedUnits = items.reduce((total, item) => total + item.quantity, 0);
      setCurrentQuantities(Object.fromEntries(
        (result.sizes || []).map(item => [item.size, item.quantity])
      ));
      setQuantities({});
      setMessage(`Existencia guardada para ${items.length} talla(s). ${operation === 'add' ? `${changedUnits} pares agregados.` : 'Cantidades reemplazadas.'}`);
      onSaved?.();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-slate-900/50 p-2 backdrop-blur-sm sm:p-5">
        <div className="my-auto flex max-h-[96vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-800 shadow-2xl">
          <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-4 sm:px-6">
            <div>
              <h2 className="text-lg font-bold text-slate-900">{scanMode ? 'Escaneo rápido de existencias' : 'Existencias por talla'}</h2>
              <p className="mt-1 text-xs text-slate-500">Elige cómo registrar las existencias del producto.</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-lg p-2 text-slate-500 hover:bg-slate-200">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-4 overflow-y-auto p-4 sm:p-6">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-label="Modo de captura de existencia">
              <button
                type="button"
                onClick={() => handleModeChange(false)}
                aria-pressed={!scanMode}
                className={`min-h-11 rounded-xl border px-4 text-sm font-bold ${!scanMode ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-700'}`}
              >
                Captura por talla
              </button>
              <button
                type="button"
                onClick={() => handleModeChange(true)}
                aria-pressed={scanMode}
                className={`min-h-11 rounded-xl border px-4 text-sm font-bold ${scanMode ? 'border-amber-700 bg-amber-700 text-white' : 'border-slate-300 bg-white text-slate-700'}`}
              >
                Escaneo rápido +1
              </button>
            </div>

            {scanMode ? (
              <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm text-amber-950">
                  Fotografía la etiqueta del par. Si se identifica un producto único y una talla individual válida, se suma un par a esa talla. Si el estilo tiene varios productos o el color requiere confirmación, elige el producto antes de modificar la existencia.
                </p>
                <button
                  type="button"
                  onClick={() => setCameraOpen(true)}
                  disabled={loading}
                  className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-amber-700 px-4 text-sm font-bold text-white disabled:opacity-50"
                >
                  <Camera className="h-4 w-4" /> Escanear etiqueta (+1)
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto]">
                <input
                  value={style}
                  onChange={event => setStyle(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      findProducts(style);
                    }
                  }}
                  placeholder="Escribe el estilo, por ejemplo PI3059"
                  aria-label="Buscar estilo"
                  className="min-h-12 w-full rounded-xl border border-slate-300 px-4 text-base text-slate-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200"
                />
                <button
                  type="button"
                  onClick={() => findProducts(style)}
                  disabled={loading}
                  className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-slate-800 px-4 text-sm font-bold text-white disabled:opacity-50"
                >
                  <Search className="h-4 w-4" /> Buscar estilo
                </button>
                <button
                  type="button"
                  onClick={() => setCameraOpen(true)}
                  disabled={loading}
                  className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 text-sm font-bold text-amber-900 disabled:opacity-50"
                >
                  <Camera className="h-4 w-4" /> Leer ficha
                </button>
              </div>
            )}

            {((!scanMode && products.length > 1 && !product) || (scanMode && pendingScan && !product)) && (
              <div className="space-y-2" aria-label="Productos encontrados">
                {pendingScan && <p className="text-sm font-semibold text-slate-700">Elige el producto para agregar talla {pendingScan.talla}. No se sumará hasta que lo confirmes.</p>}
                {products.map(candidate => (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => handleScanCandidate(candidate)}
                    disabled={loading}
                    className="flex min-h-14 w-full flex-col items-start justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-left hover:border-amber-400 hover:bg-amber-50 disabled:opacity-50 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span className="font-bold text-slate-800">{candidate.estilo} · {candidate.color || 'Sin color'}</span>
                    <span className="text-xs text-slate-500">{candidate.acabado || 'Sin acabado'} · {candidate.marca || 'Sin marca'} · {candidate.corrida}</span>
                  </button>
                ))}
              </div>
            )}

            {product && scanMode && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <p className="font-bold text-emerald-900">{product.estilo} · {product.color || 'Sin color'}</p>
                <p className="mt-1 text-xs text-emerald-800">{product.acabado || 'Sin acabado'} · {product.marca || 'Sin marca'} · Corrida {product.corrida}</p>
                <p className="mt-2 text-sm text-emerald-900">
                  {sizes.map(size => `${size}: ${currentQuantities[size] || 0}`).join(' · ')}
                </p>
              </div>
            )}

            {product && !scanMode && (
              <>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                  <p className="font-bold text-emerald-900">{product.estilo} · {product.color || 'Sin color'}</p>
                  <p className="mt-1 text-xs text-emerald-800">{product.acabado || 'Sin acabado'} · {product.marca || 'Sin marca'} · Corrida {product.corrida}</p>
                </div>
                <fieldset className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <legend className="mb-2 text-xs font-bold text-slate-700">Acción sobre la existencia actual</legend>
                  <label className={`flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm font-semibold ${operation === 'add' ? 'border-amber-400 bg-amber-50 text-amber-950' : 'border-slate-200'}`}>
                    <input type="radio" name="inventory-operation" value="add" checked={operation === 'add'} onChange={() => setOperation('add')} />
                    Sumar entrada a lo que ya hay
                  </label>
                  <label className={`flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm font-semibold ${operation === 'set' ? 'border-amber-400 bg-amber-50 text-amber-950' : 'border-slate-200'}`}>
                    <input type="radio" name="inventory-operation" value="set" checked={operation === 'set'} onChange={() => setOperation('set')} />
                    Reemplazar por el total contado
                  </label>
                </fieldset>
                <SizeQuantityGrid
                  sizes={sizes}
                  values={quantities}
                  currentQuantities={currentQuantities}
                  operation={operation}
                  label="Captura rápida de pares por talla"
                  onChange={(size, quantity) => {
                    if (quantity !== '' && !/^\d+$/.test(quantity)) return;
                    setQuantities(previous => ({ ...previous, [size]: quantity }));
                  }}
                />
              </>
            )}

            {loading && <p className="text-center text-sm font-semibold text-slate-500">Procesando...</p>}
            {message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{message}</p>}
            {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <a
              href="/api/inventory/export"
              className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              <Download className="h-4 w-4" /> Excel por talla
            </a>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-600">Cerrar</button>
              {product && !scanMode && (
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={loading}
                  className="min-h-11 rounded-xl bg-amber-700 px-5 text-sm font-bold text-white disabled:opacity-50"
                >
                  {loading ? 'Guardando...' : 'Guardar existencia'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      {cameraOpen && (
        <WebcamViewfinder
          title={scanMode ? 'Escanear etiqueta del producto' : 'Escanear ficha del producto'}
          onCapture={scanMode ? handleQuickScanCapture : handleCameraCapture}
          onClose={() => setCameraOpen(false)}
        />
      )}
    </>
  );
}
