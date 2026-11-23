'use strict';

const fs = require('node:fs');
const path = require('node:path');
const api = require('../api/v1.js');
const core = require('../lib/branch-upload-core.js');

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
  return api(req, res).then(() => res);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sizes(count, start = 22) {
  return Array.from({ length: count }, (_, index) => (start + index * 0.5).toFixed(1));
}

function memoryDb() {
  const products = [];
  const variants = [];
  const levels = [];
  const movements = [];
  const runs = [];
  let n = 1;
  const id = () => `00000000-0000-4000-8000-${String(n++).padStart(12, '0')}`;
  return {
    async rest(resource, opts = {}) {
      const method = opts.method || 'GET';
      if (resource.startsWith('products?on_conflict')) {
        const body = opts.body || [];
        const sourceIds = body.map(row => row.source_id);
        if (new Set(sourceIds).size !== sourceIds.length) {
          const error = new Error('ON CONFLICT DO UPDATE command cannot affect row a second time');
          error.status = 502;
          error.public = { error: { code: 'supabase_error', message: error.message, resource } };
          throw error;
        }
        return body.map(row => {
          const found = products.find(item => item.source_id === row.source_id);
          if (found) return found;
          const saved = { ...row, id: id(), created_at: new Date().toISOString() };
          products.push(saved);
          return saved;
        });
      }
      if (resource.startsWith('product_variants?on_conflict')) {
        return (opts.body || []).map(row => {
          const found = variants.find(item => item.product_id === row.product_id && item.size === row.size);
          if (found) return found;
          const saved = { ...row, id: id() };
          variants.push(saved);
          return saved;
        });
      }
      if (resource.startsWith('inventory_levels?select=quantity.sum')) return [{ sum: levels.reduce((sum, row) => sum + Number(row.quantity || 0), 0) }];
      if (resource.startsWith('inventory_levels?select=variant_id')) return levels;
      if (resource.startsWith('inventory_levels?on_conflict')) {
        for (const row of opts.body || []) {
          const found = levels.find(item => item.branch_id === row.branch_id && item.variant_id === row.variant_id);
          if (found) found.quantity = row.quantity;
          else levels.push({ ...row });
        }
        return [];
      }
      if (resource.startsWith('inventory_movements_relational?select=import_key')) return movements.map(row => ({ import_key: row.import_key }));
      if (resource.startsWith('inventory_movements_relational?on_conflict')) {
        for (const row of opts.body || []) {
          if (!movements.some(item => item.import_key === row.import_key)) movements.push(row);
        }
        return [];
      }
      if (resource.startsWith('inventory_migration_runs')) {
        if (method === 'POST') {
          runs.push({ ...opts.body, created_at: new Date().toISOString() });
          return [];
        }
        return runs.map((row, index) => ({ id: `run${index}`, ...row }));
      }
      if (resource.startsWith('products?id=eq')) return [];
      if (resource.startsWith('products?')) return products;
      return [];
    },
    async allRows(resource) {
      return this.rest(resource);
    },
  };
}

