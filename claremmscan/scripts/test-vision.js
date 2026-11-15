'use strict';

const fs = require('node:fs');
const path = require('node:path');
const handler = require('../api/ocr.js');
process.env.CLAREMMSCAN_TEST = '1';

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
    const provider = [res.body?.providerCode, res.body?.providerType, res.body?.providerReason, res.body?.providerMessage].filter(Boolean).join('/');
    throw new Error(`${res.body?.error || res.statusCode}: ${res.body?.message || 'sin detalle'}${provider ? ` (${provider})` : ''}`);
  }
  return { provider: res.body.provider || 'desconocido', labels: res.body.labels || [] };
}

(async () => {
  if (!process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY) {
    console.error('Falta GEMINI_API_KEY u OPENAI_API_KEY. Configúrala solo en .env.local; nunca la guardes en Git.');
    process.exit(2);
  }
  const fixtureDir = path.resolve(__dirname, '../tests/prueba');
  const start = Math.max(0, Math.min(cases.length - 1, Number(process.argv[3]) || 0));
  const selectedCases = cases.slice(start, start + Math.max(1, Math.min(cases.length - start, Number(process.argv[2]) || cases.length)));
  let passed = 0;
  let caseIndex = 0;
  for (const [name, style, color, size] of selectedCases) {
    if (caseIndex++) await new Promise(resolve => setTimeout(resolve, 6500));
    try {
      const result = await analyze(path.join(fixtureDir, name));
      const labels = result.labels;
      const match = labels.find(label => String(label.style).toUpperCase() === style);
      const ok = match && String(match.color).toUpperCase().includes(color) && String(match.size).replace(',', '.') === size;
      console.log(`${ok ? '✓' : '✗'} ${name} [${result.provider}]:`, JSON.stringify(labels));
      if (ok) passed++;
    } catch (error) {
      console.log(`✗ ${name}: ${error.message}`);
    }
  }
  console.log(`Resultado real de visión: ${passed}/${selectedCases.length} fotografías correctas.`);
  process.exit(passed === selectedCases.length ? 0 : 1);
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
