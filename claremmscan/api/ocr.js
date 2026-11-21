'use strict';

const MAX_IMAGE_CHARACTERS = 3_500_000;
const IMAGE_DATA_URL = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=\r\n]+$/;

const outputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    labels: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          style: { type: 'string' },
          brand: { type: 'string' },
          color: { type: 'string' },
          line: { type: 'string' },
          size: { type: 'string' },
          material: { type: 'string' },
          quantity: { type: 'integer' },
          price: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['style', 'brand', 'color', 'line', 'size', 'material', 'quantity', 'price', 'confidence'],
      },
    },
    raw_text: { type: 'string' },
  },
  required: ['labels', 'raw_text'],
};

const instructions = `Lee exclusivamente las etiquetas blancas de inventario visibles en la fotografía de cajas de calzado CLAREMM.

Reglas de extracción:
- STYLE/estilo es el código alfanumérico impreso al inicio de la primera línea, normalmente en la esquina superior izquierda de la etiqueta. Debe contener letras seguidas por dígitos. Ejemplos de formato: ROD410, GIO130, PA0071, OLP505. Los ejemplos solo explican el formato: nunca los copies si no están visibles.
- BRAND/marca es el nombre de marca o modelo comercial visible en la etiqueta, normalmente en la línea posterior al estilo y color. Transcribe únicamente lo visible y déjalo vacío si no se distingue; no asumas que el logotipo del fabricante de la etiqueta es la marca del producto.
- COLOR es la palabra o palabras inmediatamente posteriores al estilo en esa misma primera línea. No confundas color con marca, modelo, material ni texto de otra caja.
- SIZE/talla es el número grande de talla, normalmente entre 15.0 y 32.0 y terminado en .0 o .5.
- MATERIAL solo puede salir del texto visible, por ejemplo PIEL o SINTETICO. Déjalo vacío si no aparece.
- LINE es el tipo de calzado únicamente si es evidente: Tenis, Zapato, Bota, Huarache o Sandalia. Déjalo vacío si no es evidente.
- QUANTITY es 1 por cada etiqueta individual.
- PRICE/precio es el precio de venta impreso en la etiqueta o caja, si es visible: 659, 1,199, $659 o 659.00. El precio se comparte entre colores del mismo estilo y la misma corrida de tallas; no lo apliques a otra corrida. Déjalo vacío si no se ve; no lo inventes ni uses la talla como precio.
- Si un carácter no se distingue, deja el campo vacío. No completes ni adivines códigos.
- Devuelve una entrada por cada etiqueta principal legible. Ignora códigos de barras, logotipos, tallas de pegatinas auxiliares y textos grandes impresos en la caja.
- confidence debe estar entre 0 y 1 y reflejar la certeza de lectura del estilo, color y talla.
- raw_text debe ser una transcripción breve del texto útil realmente visible.`;

const STYLE_PREFIXES = ['LAP', 'ANG', 'GIO', 'ROD', 'OLP', 'UN', 'SP', 'PI', 'PA'];

function prefixLooksLike(raw, expected) {
  if (raw.length !== expected.length) return false;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== expected[i] && !(
      (expected[i] === 'O' && /[0QD]/.test(raw[i])) ||
      (expected[i] === 'I' && /[1L]/.test(raw[i])) ||
      (expected[i] === 'L' && /[I1]/.test(raw[i]))
    )) return false;
  }
  return true;
}

function normalizeStyle(value) {
  const code = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  for (const prefix of STYLE_PREFIXES) {
    const rawPrefix = code.slice(0, prefix.length);
    const rawDigits = code.slice(prefix.length);
    if (rawDigits.length < 3 || rawDigits.length > 6 || !/[0-9]/.test(rawDigits) || !/^[0-9OQDILSZGB]+$/.test(rawDigits) || !prefixLooksLike(rawPrefix, prefix)) continue;
    return prefix + rawDigits.replace(/[OQD]/g, '0').replace(/[IL]/g, '1').replace(/Z/g, '2').replace(/S/g, '5').replace(/G/g, '6').replace(/B/g, '8');
  }
  return code;
}

