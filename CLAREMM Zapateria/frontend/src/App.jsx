import React, { useState, useEffect, useCallback } from 'react';
import Navbar from './components/Navbar';
import StatsCards from './components/StatsCards';
import ProductTable from './components/ProductTable';
import CaptureModal from './components/CaptureModal';
import EditModal from './components/EditModal';
import DeleteDialog from './components/DeleteDialog';
import ExcelImportModal from './components/ExcelImportModal';
import ExcelExportModal from './components/ExcelExportModal';
import SazExportModal from './components/SazExportModal';
import PriceListImportModal from './components/PriceListImportModal';
import ApiKeyModal from './components/ApiKeyModal';
import ImageViewerModal from './components/ImageViewerModal';
import StockManagementModal from './components/StockManagementModal';
import { Sparkles, Bell } from 'lucide-react';
import { safeFetchJson } from './utils/api';

export default function App() {
  // Table & Data State
  const [products, setProducts] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [downloadingImages, setDownloadingImages] = useState(false);
  const [stats, setStats] = useState(null);
  const [productOptions, setProductOptions] = useState({});

  // Filters State
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMarca, setFilterMarca] = useState('');
  const [filterLinea, setFilterLinea] = useState('');
  const [filterClasificacion, setFilterClasificacion] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  // Modals State
  const [isCaptureOpen, setIsCaptureOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isPriceListImportOpen, setIsPriceListImportOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isSazExportOpen, setIsSazExportOpen] = useState(false);
  const [isApiKeyOpen, setIsApiKeyOpen] = useState(false);
  const [isStockOpen, setIsStockOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [deletingProduct, setDeletingProduct] = useState(null);
  const [viewingImage, setViewingImage] = useState(null); // { url, title }

  // System & Connection State
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [geminiKeyActive, setGeminiKeyActive] = useState(false);
  const [liveToast, setLiveToast] = useState(null); // { title, text }

  // Fetch Products
  const fetchProducts = useCallback(async (customPage = null) => {
    setLoading(true);
    try {
      const pageToFetch = customPage !== null ? customPage : pagination.page;
      const params = new URLSearchParams({
        page: pageToFetch,
        limit: pagination.limit,
        search: searchTerm,
        marca: filterMarca,
        linea: filterLinea,
        clasificacion: filterClasificacion,
        desde: filterDateFrom,
        hasta: filterDateTo
      });

      const data = await safeFetchJson(`/api/products?${params.toString()}`);

      if (data && data.success) {
        setProducts(data.items || []);
        setPagination(data.pagination || { page: 1, limit: 10, total: 0, totalPages: 1 });
      }
    } catch (err) {
      console.error('Error fetching products:', err);
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.limit, searchTerm, filterMarca, filterLinea, filterClasificacion, filterDateFrom, filterDateTo]);

  // Fetch Dashboard Stats
  const fetchStats = async () => {
    try {
      const data = await safeFetchJson('/api/stats');
      if (data && data.success) {
        setStats(data.stats);
      }
    } catch (err) {
      console.error('Error fetching stats:', err);
    }
  };

  const fetchProductOptions = useCallback(async () => {
    try {
      const data = await safeFetchJson('/api/products/options');
      if (data && data.success) setProductOptions(data.options || {});
    } catch (err) {
      console.error('Error fetching product field options:', err);
    }
  }, []);

  // Check Gemini Key status
  const checkGeminiKey = async () => {
    try {
      const data = await safeFetchJson('/api/settings/gemini-key');
      if (data && data.success) {
        setGeminiKeyActive(data.hasKey);
      }
    } catch (err) {
      console.error('Error checking Gemini key:', err);
    }
  };

  // Initialize on mount
  useEffect(() => {
    fetchProducts();
    fetchStats();
    checkGeminiKey();
    fetchProductOptions();
  }, [fetchProducts, fetchProductOptions]);

  // Real-Time Server-Sent Events (SSE) Listener
  useEffect(() => {
    const eventSource = new EventSource('/events');

    eventSource.onopen = () => {
      setRealtimeConnected(true);
    };

    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'CONNECTED') {
          setRealtimeConnected(true);
        } else if (data.type === 'PRODUCT_CREATED') {
          showNotification('¡Nuevo Producto Capturado!', `Estilo ${data.product.estilo} agregado en tiempo real.`);
          fetchProducts();
          fetchStats();
          fetchProductOptions();
        } else if (data.type === 'PRODUCT_UPDATED') {
          showNotification('Producto Actualizado', `Estilo ${data.product.estilo} actualizado.`);
          fetchProducts();
          fetchStats();
          fetchProductOptions();
        } else if (data.type === 'PRODUCT_DELETED') {
          showNotification('Producto Ocultado', `ID #${data.id} ocultado del catálogo.`);
          fetchProducts();
          fetchStats();
          fetchProductOptions();
        } else if (data.type === 'PRODUCTS_IMPORTED') {
          showNotification('Importación Excel Exitosa', `${data.count} productos importados.`);
          fetchProducts();
          fetchStats();
          fetchProductOptions();
        } else if (data.type === 'STOCK_UPDATED') {
          showNotification('Existencias actualizadas', `Estilo ${data.estilo}: inventario por talla guardado.`);
        }
      } catch (err) {
        // Heartbeat or malformed json
      }
    };

    eventSource.onerror = () => {
      setRealtimeConnected(false);
    };

    return () => {
      eventSource.close();
    };
  }, [fetchProducts, fetchProductOptions]);

  const showNotification = (title, text) => {
    setLiveToast({ title, text });
    setTimeout(() => {
      setLiveToast(null);
    }, 4000);
  };

  // Pagination Handlers
  const handlePageChange = (newPage) => {
    setPagination(prev => ({ ...prev, page: newPage }));
  };

  const handleLimitChange = (newLimit) => {
    setPagination(prev => ({ ...prev, limit: newLimit, page: 1 }));
  };

  const handleDateFromChange = (value) => {
    setFilterDateFrom(value);
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const handleDateToChange = (value) => {
    setFilterDateTo(value);
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const handleExportExcel = () => {
    setIsExportOpen(true);
  };

  const handleConfirmExportExcel = ({ type, dateFrom, dateTo }) => {
    const params = new URLSearchParams({
      tipo: type,
      desde: dateFrom,
      hasta: dateTo
    });
    window.location.href = `/api/products/export?${params.toString()}`;
    setIsExportOpen(false);
  };

  const handleDownloadProductImages = async () => {
    setDownloadingImages(true);
    try {
      const response = await fetch('/api/product-images/export');
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.message || 'No se pudieron descargar las imágenes.');
      }

      const zip = await response.blob();
      const url = URL.createObjectURL(zip);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'CLAREMM_Imagenes_Agente_SAZ.zip';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);

      const count = response.headers.get('X-Image-Count') || '0';
      const skipped = Number(response.headers.get('X-Image-Skipped') || 0);
      const ambiguous = Number(response.headers.get('X-Image-Ambiguous') || 0);
      const notes = [
        skipped ? `${skipped} producto(s) sin foto local` : '',
        ambiguous ? `${ambiguous} nombre(s) duplicado(s) omitido(s)` : ''
      ].filter(Boolean);
      showNotification(
        'Descarga de imágenes lista',
        `${count} imagen(es) en el ZIP.${notes.length ? ` ${notes.join('; ')}.` : ''} Descomprímelo en la carpeta de imágenes del agente.`
      );
    } catch (error) {
      showNotification('No se pudieron descargar las imágenes', error.message);
    } finally {
      setDownloadingImages(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-slate-900 flex flex-col font-sans selection:bg-amber-400 selection:text-slate-950">
      {/* Top Navigation */}
      <Navbar
        onOpenCapture={() => setIsCaptureOpen(true)}
        onOpenImport={() => setIsImportOpen(true)}
        onOpenSazExport={() => setIsSazExportOpen(true)}
        onOpenApiKey={() => setIsApiKeyOpen(true)}
        geminiKeyActive={geminiKeyActive}
        realtimeConnected={realtimeConnected}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8 space-y-5 sm:space-y-8">
        {/* Banner Hero Light Luxury */}
        <div className="relative overflow-hidden rounded-2xl sm:rounded-3xl p-5 sm:p-8 bg-gradient-to-r from-white via-amber-50/40 to-amber-100/30 border border-amber-200/80 shadow-sm">
          <div className="relative z-10 max-w-2xl space-y-2.5 sm:space-y-3">
            <div className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-amber-100/70 border border-amber-300 text-amber-900 text-[10px] sm:text-xs font-bold">
              <Sparkles className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-amber-700" />
              <span>CAPTURA DUAL & GEMINI AI</span>
            </div>
            <h2 className="text-xl sm:text-4xl font-black text-slate-900 tracking-tight leading-tight">
              Catálogo y Control de Calzado <span className="gold-gradient-text">CLAREMM</span>
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed font-medium">
              Digitalización inteligente de inventario. Extrae código de barras, estilo, color, acabado, marca, temporada, clasificación, línea, precio y costo automáticamente.
            </p>

            <div className="pt-2 flex flex-col sm:flex-row gap-2 sm:gap-3">
              <button
                type="button"
                onClick={() => setIsCaptureOpen(true)}
                className="gold-gradient-btn px-4 sm:px-5 py-2.5 rounded-xl text-xs font-bold shadow-sm hover:shadow-md text-center"
              >
                + Capturar Nuevo Producto
              </button>
              <button
                type="button"
                onClick={() => setIsImportOpen(true)}
                className="px-4 sm:px-5 py-2.5 rounded-xl text-xs font-semibold bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 transition shadow-xs text-center"
              >
                Importar en Formato Excel
              </button>
            </div>
          </div>

          {/* Background subtle light gold glow */}
          <div className="absolute right-0 top-0 w-64 sm:w-96 h-64 sm:h-96 bg-amber-200/30 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />
        </div>

        {/* KPI Stats Cards */}
        <StatsCards stats={stats} totalProducts={pagination.total} />

        {/* Product Table with Pagination */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-slate-900 flex items-center space-x-2">
              <span>Inventario y Fichas Capturadas</span>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 font-mono font-semibold border border-slate-200">
                {pagination.total} registros
              </span>
            </h3>
          </div>

          <ProductTable
            products={products}
            pagination={pagination}
            loading={loading}
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            filterMarca={filterMarca}
            onFilterMarcaChange={setFilterMarca}
            filterLinea={filterLinea}
            onFilterLineaChange={setFilterLinea}
            filterClasificacion={filterClasificacion}
            onFilterClasificacionChange={setFilterClasificacion}
            filterDateFrom={filterDateFrom}
            onFilterDateFromChange={handleDateFromChange}
            filterDateTo={filterDateTo}
            onFilterDateToChange={handleDateToChange}
            onPageChange={handlePageChange}
            onLimitChange={handleLimitChange}
            onEditProduct={(p) => setEditingProduct(p)}
            onDeleteProduct={(p) => setDeletingProduct(p)}
            onViewImage={(url, title) => setViewingImage({ url, title })}
            onOpenCapture={() => setIsCaptureOpen(true)}
            onManageStock={() => setIsStockOpen(true)}
            onExportExcel={handleExportExcel}
            onDownloadProductImages={handleDownloadProductImages}
            downloadingImages={downloadingImages}
            productOptions={productOptions}
          />
        </section>
      </main>

      {/* Footer Light */}
      <footer className="border-t border-slate-200 bg-white py-6 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <p>© {new Date().getFullYear()} CLAREMM Zapatería. Panel VIP de Captura y Digitalización de Calzado.</p>
          <p className="text-[11px] text-slate-400 font-medium">
            Node.js • SQLite • Vite • React • Gemini Multimodal Vision
          </p>
        </div>
      </footer>

      {/* MODALS */}
      {/* 1. Dual Capture & Gemini Extraction Modal */}
      <CaptureModal
        isOpen={isCaptureOpen}
        onClose={() => setIsCaptureOpen(false)}
        onProductSaved={() => {
          fetchProducts();
          fetchStats();
          fetchProductOptions();
        }}
        onOpenApiKeyModal={() => setIsApiKeyOpen(true)}
        productOptions={productOptions}
      />

      {/* 2. Edit Modal */}
      <EditModal
        isOpen={!!editingProduct}
        product={editingProduct}
        onClose={() => setEditingProduct(null)}
        onProductUpdated={() => {
          fetchProducts();
          fetchStats();
          fetchProductOptions();
        }}
        productOptions={productOptions}
      />

      {/* 3. Delete Confirmation Dialog */}
      <DeleteDialog
        isOpen={!!deletingProduct}
        product={deletingProduct}
        onClose={() => setDeletingProduct(null)}
        onConfirmDelete={() => {
          fetchProducts();
          fetchStats();
        }}
      />

      {/* 4. Excel Export Filters */}
      {isSazExportOpen && <SazExportModal isOpen onClose={() => setIsSazExportOpen(false)} products={products} />}
      <ExcelExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        onExport={handleConfirmExportExcel}
      />

      {/* 5. Excel Import Modal */}
      <ExcelImportModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onOpenPriceListImport={() => setIsPriceListImportOpen(true)}
        onImportSuccess={() => {
          fetchProducts();
          fetchStats();
        }}
      />

      <PriceListImportModal
        isOpen={isPriceListImportOpen}
        onClose={() => setIsPriceListImportOpen(false)}
        onImportSuccess={() => {
          fetchProducts();
          fetchStats();
          fetchProductOptions();
        }}
      />

      {/* 6. Gemini API Key Configuration Modal */}
      <ApiKeyModal
        isOpen={isApiKeyOpen}
        onClose={() => setIsApiKeyOpen(false)}
        onKeySaved={() => {
          checkGeminiKey();
        }}
      />

      <StockManagementModal
        isOpen={isStockOpen}
        onClose={() => setIsStockOpen(false)}
        onSaved={fetchProducts}
      />

      {/* 7. High-Definition Lightbox Image Viewer */}
      <ImageViewerModal
        isOpen={!!viewingImage}
        imageUrl={viewingImage?.url}
        title={viewingImage?.title}
        onClose={() => setViewingImage(null)}
      />

      {/* FLOATING REAL-TIME TOAST NOTIFICATION LIGHT */}
      {liveToast && (
        <div className="fixed bottom-6 right-6 z-50 animate-bounceIn flex items-center space-x-3 p-4 rounded-2xl bg-white border border-amber-300 shadow-xl max-w-sm">
          <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0 border border-amber-200">
            <Bell className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-900">{liveToast.title}</h4>
            <p className="text-[11px] text-slate-600 mt-0.5">{liveToast.text}</p>
          </div>
        </div>
      )}
    </div>
  );
}
