'use strict';

const fs = require('node:fs');
const path = require('node:path');
const handler = require('../api/v1/[...path].js');

for (const line of fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (match && !match[1].startsWith('#') && process.env[match[1]] == null) {
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

function call(method, urlPath, { body, headers = {} } = {}) {
  const parts = urlPath.replace(/^\/api\/v1\/?/, '').split('/').filter(Boolean);
  const res = {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  const req = {
    method,
    url: urlPath,
    headers: { 'content-type': 'application/json', ...headers },
    query: { path: parts },
    body: body || {},
  };
  return handler(req, res).then(() => res);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const started = Date.now();
  const denied = await call('GET', '/api/v1/branches');
  assert(denied.statusCode === 401, 'sin API key debe fallar');

  const auth = { 'x-api-key': process.env.CLAREMM_AGENT_API_KEY };
  const branches = await call('GET', '/api/v1/branches', { headers: auth });
  assert(branches.statusCode === 200 && Array.isArray(branches.body) && branches.body.some(row => row.code === 'NUEVO_LEON'), 'lista sucursales');
  assert(branches.body.some(row => row.code === 'JUAREZ'), 'incluye JUAREZ en lectura');

  const blocked = await call('POST', '/api/v1/branches/JUAREZ/upload/preview', {
    headers: auth,
    body: { rows: [{ estilo: 'PI4031', color: 'MARINO BLANCO', talla: '24.0', cantidad: 1 }] },
  });
  assert(blocked.statusCode === 409 && blocked.body.error?.code === 'juarez_blocked', 'preview no toca JUAREZ');

  const preview = await call('POST', '/api/v1/branches/NUEVO_LEON/upload/preview', {
    headers: auth,
    body: {
      rows: [
        { estilo: 'PI4031', color: 'MARINO BLANCO', talla: '24.0', cantidad: 1 },
        { estilo: 'PI4031', color: 'MARINO BLANCO', talla: '24.0', cantidad: 1 },
        { estilo: 'PI4037', color: 'COLOR INEXISTENTE', talla: '24.0', cantidad: 1 },
      ],
    },
  });
  assert(preview.statusCode === 200, `preview NL: ${JSON.stringify(preview.body)}`);
  assert(preview.body.filas === 2, 'agrupa duplicados');
  assert(preview.body.pares === 3, 'suma pares agrupados');
  assert(preview.body.desconocidas_detalle?.some(row => /COLOR INEXISTENTE/.test(row.motivo) && /MARINO/.test(row.motivo)), 'motivo de color exacto');

  const catalog = await call('GET', '/api/v1/catalog/products?estilo=PI4031', { headers: auth });
  catalog.url = '/api/v1/catalog/products';
  const catalogDirect = await handler({
    method: 'GET',
    url: '/api/v1/catalog/products?estilo=PI4031',
    headers: auth,
    query: { path: ['catalog', 'products'], estilo: 'PI4031' },
    body: {},
  }, {
    statusCode: 200, body: null, headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  });
  assert(catalogDirect.statusCode === 200 && catalogDirect.body.products?.length >= 1, 'catálogo por estilo');

  console.log(JSON.stringify({
    ok: true,
    ms: Date.now() - started,
    branches: branches.body.map(row => row.code),
    preview: { filas: preview.body.filas, encontradas: preview.body.encontradas, desconocidas: preview.body.desconocidas, pares: preview.body.pares },
    catalog: catalogDirect.body.products.slice(0, 3).map(row => `${row.estilo} ${row.color}`),
  }, null, 2));
})().catch(error => {
  console.error(error);
  process.exit(1);
});