function normalizeResult(result) {
  return {
    ...result,
    labels: result.labels.map(label => ({ ...label, style: normalizeStyle(label.style) })),
  };
}

function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(body);
}

function outputText(response) {
  if (typeof response.output_text === 'string') return response.output_text;
  for (const item of response.output || []) {
    for (const part of item.content || []) {
      if (part.type === 'output_text' && typeof part.text === 'string') return part.text;
    }
  }
  return '';
}

function parseStructuredText(text) {
  if (!text) throw Object.assign(new Error('empty_response'), { publicCode: 'empty_response', publicMessage: 'La visión no devolvió datos legibles.' });
  let result;
  try { result = JSON.parse(text); } catch {
    throw Object.assign(new Error('invalid_response'), { publicCode: 'invalid_response', publicMessage: 'La visión devolvió un formato inesperado.' });
  }
  if (!Array.isArray(result.labels) || typeof result.raw_text !== 'string') {
    throw Object.assign(new Error('invalid_response'), { publicCode: 'invalid_response', publicMessage: 'La visión devolvió datos incompletos.' });
  }
  return result;
}

function providerFailure(provider, status, response) {
  const providerCode = String(response?.error?.code || response?.error?.status || '');
  const providerType = String(response?.error?.type || response?.error?.status || '');
  const noCredit = providerCode === 'credit_balance_exhausted' || providerCode === 'insufficient_quota';
  const invalidKey = status === 401 || status === 403 || providerCode === 'PERMISSION_DENIED' || providerCode === 'UNAUTHENTICATED';
  const unavailableModel = status === 404 || providerCode === 'NOT_FOUND';
  const limited = status === 429 || providerCode === 'RESOURCE_EXHAUSTED';
  const error = new Error(`${provider}_api_error`);
  error.status = limited ? 429 : invalidKey ? 401 : 502;
  error.publicCode = noCredit ? 'vision_no_credit' : invalidKey ? 'vision_key_invalid' : unavailableModel ? 'vision_model_unavailable' : limited ? 'rate_limited' : 'vision_api_error';
  error.publicMessage = noCredit
    ? 'La cuenta de OpenAI no tiene saldo disponible.'
    : invalidKey
      ? `La clave de ${provider === 'gemini' ? 'Gemini' : 'OpenAI'} no es válida o no tiene permiso.`
      : unavailableModel
        ? `El modelo configurado para ${provider === 'gemini' ? 'Gemini' : 'OpenAI'} no está disponible.`
        : limited
          ? `${provider === 'gemini' ? 'Gemini alcanzó su cuota gratuita o límite temporal' : 'OpenAI alcanzó su límite temporal'}. Intenta nuevamente.`
          : `No fue posible analizar la imagen con ${provider === 'gemini' ? 'Gemini' : 'OpenAI'}.`;
  error.provider = provider;
  error.providerCode = providerCode;
  error.providerType = providerType;
  error.providerReason = (response?.error?.details || []).map(detail => detail?.reason || detail?.metadata?.reason || '').filter(Boolean).join(',');
  error.providerMessage = typeof response?.error?.message === 'string' ? response.error.message.slice(0, 500) : '';
  return error;
}

