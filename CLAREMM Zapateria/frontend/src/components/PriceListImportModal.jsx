import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, CheckCircle, FileSpreadsheet, Search, Upload, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import { safeFetchJson } from '../utils/api';

const normalizeHeader = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '');

const normalizeMatch = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLocaleLowerCase();

const EXCEL_COLUMNS = [
  { key: 'estilo', label: 'Estilo', aliases: ['estilo', 'modelo', 'estilomodelo', 'codigoestilo'] },
  { key: 'color', label: 'Color', aliases: ['color'] },
  { key: 'precio', label: 'Precio', aliases: ['precio', 'precioventa', 'preciodeventa', 'precio1', 'preciounitario'] },
  { key: 'acabado', label: 'Acabado', aliases: ['acabado', 'acabadomaterial'] },
  { key: 'descripcion', label: 'Descripción', aliases: ['descripcion', 'desc'] },
  { key: 'corrida', label: 'Corrida', aliases: ['corrida', 'corridadetallas'] },
  { key: 'estado', label: 'Estado', aliases: ['estado'] },
  { key: 'fecha_alta', label: 'Fecha alta', aliases: ['fechaalta'] },
  { key: 'marca', label: 'Marca', aliases: ['marca'] },
  { key: 'temporada', label: 'Temporada', aliases: ['temporada'] },
  { key: 'proveedor', label: 'Proveedor', aliases: ['proveedor'] },
  { key: 'sublinea', label: 'Sublínea', aliases: ['sublinea'] },
  { key: 'clasificacion', label: 'Clasificación', aliases: ['clasificacion'] },
  { key: 'linea', label: 'Línea', aliases: ['linea', 'lineadeproducto'] },
  { key: 'departamento', label: 'Departamento', aliases: ['departamento'] },
  { key: 'observaciones', label: 'Observaciones', aliases: ['observaciones', 'observacion'] },
  { key: 'suela', label: 'Suela', aliases: ['suela'] },
  { key: 'plantilla', label: 'Plantilla', aliases: ['plantilla'] },
  { key: 'tacon', label: 'Tacón', aliases: ['tacon'] },
  { key: 'forro', label: 'Forro', aliases: ['forro'] },
  { key: 'catalogo', label: 'Catálogo', aliases: ['catalogo'] },
  { key: 'comprador', label: 'Comprador', aliases: ['comprador'] },
  { key: 'pagina', label: 'Página', aliases: ['pagina'] },
  { key: 'status', label: 'Status', aliases: ['status', 'estatus'] }
];
const REQUIRED_COLUMNS = ['estilo', 'color', 'precio'];
const INHERITABLE_FIELDS = EXCEL_COLUMNS.filter(({ key }) => !REQUIRED_COLUMNS.includes(key));

const parsePrice = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  let text = String(value || '').trim().replace(/[^\d,.-]/g, '');
  if (!text) return NaN;
  const commaIndex = text.lastIndexOf(',');
  const periodIndex = text.lastIndexOf('.');
  if (commaIndex !== -1 && periodIndex !== -1) {
    text = commaIndex > periodIndex
      ? text.replace(/\./g, '').replace(',', '.')
      : text.replace(/,/g, '');
  } else if (commaIndex !== -1) {
    text = /,\d{1,2}$/.test(text) ? text.replace(',', '.') : text.replace(/,/g, '');
  }
  const price = Number(text);
  return Number.isFinite(price) ? price : NaN;
};