(async () => {
  const started = Date.now();
  const auth = { 'x-api-key': process.env.CLAREMM_AGENT_API_KEY };
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  const org = {
    organization: { id: 'a9017238-d45c-4e36-b4f0-17dc332aeb4c', name: 'CLAREMM' },
    branches: [{ id: '65280fc6-1519-4cb9-b437-f01478a1f171', code: 'NUEVO_LEON', name: 'Zapateria CLAREMM Nuevo Leon', active: true }],
  };
  const results = {};

  const t1Rows = sizes(8).map(talla => ({
    estilo: `ZZTESTV2-T1-${stamp}`,
    color: 'NEGRO',
    talla,
    cantidad: 1,
    marca: 'TEST V2',
    tipo: 'DAMA',
    material: 'SINTETICO',
  }));
  const t1 = await call('POST', '/api/v1/branches/NUEVO_LEON/upload/apply', {
    headers: auth,
    body: { mode: 'sum', batch_id: `t1-v2-${stamp}`, create_unknowns: true, rows: t1Rows },
  });
  assert(t1.statusCode === 200, `T1 ${t1.statusCode} ${JSON.stringify(t1.body?.error || t1.body)}`);
  assert(t1.body.tallas_procesadas === 8, `T1 tallas ${t1.body.tallas_procesadas}`);
  assert(t1.body.creados.length === 1, `T1 creados ${t1.body.creados.length}`);
  assert(t1.body.omitidas.length === 0, 'T1 omitidas');
  results.T1 = { status: t1.statusCode, ms: Date.now() - started, tallas: t1.body.tallas_procesadas, creados: t1.body.creados.length, pares: t1.body.pares_procesados };

  const t2Rows = [];
  for (let ficha = 0; ficha < 52; ficha += 1) {
    for (const talla of sizes(7)) {
      t2Rows.push({ estilo: `ZZT2-${stamp}-${ficha}`, color: 'NEGRO', talla, cantidad: 1, marca: 'TEST V2' });
    }
  }
  const t2Classified = core.classifyRows({ rows: t2Rows, products: [], createUnknowns: true });
  const t2SourceIds = core.dedupeByLookup(t2Classified.creables).map(row => core.productSourceId(`t2-${stamp}`, row.estilo, row.color));
  assert(t2Classified.filas === 364 && t2SourceIds.length === 52 && new Set(t2SourceIds).size === 52, 'T2 forma del lote 52 fichas / varias tallas');
  results.T2 = { status: 'shape-ok', filas: t2Classified.filas, fichas: t2SourceIds.length, note: 'no se reaplicó el lote real de NL para no duplicar 382 pares' };

  const t3started = Date.now();
  const t3 = { ok: 0, auth_failed: 0, err5xx: 0, other: 0, statuses: {} };
  for (let index = 0; index < 500; index += 1) {
    const t0 = Date.now();
    const response = await call('POST', '/api/v1/branches/NUEVO_LEON/upload/apply', {
      headers: auth,
      body: { mode: 'sum', batch_id: `t1-v2-${stamp}`, create_unknowns: true, rows: t1Rows.slice(0, 1) },
    });
    t3.statuses[response.statusCode] = (t3.statuses[response.statusCode] || 0) + 1;
    if (response.statusCode === 200) t3.ok += 1;
    else if (response.body?.error?.code === 'auth_failed') t3.auth_failed += 1;
    else if (response.statusCode >= 500) t3.err5xx += 1;
    else t3.other += 1;
    const wait = 500 - (Date.now() - t0);
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
  }
  assert(t3.auth_failed === 0 && t3.err5xx === 0 && t3.ok === 500, `T3 ${JSON.stringify(t3)}`);
  results.T3 = { ...t3, ms: Date.now() - t3started };

  const t4Rows = [];
  for (let ficha = 0; ficha < 125; ficha += 1) {
    for (const talla of sizes(8)) {
      t4Rows.push({ estilo: `ZZT4-${ficha}`, color: 'NEGRO', talla, cantidad: 1, marca: 'PERF', crear: true });
    }
  }
  const t4started = Date.now();
  const t4 = await api.handleApply(memoryDb(), { userId: null }, org, 'NUEVO_LEON', {
    mode: 'sum',
    batch_id: `t4-v2-${stamp}`,
    create_unknowns: true,
    rows: t4Rows,
  });
  const t4ms = Date.now() - t4started;
  assert(t4.tallas_procesadas === 1000, `T4 tallas ${t4.tallas_procesadas}`);
  assert(t4.creados.length === 125, `T4 creados ${t4.creados.length}`);
  assert(t4.omitidas.length === 0, 'T4 omitidas');
  results.T4 = { status: 200, ms: t4ms, filas: 1000, tallas: t4.tallas_procesadas, creados: t4.creados.length, note: 'apply in-memory (mismo handler); no escribe NL' };

  const t5 = await call('POST', '/api/v1/branches/NUEVO_LEON/upload/apply', {
    headers: auth,
    body: { mode: 'sum', batch_id: `t1-v2-${stamp}`, create_unknowns: true, rows: t1Rows },
  });
  assert(t5.statusCode === 200 && t5.body.idempotent === true, `T5 ${JSON.stringify(t5.body?.error || { idempotent: t5.body.idempotent })}`);
  assert(t5.body.totales_despues.pares === t1.body.totales_despues.pares, 'T5 totales iguales');
  results.T5 = { status: t5.statusCode, idempotent: t5.body.idempotent, pares: t5.body.totales_despues.pares };

  const t6rows = [{ estilo: 'DON343', color: 'NEGRO', talla: '24.0', cantidad: 1 }];
  const t6preview = await call('POST', '/api/v1/branches/NUEVO_LEON/upload/preview', { headers: auth, body: { rows: t6rows } });
  const t6apply = t6preview.body?.encontradas >= 1
    ? await call('POST', '/api/v1/branches/NUEVO_LEON/upload/apply', {
      headers: auth,
      body: { mode: 'sum', batch_id: `t6-v2-${stamp}`, rows: t6rows },
    })
    : null;
  const t6review = await call('GET', `/api/v1/review/pending?branch=NUEVO_LEON`, { headers: auth });
  const t6mismatch = (t6review.body.items || []).filter(row => row.kind === 'material_mismatch' && core.sameEstilo(row.estilo, 'DON343') && core.colorKey(row.color) === 'NEGRO' && row.batch_id === `t6-v2-${stamp}`);
  assert(t6mismatch.length === 0, 'T6 no creó material_mismatch');
  results.T6 = { status: t6apply?.statusCode || t6preview.statusCode, encontradas: t6preview.body?.encontradas, mismatch: t6mismatch.length, apply: Boolean(t6apply) };

  const t7rows = [{ estilo: 'SU6550', color: 'NEGRO', talla: '24.0', cantidad: 1, material: 'SINTETICO' }];
  const t7preview = await call('POST', '/api/v1/branches/NUEVO_LEON/upload/preview', { headers: auth, body: { rows: t7rows } });
  const t7apply = t7preview.body?.encontradas >= 1
    ? await call('POST', '/api/v1/branches/NUEVO_LEON/upload/apply', {
      headers: auth,
      body: { mode: 'sum', batch_id: `t7-v2-${stamp}`, rows: t7rows },
    })
    : null;
  const t7review = await call('GET', `/api/v1/review/pending?branch=NUEVO_LEON`, { headers: auth });
  const t7mismatch = (t7review.body.items || []).filter(row => (
    row.kind === 'material_mismatch'
    && core.sameEstilo(row.estilo, 'SU6550')
    && core.colorKey(row.color) === 'NEGRO'
    && (row.batch_id === `t7-v2-${stamp}` || row.label_material === 'SINTETICO')
  ));
  assert(t7mismatch.length >= 1, `T7 debía marcar mismatch: ${JSON.stringify(t7review.body?.error || t7apply?.body?.error || { encontradas: t7preview.body?.encontradas })}`);
  results.T7 = {
    status: t7apply?.statusCode || t7preview.statusCode,
    encontradas: t7preview.body?.encontradas,
    mismatch: t7mismatch.length,
    source: t7mismatch[0]?.label_material_source || '',
  };

  const t8 = await call('GET', '/api/v1/branches/NUEVO_LEON/summary', { headers: auth });
  assert(t8.statusCode === 200 && Number(t8.body.pares) >= 0, `T8 ${JSON.stringify(t8.body)}`);
  results.T8 = t8.body;

  console.log(JSON.stringify({ ok: true, ms: Date.now() - started, results }, null, 2));
})().catch(error => {
  console.error(error);
  process.exit(1);
});
