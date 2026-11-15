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
          color: { type: 'string' },
          line: { type: 'string' },
          size: { type: 'string' },
          material: { type: 'string' },
          quantity: { type: 'integer' },
          confidence: { type: 'number' },
        },
        required: ['style', 'color', 'line', 'size', 'material', 'quantity', 'confidence'],
      },
    },
    raw_text: { type: 'string' },
  },
  required: ['labels', 'raw_text'],
};

const instructions = `Lee exclusivamente las etiquetas blancas de inventario visibles en la fotografía de cajas de calzado CLAREMM.

Reglas de extracción:
- STYLE/estilo es el código alfanumérico impreso al inicio de la primera línea, normalmente en la esquina superior izquierda de la etiqueta. Debe contener letras seguidas por dígitos. Ejemplos de formato: ROD410, GIO130, PA0071, OLP505. Los ejemplos solo explican el formato: nunca los copies si no están visibles.
- COLOR es la palabra o palabras inmediatamente posteriores al estilo en esa misma primera línea. No confundas color con marca, modelo, material ni texto de otra caja.
- SIZE/talla es el número grande de talla, normalmente entre 15.0 y 32.0 y terminado en .0 o .5.
- MATERIAL solo puede salir del texto visible, por ejemplo PIEL o SINTETICO. Déjalo vacío si no aparece.
- LINE es el tipo de calzado únicamente si es evidente: Tenis, Zapato, Bota, Huarache o Sandalia. Déjalo vacío si no es evidente.
- QUANTITY es 1 por cada etiqueta individual.
- Si un carácter no se distingue, deja el campo vacío. No completes ni adivines códigos.
- Devuelve una entrada por cada etiqueta principal legible. Ignora códigos de barras, logotipos, tallas de pegatinas auxiliares y textos grandes impresos en la caja.
- confidence debe estar entre 0 y 1 y reflejar la certeza de lectura del estilo, color y talla.
- raw_text debe ser una transcripción breve del texto útil realmente visible.`;

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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'method_not_allowed', message: 'Usa una solicitud POST.' });
  }

  if (!process.env.OPENAI_API_KEY) {
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
    const upstream = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
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
    if (!upstream.ok) {
      const providerCode = typeof response?.error?.code === 'string' ? response.error.code : '';
      const noCredit = providerCode === 'credit_balance_exhausted' || providerCode === 'insufficient_quota';
      const code = noCredit ? 'vision_no_credit' : upstream.status === 429 ? 'rate_limited' : 'vision_api_error';
      const message = noCredit
        ? 'La cuenta de visión no tiene saldo disponible. Agrega créditos de API y vuelve a intentar.'
        : upstream.status === 429
          ? 'El servicio de visión está ocupado o alcanzó su límite. Intenta nuevamente.'
          : 'No fue posible analizar la imagen con visión.';
      return send(res, upstream.status === 429 ? 429 : 502, {
        error: code,
        message,
        providerCode,
        providerType: typeof response?.error?.type === 'string' ? response.error.type : '',
      });
    }
    if (response.status && response.status !== 'completed') {
      return send(res, 502, { error: 'incomplete_response', message: 'El análisis de visión quedó incompleto.' });
    }

    const text = outputText(response);
    if (!text) return send(res, 502, { error: 'empty_response', message: 'La visión no devolvió datos legibles.' });
    let result;
    try { result = JSON.parse(text); } catch {
      return send(res, 502, { error: 'invalid_response', message: 'La visión devolvió un formato inesperado.' });
    }
    if (!Array.isArray(result.labels) || typeof result.raw_text !== 'string') {
      return send(res, 502, { error: 'invalid_response', message: 'La visión devolvió datos incompletos.' });
    }
    return send(res, 200, { labels: result.labels, rawText: result.raw_text });
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