async function analyzeWithGemini(image, signal) {
  const match = image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) throw new Error('invalid_image');
  const model = process.env.GEMINI_VISION_MODEL || 'gemini-3.5-flash-lite';
  const request = {
    method: 'POST',
    headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      model,
      store: false,
      input: [
        { type: 'text', text: `${instructions}\n\nExtrae los datos de las etiquetas visibles siguiendo exactamente las reglas.` },
        { type: 'image', mime_type: match[1], data: match[2].replace(/\s/g, '') },
      ],
      response_format: { type: 'text', mime_type: 'application/json', schema: outputSchema },
    }),
  };
  let upstream, response;
  for (let attempt = 0; attempt < 3; attempt++) {
    upstream = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      ...request,
      headers: { ...request.headers, 'Api-Revision': '2026-05-20' },
    });
    response = await upstream.json().catch(() => ({}));
    if (upstream.ok) break;
    const retryable = upstream.status === 403 || upstream.status === 429 || upstream.status === 500 || upstream.status === 503;
    if (!retryable || attempt === 2) throw providerFailure('gemini', upstream.status, response);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 750 * (attempt + 1));
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); }, { once: true });
    });
  }
  const text = typeof response.output_text === 'string'
    ? response.output_text
    : (response.steps || []).filter(step => step.type === 'model_output').flatMap(step => step.content || []).filter(content => content.type === 'text').map(content => content.text || '').join('');
  return normalizeResult(parseStructuredText(text));
}

async function analyzeWithOpenAI(image, signal) {
  const upstream = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    signal,
    body: JSON.stringify({
      model: process.env.OPENAI_VISION_MODEL || 'gpt-6-luna',
      store: false,
      max_output_tokens: 1200,
      instructions,
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: 'Extrae los datos de las etiquetas visibles siguiendo exactamente las reglas.' },
          { type: 'input_image', image_url: image, detail: 'high' },
        ],
      }],
      text: {
        format: {
          type: 'json_schema',
          name: 'claremmscan_labels',
          strict: true,
          schema: outputSchema,
        },
      },
    }),
  });
  const response = await upstream.json().catch(() => ({}));
  if (!upstream.ok) throw providerFailure('openai', upstream.status, response);
  if (response.status && response.status !== 'completed') {
    throw Object.assign(new Error('incomplete_response'), { publicCode: 'incomplete_response', publicMessage: 'El análisis de OpenAI quedó incompleto.' });
  }
  return normalizeResult(parseStructuredText(outputText(response)));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'method_not_allowed', message: 'Usa una solicitud POST.' });
  }

  if (!process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY) {
    return send(res, 503, {
      error: 'vision_not_configured',
      message: 'El reconocimiento por visión aún no está configurado en el servidor.',
    });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const image = body?.image;
  if (typeof image !== 'string' || image.length > MAX_IMAGE_CHARACTERS || !IMAGE_DATA_URL.test(image)) {
    return send(res, 400, {
      error: 'invalid_image',
      message: 'La imagen no es válida o supera el tamaño permitido.',
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55_000);
  try {
    const failures = [];
    if (process.env.GEMINI_API_KEY) {
      try {
        const result = await analyzeWithGemini(image, controller.signal);
        return send(res, 200, { provider: 'gemini', labels: result.labels, rawText: result.raw_text });
      } catch (error) { failures.push(error); }
    }
    if (process.env.OPENAI_API_KEY) {
      try {
        const result = await analyzeWithOpenAI(image, controller.signal);
        return send(res, 200, { provider: 'openai', labels: result.labels, rawText: result.raw_text });
      } catch (error) { failures.push(error); }
    }
    const error = failures[0] || new Error('vision_unavailable');
    if (error.name === 'AbortError') throw error;
    return send(res, error.status || 502, {
      error: error.publicCode || 'vision_unavailable',
      message: error.publicMessage || 'El servicio de visión no está disponible.',
      provider: error.provider || '',
      providerCode: error.providerCode || '',
      providerType: error.providerType || '',
      providerReason: error.providerReason || '',
      ...(process.env.CLAREMMSCAN_TEST === '1' ? { providerMessage: error.providerMessage || '' } : {}),
    });
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    return send(res, 502, {
      error: timedOut ? 'vision_timeout' : 'vision_unavailable',
      message: timedOut ? 'El análisis tardó demasiado. Intenta de nuevo.' : 'El servicio de visión no está disponible.',
    });
  } finally {
    clearTimeout(timeout);
  }
};