const readPriceList = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error('No se pudo leer el archivo seleccionado.'));
  reader.onload = (event) => {
    try {
      const workbook = XLSX.read(new Uint8Array(event.target.result), { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const sourceRows = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: false });
      if (!sourceRows.length) throw new Error('El archivo no contiene filas de datos.');

      const headers = Object.keys(sourceRows[0]);
      const headerByField = new Map();
      for (const header of headers) {
        const definition = EXCEL_COLUMNS.find(column => column.aliases.includes(normalizeHeader(header)));
        if (!definition) continue;
        if (headerByField.has(definition.key)) {
          throw new Error(`El Excel tiene más de una columna para ${definition.label}.`);
        }
        headerByField.set(definition.key, header);
      }
      if (REQUIRED_COLUMNS.some(field => !headerByField.has(field))) {
        throw new Error('Se requieren encabezados Estilo, Color y Precio (o Precio de Venta).');
      }

      const errors = [];
      const seen = new Set();
      const rows = [];
      sourceRows.forEach((source, index) => {
        if (!Object.values(source).some(value => String(value).trim())) return;
        const estilo = String(source[headerByField.get('estilo')] || '').trim();
        const color = String(source[headerByField.get('color')] || '').trim();
        const precio = parsePrice(source[headerByField.get('precio')]);
        const rowNumber = index + 2;
        if (!estilo || !color || !Number.isFinite(precio) || precio < 0) {
          errors.push(`Fila ${rowNumber}: verifica Estilo, Color y Precio no negativo.`);
          return;
        }
        const key = `${normalizeMatch(estilo)}\u0000${normalizeMatch(color)}`;
        if (seen.has(key)) {
          errors.push(`Fila ${rowNumber}: la combinación ${estilo} · ${color} se repite en el archivo.`);
          return;
        }
        seen.add(key);
        const row = { estilo, color, precio };
        for (const field of INHERITABLE_FIELDS) {
          const header = headerByField.get(field.key);
          if (!header || String(source[header] ?? '').trim() === '') continue;
          if (field.key === 'pagina' || field.key === 'status') {
            const value = Number(source[header]);
            if (!Number.isSafeInteger(value)) {
              errors.push(`Fila ${rowNumber}: ${field.label} debe ser un número entero.`);
              return;
            }
            row[field.key] = value;
          } else {
            row[field.key] = String(source[header]).trim();
          }
        }
        rows.push(row);
      });

      if (!rows.length && !errors.length) throw new Error('El archivo no contiene filas válidas.');
      resolve({
        rows,
        errors,
        columns: EXCEL_COLUMNS.filter(({ key }) => headerByField.has(key))
      });
    } catch (error) {
      reject(error);
    }
  };
  reader.readAsArrayBuffer(file);
});

