import React, { useRef, useState, useEffect } from 'react';
import { Camera, RefreshCw, X, Check, FlipHorizontal } from 'lucide-react';

export default function WebcamViewfinder({ onCapture, onClose, title = "Tomar Fotografía" }) {
  const videoRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [facingMode, setFacingMode] = useState('environment'); // Default to rear camera on mobile
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [error, setError] = useState(null);
  const [capturedImage, setCapturedImage] = useState(null);

  useEffect(() => {
    let currentStream = null;

    async function initCamera() {
      try {
        setError(null);
        if (!window.isSecureContext) {
          setError('La cámara requiere HTTPS seguro. Abre la dirección HTTPS de QA y confía el certificado en este dispositivo.');
          return;
        }
        if (!navigator.mediaDevices?.getUserMedia) {
          setError('Este navegador no permite acceso a la cámara. Usa la opción de subir archivo.');
          return;
        }

        if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const videoDevices = devices.filter(d => d.kind === 'videoinput');
          setHasMultipleCameras(videoDevices.length > 1);
        }

        const constraints = {
          video: {
            facingMode: facingMode,
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          },
          audio: false
        };

        const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        currentStream = mediaStream;
        setStream(mediaStream);

        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          videoRef.current.play().catch(e => console.warn('Play interrupted:', e));
        }
      } catch (err) {
        console.error('Camera access error:', err);
        try {
          const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          currentStream = fallbackStream;
          setStream(fallbackStream);
          if (videoRef.current) {
            videoRef.current.srcObject = fallbackStream;
          }
        } catch (fallbackErr) {
          setError('No se pudo acceder a la cámara. Asegúrate de otorgar permisos o utiliza la opción de subir archivo.');
        }
      }
    }

    initCamera();

    return () => {
      if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [facingMode]);

  const toggleFacingMode = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
    setFacingMode(prev => (prev === 'environment' ? 'user' : 'environment'));
  };

  const takeSnapshot = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    setCapturedImage(dataUrl);
  };

  const retake = () => {
    setCapturedImage(null);
  };

  const confirmCapture = () => {
    if (capturedImage) {
      onCapture(capturedImage);
      handleClose();
    }
  };

  const handleClose = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-md flex flex-col items-center justify-center p-3 sm:p-6 animate-fadeIn">
      <div className="relative w-full max-w-2xl bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh] text-slate-800">
        {/* Header Light */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50/80">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-amber-50 rounded-lg border border-amber-300 text-amber-700">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900">{title}</h3>
              <p className="text-xs text-slate-500">Enfoca con buena iluminación para mejor lectura</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Viewfinder area */}
        <div className="relative flex-1 bg-black flex items-center justify-center min-h-[340px] max-h-[550px] overflow-hidden">
          {error ? (
            <div className="p-6 text-center max-w-md bg-white rounded-xl shadow m-4">
              <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-3">
                <Camera className="w-6 h-6" />
              </div>
              <p className="text-sm text-red-700 font-semibold">{error}</p>
              <button
                onClick={handleClose}
                className="mt-4 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-sm font-semibold rounded-lg transition"
              >
                Cerrar y subir archivo manualmente
              </button>
            </div>
          ) : capturedImage ? (
            <div className="relative w-full h-full flex items-center justify-center bg-black">
              <img
                src={capturedImage}
                alt="Captura previa"
                className="max-h-[500px] w-auto object-contain rounded-lg"
              />
              <div className="absolute top-4 right-4 bg-emerald-600 text-white text-xs px-3 py-1 rounded-full font-bold flex items-center space-x-1 shadow-lg">
                <Check className="w-3.5 h-3.5" />
                <span>Foto Capturada</span>
              </div>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover sm:object-contain"
              />
              {/* Framing guidelines */}
              <div className="absolute inset-8 border-2 border-amber-400/80 border-dashed rounded-xl pointer-events-none flex flex-col justify-between p-3">
                <div className="flex justify-between text-amber-300 font-bold text-[10px] tracking-wider uppercase drop-shadow">
                  <span>Encuadre Calzado / Ficha</span>
                  <span>CLAREMM VIP</span>
                </div>
                <div className="text-center text-amber-300 font-bold text-[10px] tracking-wider uppercase drop-shadow">
                  Alinea los textos claramente
                </div>
              </div>

              {/* Flip camera button */}
              {hasMultipleCameras && (
                <button
                  type="button"
                  onClick={toggleFacingMode}
                  className="absolute top-4 left-4 p-2.5 bg-black/60 hover:bg-black/90 text-white rounded-full border border-white/20 transition shadow-lg backdrop-blur-sm"
                  title="Cambiar Cámara"
                >
                  <FlipHorizontal className="w-5 h-5" />
                </button>
              )}
            </>
          )}
        </div>

        {/* Footer controls Light */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          {capturedImage ? (
            <>
              <button
                type="button"
                onClick={retake}
                className="flex items-center space-x-2 px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold transition shadow-xs"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Volver a Tomar</span>
              </button>
              <button
                type="button"
                onClick={confirmCapture}
                className="gold-gradient-btn flex items-center space-x-2 px-6 py-2.5 rounded-xl text-sm font-bold shadow-md"
              >
                <Check className="w-4 h-4 text-slate-950" />
                <span>Usar Esta Fotografía</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-600 text-sm font-semibold transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={takeSnapshot}
                disabled={!!error}
                className="group relative flex items-center justify-center p-3 bg-gradient-to-r from-amber-400 to-amber-600 rounded-full text-slate-950 font-bold shadow-lg hover:scale-105 active:scale-95 transition disabled:opacity-50"
              >
                <div className="w-12 h-12 rounded-full border-2 border-slate-950 flex items-center justify-center">
                  <Camera className="w-6 h-6" />
                </div>
              </button>
              <div className="w-16" />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
