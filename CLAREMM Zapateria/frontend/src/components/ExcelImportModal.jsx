import React, { useState } from 'react';
import { FileSpreadsheet, Upload, Download, CheckCircle, AlertCircle, X, ArrowRight } from 'lucide-react';
import * as XLSX from 'xlsx';
import confetti from 'canvas-confetti';
import { safeFetchJson } from '../utils/api';

const PREVIEW_PAGE_SIZE = 25;

export default function ExcelImportModal({ isOpen, onClose, onImportSuccess, onOpenPriceListImport }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [parsedRows, setParsedRows] = useState([]);
  const [previewPage, setPreviewPage] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [barcodeWarnings, setBarcodeWarnings] = useState(null);
  const [importWarnings, setImportWarnings] = useState(null);
  const [importNotice, setImportNotice] = useState('');

  if (!isOpen) return null;

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processExcelFile(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    processExcelFile(file);
  };

  const processExcelFile = (file) => {
    setErrorMsg(null);
    setImportWarnings(null);
    setImportNotice('');
    setSelectedFile(file);
    setParsedRows([]);
    setPreviewPage(0);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.SheetNames[0];
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], { defval: '', raw: false });

        if (rows.length === 0) {
          setErrorMsg('El archivo seleccionado no tiene filas de datos.');
          setParsedRows([]);
          return;
        }

        setParsedRows(rows);
      } catch (err) {
        setErrorMsg('Error al leer el archivo Excel: ' + err.message);
        setParsedRows([]);
      }
    };
    reader.onerror = () => {
      setErrorMsg('No se pudo leer el archivo seleccionado.');
      setParsedRows([]);
    };
    reader.readAsArrayBuffer(file);
  };

  const handleConfirmImport = async () => {
    if (!selectedFile) return;
    setIsProcessing(true);
    setErrorMsg(null);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const data = await safeFetchJson('/api/products/import', {
        method: 'POST',
        body: formData
      });
      if (Array.isArray(data?.invalidRows) && data.invalidRows.length) {
        setImportWarnings(data.invalidRows);
      }

      if (data && data.success) {
        setImportNotice(data.message || '');
        try {
          confetti({
            particleCount: 60,
            spread: 60,
            origin: { y: 0.7 },
            colors: ['#D4AF37', '#10B981', '#3B82F6']
          });
        } catch (e) {}

        const hasDuplicateWarnings = data.duplicateBarcodesAlert && data.duplicateBarcodesAlert.length > 0;
        const hasImportWarnings = Array.isArray(data.invalidRows) && data.invalidRows.length > 0;
        if (hasDuplicateWarnings) {
          setBarcodeWarnings(data.duplicateBarcodesAlert);
        }
        if (onImportSuccess) onImportSuccess(data.count);
        if (!hasDuplicateWarnings && !hasImportWarnings) {
          handleClose();
        }
      } else {
        setErrorMsg(data?.message || 'Error durante la importación.');
      }
    } catch (err) {
      setErrorMsg('Error de red al importar: ' + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadTemplate = () => {
    window.location.href = '/api/products/template';
  };

  const handleClose = () => {
    setSelectedFile(null);
    setParsedRows([]);
    setPreviewPage(0);
    setErrorMsg(null);
    setBarcodeWarnings(null);
    setImportWarnings(null);
    setImportNotice('');
    onClose();
  };

  const openPriceListImport = () => {
    handleClose();
    onOpenPriceListImport?.();
  };
  const previewColumns = parsedRows.length > 0 ? Object.keys(parsedRows[0]) : [];
  const previewRows = parsedRows.slice(
    previewPage * PREVIEW_PAGE_SIZE,
    (previewPage + 1) * PREVIEW_PAGE_SIZE
  );
  const previewStart = previewPage * PREVIEW_PAGE_SIZE + 1;
  const previewEnd = Math.min((previewPage + 1) * PREVIEW_PAGE_SIZE, parsedRows.length);
  const previewPageCount = Math.ceil(parsedRows.length / PREVIEW_PAGE_SIZE);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="relative w-full max-w-3xl bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden my-auto max-h-[90vh] flex flex-col animate-fadeIn text-slate-800">
        {/* Header Light */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50/80">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-700">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900">Importar Productos desde Excel</h3>
              <p className="text-xs text-slate-500">Carga masiva de inventario y estilos de zapatería</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1 bg-white">
          {/* Template Download Banner */}
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-bold text-slate-800">¿Necesitas la plantilla oficial?</h4>
              <p className="text-xs text-slate-500">
                Descarga un archivo Excel con las columnas requeridas (Código de Barras, Estilo, Color, Acabado, etc.)
              </p>
            </div>
            <button
              type="button"
              onClick={downloadTemplate}
              className="px-4 py-2 rounded-xl bg-white hover:bg-slate-50 text-amber-800 border border-amber-300 text-xs font-bold flex items-center justify-center space-x-2 transition shrink-0 shadow-xs"
            >
              <Download className="w-4 h-4 text-amber-600" />
              <span>Descargar Plantilla</span>
            </button>
          </div>

          <div className="flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h4 className="text-sm font-bold text-emerald-950">¿Tienes una lista de precios con datos repetidos?</h4>
              <p className="text-xs text-emerald-900">
                Elige qué campos heredar de un producto base. El Excel puede incluir Estilo, Color, Precio y más columnas.
              </p>
            </div>
            <button
              type="button"
              onClick={openPriceListImport}
              className="shrink-0 rounded-xl border border-emerald-300 bg-white px-4 py-2 text-xs font-bold text-emerald-900 hover:bg-emerald-100"
            >
              Importar lista desde Excel
            </button>
          </div>

          {/* Upload Dropzone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            className="border-2 border-dashed border-slate-300 hover:border-amber-400 rounded-2xl bg-slate-50/50 hover:bg-amber-50/20 p-8 text-center transition group cursor-pointer"
          >
            <label className="cursor-pointer block space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-300 text-amber-700 flex items-center justify-center mx-auto group-hover:scale-105 transition shadow-xs">
                <Upload className="w-7 h-7" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-800">
                  {selectedFile ? selectedFile.name : 'Arrastra tu archivo Excel aquí o haz clic para examinar'}
                </p>
                <p className="text-xs text-slate-400 mt-1 font-medium">Formatos compatibles: .xlsx, .xls</p>
              </div>
              <input
                type="file"
                accept=".xlsx, .xls"
                className="hidden"
                onChange={handleFileChange}
              />
            </label>
          </div>

          {barcodeWarnings && barcodeWarnings.length > 0 && (
            <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl text-amber-900 text-xs space-y-2 animate-fadeIn shadow-xs">
              <div className="flex items-center space-x-2 font-bold text-amber-900">
                <AlertCircle className="w-4 h-4 text-amber-700" />
                <span>⚠️ Advertencia de Códigos de Barras Repetidos ({barcodeWarnings.length})</span>
              </div>
              <ul className="list-disc list-inside space-y-1 text-[11px] text-amber-800 max-h-32 overflow-y-auto">
                {barcodeWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
              <div className="pt-1 flex justify-end">
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg text-xs"
                >
                  Entendido, cerrar
                </button>
              </div>
            </div>
          )}

          {importWarnings && importWarnings.length > 0 && (
            <div role="status" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900">
              {importNotice && <p className="font-bold">{importNotice}</p>}
              <p className="font-bold">Filas omitidas: deben incluir Corrida, Catálogo y Línea.</p>
              <ul className="max-h-32 list-disc space-y-1 overflow-y-auto pl-5">
                {importWarnings.slice(0, 25).map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
              </ul>
              {importWarnings.length > 25 && <p>Se muestran 25 de {importWarnings.length} filas omitidas.</p>}
              <div className="flex justify-end">
                <button type="button" onClick={handleClose} className="rounded-lg bg-amber-500 px-3 py-1 font-bold text-slate-950">
                  Entendido, cerrar
                </button>
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-300 text-red-800 text-xs rounded-xl flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Preview Table if rows parsed */}
          {parsedRows.length > 0 && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-700">
                  Vista previa ({parsedRows.length} filas detectadas)
                </span>
                <span className="text-xs text-emerald-700 font-semibold">{previewColumns.length} columnas leídas</span>
              </div>
              <div className="hidden max-h-72 overflow-auto rounded-xl border border-slate-200 bg-white sm:block">
                <table className="min-w-max text-left text-xs text-slate-700">
                  <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-[10px] font-bold uppercase text-slate-500">
                    <tr>
                      <th className="sticky left-0 bg-slate-50 p-2.5">#</th>
                      {previewColumns.map((column) => <th key={column} className="whitespace-nowrap p-2.5">{column}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                    {previewRows.map((row, idx) => (
                      <tr key={previewStart + idx} className="hover:bg-amber-50/30">
                        <td className="sticky left-0 bg-white p-2.5 text-slate-400">{previewStart + idx}</td>
                        {previewColumns.map((column) => (
                          <td key={column} className="max-w-64 whitespace-nowrap p-2.5">
                            {String(row[column] ?? '').trim() || '-'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="max-h-72 space-y-2 overflow-y-auto sm:hidden">
                {previewRows.map((row, idx) => (
                  <article key={previewStart + idx} className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="mb-2 text-xs font-bold text-amber-900">Fila {previewStart + idx}</p>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
                      {previewColumns.map((column) => (
                        <div key={column} className="min-w-0">
                          <dt className="text-[10px] font-semibold text-slate-500">{column}</dt>
                          <dd className="break-words text-xs text-slate-800">{String(row[column] ?? '').trim() || '-'}</dd>
                        </div>
                      ))}
                    </dl>
                  </article>
                ))}
              </div>
              {previewPageCount > 1 && (
                <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                  <span>Mostrando filas {previewStart}-{previewEnd} de {parsedRows.length}</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setPreviewPage(page => Math.max(0, page - 1))}
                      disabled={previewPage === 0}
                      className="rounded-lg border border-slate-300 px-2.5 py-1 font-semibold disabled:opacity-40"
                    >
                      Anterior
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewPage(page => Math.min(previewPageCount - 1, page + 1))}
                      disabled={previewPage >= previewPageCount - 1}
                      className="rounded-lg border border-slate-300 px-2.5 py-1 font-semibold disabled:opacity-40"
                    >
                      Siguiente
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-600 hover:text-slate-900 text-sm font-semibold hover:bg-slate-100 transition"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={isProcessing || parsedRows.length === 0}
            onClick={handleConfirmImport}
            className="gold-gradient-btn px-6 py-2.5 rounded-xl text-sm font-bold flex items-center space-x-2 disabled:opacity-50 shadow-sm"
          >
            <span>{isProcessing ? 'Importando a SQLite...' : `Confirmar e Importar (${parsedRows.length})`}</span>
            <ArrowRight className="w-4 h-4 text-slate-950" />
          </button>
        </div>
      </div>
    </div>
  );
}
