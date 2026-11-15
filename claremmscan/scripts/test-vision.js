'use strict';

const fs = require('node:fs');
const path = require('node:path');
const handler = require('../api/ocr.js');

const cases = [
  ['WhatsApp Image 2026-11-15 at 11.53.05 (1).jpeg', 'ROD410', 'NEGRO', '26.5'],
  ['WhatsApp Image 2026-11-15 at 11.53.05 (2).jpeg', 'ROD410', 'NEGRO', '26.0'],
  ['WhatsApp Image 2026-11-15 at 11.53.05.jpeg', 'GIO130', 'CAMEL', '19.0'],
  ['WhatsApp Image 2026-11-15 at 11.53.06 (1).jpeg', 'OLP505', 'CAFE', '27.5'],
  ['WhatsApp Image 2026-11-15 at 11.53.06.jpeg', 'PA0071', 'NEGRO', '27.0'],
];

function response() {
  return {
    statusCode: 0,
    body: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function analyze(file) {
  const image = `data:image/jpeg;base64,${fs.readFileSync(file, 'base64')}`;
  const res = response();
  await handler({ method: 'POST', body: { image } }, res);
  if (res.statusCode !== 200) {
    const provider = [res.body?.providerCode, res.body?.providerType].filter(Boolean).join('/');
    throw new Error(`${res.body?.error || res.statusCode}: ${res.body?.message || 'sin detalle'}${provider ? ` (${provider})` : ''}`);
  }
  return res.body.labels || [];
}

(async () => {
  if (!process.env.OPENAI_API_KEY) {
    console.error('Falta OPENAI_API_KEY. Configúrala solo en tu terminal o en .env.local; nunca la guardes en Git.');
    process.exit(2);
  }
  const fixtureDir = path.resolve(__dirname, '../tests/prueba');
  let passed = 0;
  for (const [name, style, color, size] of cases) {
    const labels = await analyze(path.join(fixtureDir, name));
    const match = labels.find(label => String(label.style).toUpperCase() === style);
    const ok = match && String(match.color).toUpperCase().includes(color) && String(match.size).replace(',', '.') === size;
    console.log(`${ok ? '✓' : '✗'} ${name}:`, JSON.stringify(labels));
    if (ok) passed++;
  }
  console.log(`Resultado real de visión: ${passed}/${cases.length} fotografías correctas.`);
  process.exit(passed === cases.length ? 0 : 1);
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