export default function PriceListImportModal({ isOpen, onClose, onImportSuccess }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [rows, setRows] = useState([]);
  const [detectedColumns, setDetectedColumns] = useState([]);
  const [validationErrors, setValidationErrors] = useState([]);
  const [templateStyle, setTemplateStyle] = useState('');
  const [templateMatches, setTemplateMatches] = useState([]);
  const [template, setTemplate] = useState(null);
  const [fieldsToInherit, setFieldsToInherit] = useState(INHERITABLE_FIELDS.map(({ key }) => key));
  const [error, setError] = useState('');
  const [isReading, setIsReading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (isOpen) return;
    setSelectedFile(null);
    setRows([]);
    setDetectedColumns([]);
    setValidationErrors([]);
    setTemplateStyle('');
    setTemplateMatches([]);
    setTemplate(null);
    setFieldsToInherit(INHERITABLE_FIELDS.map(({ key }) => key));
    setError('');
    setIsReading(false);
    setIsSearching(false);
    setIsProcessing(false);
    setResult(null);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleFile = async (file) => {
    if (!file) return;
    setSelectedFile(file);
    setRows([]);
    setDetectedColumns([]);
    setValidationErrors([]);
    setResult(null);
    setError('');
    setIsReading(true);
    try {
      const parsed = await readPriceList(file);
      setRows(parsed.rows);
      setDetectedColumns(parsed.columns);
      setValidationErrors(parsed.errors);
    } catch (parseError) {
      setError(parseError.message);
    } finally {
      setIsReading(false);
    }
  };

  const searchTemplate = async () => {
    const style = templateStyle.trim();
    if (!style) {
      setError('Escribe el estilo de un producto con los datos que compartirán las filas nuevas.');
      return;
    }
    setIsSearching(true);
    setError('');
    setTemplate(null);
    try {
      const params = new URLSearchParams({ estilo: style });
      const response = await safeFetchJson(`/api/products/lookup?${params}`);
      if (!response.success) throw new Error(response.message || 'No se pudo buscar el producto base.');
      setTemplateMatches(response.products || []);
      if (!response.products?.length) setError(`No encontré un producto base con estilo ${style}.`);
    } catch (searchError) {
      setError(searchError.message);
    } finally {
      setIsSearching(false);
    }
  };

  const confirmImport = async () => {
    if (!selectedFile || !rows.length || validationErrors.length || !template) return;
    setIsProcessing(true);
    setError('');
    try {
      const response = await safeFetchJson('/api/products/import-style-color-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateProductId: template.id,
          fieldsToInherit,
          items: rows
        })
      });
      if (!response.success) throw new Error(response.message || 'No se pudo importar la lista.');
      setResult(response);
      onImportSuccess?.(response.count);
    } catch (importError) {
      setError(importError.message);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-slate-900/50 p-2 backdrop-blur-sm sm:p-5">
      <div className="my-auto flex max-h-[96dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-800 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="hidden shrink-0 rounded-xl border border-emerald-300 bg-emerald-50 p-2.5 text-emerald-700 sm:block">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-900 sm:text-lg">Importar lista desde Excel</h2>
              <p className="mt-1 text-xs text-slate-500">Elige qué datos tomar del producto base y cuáles agregar desde el Excel.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-lg p-2 text-slate-500 hover:bg-slate-200">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 space-y-4 overflow-y-auto p-4 sm:p-6">
          <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
            <div>
              <h3 className="text-sm font-bold text-amber-950">1. Elige un producto base</h3>
              <p className="mt-1 text-xs text-amber-900">
                Selecciona qué datos generales se repiten y quieres heredar. En productos nuevos, los valores del Excel tienen prioridad.
                Código de barras, fotos y existencias nunca se copian; el Costo se calcula al 70% del Precio.
                Si el producto ya existe, solo se actualizan Estilo, Color, Precio y Costo.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={templateStyle}
                onChange={(event) => {
                  setTemplateStyle(event.target.value);
                  setTemplate(null);
                  setTemplateMatches([]);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    searchTemplate();
                  }
                }}
                placeholder="Estilo del producto base"
                aria-label="Estilo del producto base"
                className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900"
              />
              <button
                type="button"
                onClick={searchTemplate}
                disabled={isSearching || isProcessing}
                className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-800 px-4 text-sm font-bold text-white disabled:opacity-50"
              >
                <Search className="h-4 w-4" /> Buscar base
              </button>
            </div>
            {templateMatches.length > 0 && !template && (
              <div className="space-y-2">
                {templateMatches.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => setTemplate(candidate)}
                    className="flex w-full flex-col items-start rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs hover:border-amber-400 sm:flex-row sm:justify-between"
                  >
                    <span className="font-bold">{candidate.estilo} · {candidate.color || 'Sin color'}</span>
                    <span className="text-slate-500">{candidate.marca} · {candidate.linea} · {candidate.corrida}</span>
                  </button>
                ))}
              </div>
            )}
            {template && (
              <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <div className="flex items-start gap-2 text-xs text-emerald-900">
                  <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Base seleccionada: <strong>{template.estilo} · {template.color}</strong> — {template.marca}, {template.linea}, corrida {template.corrida}.
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-bold text-slate-800">Campos que se copiarán del producto base</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setFieldsToInherit(INHERITABLE_FIELDS.map(({ key }) => key))}
                      className="text-[11px] font-semibold text-emerald-800 underline"
                    >
                      Seleccionar todos
                    </button>
                    <button
                      type="button"
                      onClick={() => setFieldsToInherit([])}
                      className="text-[11px] font-semibold text-slate-600 underline"
                    >
                      Ninguno
                    </button>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {INHERITABLE_FIELDS.map(({ key, label }) => {
                    const value = template[key];
                    return (
                      <label key={key} className="flex min-w-0 items-start gap-2 rounded-lg border border-white bg-white/80 p-2 text-xs">
                        <input
                          type="checkbox"
                          checked={fieldsToInherit.includes(key)}
                          onChange={(event) => {
                            setFieldsToInherit(current => event.target.checked
                              ? [...current, key]
                              : current.filter(field => field !== key))}
                          }
                          className="mt-0.5 accent-emerald-700"
                        />
                        <span className="min-w-0">
                          <span className="block font-semibold text-slate-800">{label}</span>
                          <span className="block truncate text-slate-500" title={value === null || value === undefined || value === '' ? 'Vacío' : String(value)}>
                            {value === null || value === undefined || value === '' ? 'Vacío' : String(value)}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          <section className="space-y-3 rounded-xl border border-slate-200 p-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">2. Sube el Excel de la lista</h3>
              <p className="mt-1 text-xs text-slate-500">
                La primera hoja debe incluir Estilo, Color y Precio. También puedes agregar columnas para los demás campos.
              </p>
            </div>
            <label className="flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-3 text-center text-xs font-semibold text-slate-700 hover:border-amber-400">
              <Upload className="h-4 w-4 text-amber-700" />
              <span className="break-all">{selectedFile?.name || 'Seleccionar archivo .xlsx o .xls'}</span>
              <input
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(event) => handleFile(event.target.files?.[0])}
              />
            </label>
            {isReading && <p className="text-xs text-slate-500">Leyendo Excel...</p>}
            {rows.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-bold text-slate-700">
                  {rows.length} fila(s) válidas · Campos leídos: {detectedColumns.map(({ label }) => label).join(', ')}
                </p>
                <div className="max-h-48 overflow-auto rounded-lg border border-slate-200">
                  <table className="min-w-full text-left text-xs">
                    <thead className="sticky top-0 bg-slate-50 text-slate-500">
                      <tr>
                        {detectedColumns.map(({ key, label }) => (
                          <th key={key} className={`whitespace-nowrap p-2 ${key === 'precio' ? 'text-right' : ''}`}>{label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rows.slice(0, 10).map((row, index) => (
                        <tr key={`${row.estilo}-${row.color}-${index}`}>
                          {detectedColumns.map(({ key }) => (
                            <td key={key} className={`max-w-56 whitespace-nowrap p-2 ${key === 'precio' ? 'text-right' : ''}`}>
                              {key === 'precio'
                                ? `$${row.precio.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`
                                : (row[key] ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {rows.length > 10 && <p className="text-right text-[11px] text-slate-500">+ {rows.length - 10} fila(s) más</p>}
              </div>
            )}
            {validationErrors.length > 0 && (
              <div className="space-y-1 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                <p className="font-bold">Corrige el archivo antes de importar:</p>
                {validationErrors.slice(0, 8).map((item) => <p key={item}>{item}</p>)}
                {validationErrors.length > 8 && <p>Y {validationErrors.length - 8} error(es) más.</p>}
              </div>
            )}
          </section>

          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
            </div>
          )}

          {result && (
            <div role="status" className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
              <p className="font-bold">{result.message}</p>
              {result.skipped?.map((item, index) => (
                <p key={`${item.estilo}-${item.color}-${index}`}>
                  Sin cambios: {item.estilo} · {item.color}. {item.reason}
                </p>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:px-6">
          <button type="button" onClick={onClose} className="min-h-10 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-600 hover:bg-slate-100">
            {result ? 'Cerrar' : 'Cancelar'}
          </button>
          {!result && (
            <button
              type="button"
              onClick={confirmImport}
              disabled={!template || !rows.length || validationErrors.length > 0 || isProcessing || isReading}
              className="gold-gradient-btn flex min-h-10 items-center gap-2 rounded-xl px-4 text-xs font-bold shadow-sm disabled:opacity-50 sm:px-6 sm:text-sm"
            >
              <span>{isProcessing ? 'Importando...' : `Importar lista (${rows.length})`}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
