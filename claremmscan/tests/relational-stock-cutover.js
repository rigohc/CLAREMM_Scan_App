'use strict';

const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const plan = require('../inventory-search.js');
const prep = require('../saz-prep-excel.js');

const style = { id: 'product', estilo: '435501', color: 'NEGRO', precio: 899, activo: true, estado: 'PENDIENTE EN SAZ' };
const branches = [
  { id: 'j', code: 'JUAREZ', name: 'CLAREMM ZAPATERIA JUAREZ', active: true },
  { id: 'n', code: 'NUEVO_LEON', name: 'Zapateria CLAREMM Nuevo Leon', active: true },
];
const variants = [
  { id: 'raw', product_id: style.id, size: '21' },
  { id: 'decimal', product_id: style.id, size: '21.0' },
  { id: 'remainder', product_id: style.id, size: '22.0' },
];
const levels = [
  { branch_id: 'j', variant_id: 'raw', quantity: 2 },
  { branch_id: 'j', variant_id: 'decimal', quantity: 1 },
  { branch_id: 'j', variant_id: 'remainder', quantity: 14 },
  { branch_id: 'n', variant_id: 'remainder', quantity: 3 },
];
const previousQueue = JSON.stringify({ upserts: { sample: { cantidad: 987 } } });
const local = { 'claremmscan-cloud-queue-v1': previousQueue };
const localStorage = new Proxy(local, { get(target, key) {
  if (key === 'getItem') return name => target[name] ?? null;
  if (key === 'setItem') return (name, value) => { target[name] = value; };
  if (key === 'removeItem') return name => { delete target[name]; };
  return target[key];
} });
const cells = new Map();
const document = {
  getElementById(id) {
    if (!cells.has(id)) cells.set(id, {});
    return cells.get(id);
  },
  dispatchEvent() {},
};

const receipts = new Map();
const attempted = [];
const client = {
  auth: {
    onAuthStateChange() {},
    async getSession() { return { data: { session: { user: { id: 'operator', email: 'operator@example.invalid' } } } }; },
  },
  from(table) {
    assert.notEqual(table, 'inventory_items', 'el escáner no puede consultar el inventario archivado');
    let select = '';
    const q = {
      select(value) { select = value; return q; },
      eq() { return q; }, in() { return q; }, gt() { return q; }, order() { return q; }, limit() { return q; },
      range() { return q; }, abortSignal() { return q; },
      then(resolve, reject) {
        const data = {
          organization_members: [{ organization_id: 'org', is_default: true }],
          organizations: [{ id: 'org', name: 'CLAREMM' }],
          branches,
          products: [{ ...style }],
          product_variants: variants,
          saz_product_registry: [{ product_id: style.id, lookup_key: '435501|NEGRO' }],
          inventory_levels: select.includes('products!inner') ? levels.map(level => ({
            ...level,
            product_variants: { size: variants.find(row => row.id === level.variant_id).size, products: style },
          })) : levels,
        }[table];
        if (!data) return Promise.reject(new Error(`Tabla inesperada: ${table}`)).then(resolve, reject);
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return q;
  },
  rpc(name, input) {
    assert.equal(name, 'claremm_increase_stock');
    attempted.push(input);
    return { async single() {
      if (!receipts.has(input.p_event_key)) {
        assert.equal(input.p_size, '21.0');
        const level = levels.find(row => row.branch_id === 'j' && row.variant_id === 'decimal');
        level.quantity += input.p_quantity;
        receipts.set(input.p_event_key, { size: input.p_size, quantity: level.quantity, variant_id: 'decimal' });
        throw new Error('se perdió la respuesta después de confirmar');
      }
      return { data: receipts.get(input.p_event_key) };
    } };
  },
};
const window = {
  ClaremmInventorySearch: plan,
  ClaremmSazPrepExcel: prep,
  ClaremmStore: { async refreshSazPrepCatalog() {} },
  location: { hash: '' },
  supabase: { createClient: () => client },
  addEventListener() {},
};
const navigator = { onLine: true };
const ctx = { window, navigator, localStorage, document, crypto: webcrypto, AbortController, URLSearchParams, setTimeout, CustomEvent: class {}, console,
  fetch: async () => ({ ok: true, json: async () => ({ url: 'https://example.invalid', publishableKey: 'test' }) }),
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../supabase-sync.js'), 'utf8'), ctx);

async function run() {
  await new Promise(resolve => setImmediate(resolve));
  const cloud = window.claremmCloud;
  const [card] = await cloud.searchRelationalInventory('435501', 'style', 'pending');
  assert.equal(card.sazStockAuditPending, true);
  assert.deepEqual(Array.from(card.branchStocks, row => row.totalQuantity), [17, 3]);
  assert.equal(card.branchStocks[0].sizes.filter(row => row.size === '21.0').length, 1);
  assert.equal(card.branchStocks[0].sizes.find(row => row.size === '21.0').quantity, 3);
  assert.equal((await cloud.searchRelationalInventory('435501', 'style', 'loaded')).length, 0);
  const rows = await cloud.listRelationalStock();
  assert.equal(rows.filter(row => row.sucursal === branches[0].name).reduce((sum, row) => sum + row.cantidad, 0), 17);
  assert.equal(rows.filter(row => row.sucursal === branches[0].name && row.talla === '21.0').length, 1);

  navigator.onLine = false;
  const saved = await cloud.recordCaptures([{ estilo: '435501', color: 'NEGRO', talla: '21', cantidad: 2, sucursal: 'JUAREZ' }]);
  assert.equal(saved.pending, 1);
  assert.equal(attempted.length, 0);
  assert.deepEqual(Object.keys(local).filter(key => key.startsWith('claremmscan-relational-captures-')).length, 1);
  navigator.onLine = true;
  await assert.rejects(cloud.syncAll(), /perdió la respuesta/);
  await cloud.syncAll();
  assert.equal(attempted.length, 2);
  assert.equal(attempted[0].p_event_key, attempted[1].p_event_key);
  assert.equal(receipts.size, 1);
  assert.equal(levels[1].quantity, 3);
  assert.equal(local['claremmscan-cloud-queue-v1'], previousQueue);
  assert.equal(Object.keys(local).filter(key => key.startsWith('claremmscan-relational-captures-')).length, 0);
  console.log(JSON.stringify({ ok: true, juarez: 17, nuevoLeon: 3, normalizedSize21: 3, retryReceipts: receipts.size }));
}

run().catch(error => { console.error(error); process.exitCode = 1; });
