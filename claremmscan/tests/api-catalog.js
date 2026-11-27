'use strict';

const api = require('../api/v1.js');
const core = require('../lib/branch-upload-core.js');

const assert = (condition, message) => { if (!condition) throw new Error(message); };

const ORG = {
  organization: { id: 'a9017238-d45c-4e36-b4f0-17dc332aeb4c', name: 'CLAREMM' },
  branches: [
    { id: '61d4f1c7-db48-426d-a64e-64dfb3e3d1df', code: 'JUAREZ', name: 'CLAREMM ZAPATERIA JUAREZ', active: true },
    { id: '65280fc6-1519-4cb9-b437-f01478a1f171', code: 'NUEVO_LEON', name: 'Zapateria CLAREMM Nuevo Leon', active: true },
  ],
};

function eqValue(query, key) {
  const match = String(query || '').match(new RegExp(`(?:^|&)${key}=eq\\.([^&]+)`));
  return match ? decodeURIComponent(match[1]) : '';
}

function inValues(query, key) {
  const match = String(query || '').match(new RegExp(`(?:^|&)${key}=in\\.\\(([^)]*)\\)`));
  if (!match) return [];
  return match[1].split(',').map(value => decodeURIComponent(value)).filter(Boolean);
}

function catalogDb() {
  const products = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      organization_id: ORG.organization.id,
      estilo: 'NI2001',
      color: 'LATE',
      marca: 'NICE',
      linea: 'DAMA',
      acabado: 'PIEL',
      corrida: '21.50-27.00',
      precio: 1199,
      activo: true,
      descripcion: '',
      imagen: 'org/products/NI2001-LATE.png',
      source_system: 'saz_excel',
      created_at: '2026-11-25T00:00:00.000Z',
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      organization_id: ORG.organization.id,
      estilo: 'COM011',
      color: 'NEGRO',
      marca: 'RODRI SAN',
      linea: 'ZAPATO',
      acabado: 'SINTETICO',
      corrida: '22-26',
      precio: 880,
      activo: true,
      descripcion: '',
      imagen: '',
      source_system: 'sqlite',
      created_at: '2026-11-25T00:00:00.000Z',
    },
  ];
  const variants = [
    { id: 'v-23-5', product_id: products[0].id, size: '23.5' },
    { id: 'v-24-5', product_id: products[0].id, size: '24.5' },
  ];
  const levels = [
    { branch_id: ORG.branches[0].id, variant_id: 'v-23-5', quantity: 1 },
    { branch_id: ORG.branches[0].id, variant_id: 'v-24-5', quantity: 1 },
  ];
  const movements = [];
  const runs = [];
  let n = 10;
  const id = () => `00000000-0000-4000-8000-${String(n++).padStart(12, '0')}`;
  return {
    products,
    variants,
    levels,
    movements,
    async rest(resource, opts = {}) {
      const method = opts.method || 'GET';
      const [table, query = ''] = resource.split('?');
      if (table === 'products') {
        if (method === 'PATCH') {
          const productId = eqValue(query, 'id');
          const product = products.find(row => row.id === productId);
          if (!product) return [];
          Object.assign(product, opts.body || {});
          return [product];
        }
        const productId = eqValue(query, 'id');
        if (productId) return products.filter(row => row.id === productId);
        const estilos = inValues(query, 'estilo');
        const activeOnly = /activo=eq\.true/.test(query);
        return products.filter(row => {
          if (activeOnly && row.activo === false) return false;
          if (estilos.length && !estilos.some(estilo => core.sameEstilo(row.estilo, estilo))) return false;
          return true;
        });
      }
      if (table === 'product_variants') {
        if (method === 'POST' || resource.includes('on_conflict')) {
          return (opts.body || []).map(row => {
            const found = variants.find(item => item.product_id === row.product_id && item.size === row.size);
            if (found) return found;
            const saved = { ...row, id: id() };
            variants.push(saved);
            return saved;
          });
        }
        const productId = eqValue(query, 'product_id');
        const productIds = inValues(query, 'product_id');
        return variants.filter(row => row.product_id === productId || productIds.includes(row.product_id));
      }
      if (table === 'inventory_levels') {
        if (resource.includes('on_conflict') || method === 'POST') {
          for (const row of opts.body || []) {
            const found = levels.find(item => item.branch_id === row.branch_id && item.variant_id === row.variant_id);
            if (found) found.quantity = row.quantity;
            else levels.push({ ...row });
          }
          return [];
        }
        const branchId = eqValue(query, 'branch_id');
        const variantIds = inValues(query, 'variant_id');
        return levels.filter(row => (!branchId || row.branch_id === branchId) && (!variantIds.length || variantIds.includes(row.variant_id)));
      }
      if (table === 'inventory_movements_relational') {
        if (method === 'POST' || resource.includes('on_conflict')) {
          for (const row of opts.body || []) {
            if (!movements.some(item => item.import_key === row.import_key)) movements.push(row);
          }
          return [];
        }
        return movements.map(row => ({ import_key: row.import_key }));
      }
      if (table === 'inventory_migration_runs') {
        if (method === 'POST') {
          runs.push({ ...opts.body, created_at: new Date().toISOString() });
          return [];
        }
        return runs.map((row, index) => ({ id: `run${index}`, ...row }));
      }
      if (table === 'saz_product_registry') return [];
      return [];
    },
    async allRows(resource) {
      return this.rest(resource);
    },
  };
}

(async () => {
  const db = catalogDb();
  const session = { userId: 'agent-test' };
  const fichaId = '11111111-1111-4111-8111-111111111111';

  const fetched = await api.handleGetProduct(db, ORG, fichaId);
  assert(fetched.estilo === 'NI2001' && fetched.existencias.JUAREZ.pares === 2, 'GET ficha con existencias');

  const renamed = await api.handlePatchProduct(db, session, ORG, '', {
    estilo_actual: 'NI2001',
    color_actual: 'LATE',
    estilo: 'NI2001X',
    corrida: '21.50-27.00',
    motivo: 'El estilo venía mal escrito',
  });
  assert(renamed.estilo === 'NI2001X' && renamed.evento === 'CatalogProductUpdated', 'actualiza el estilo por identidad');
  assert(renamed.activo === true, 'sigue activa');

  const blockedPrice = await api.handlePatchProduct(db, session, ORG, fichaId, {
    precio: 999,
    motivo: 'bajar precio',
  }).then(() => null).catch(error => error);
  assert(blockedPrice?.status === 409 && blockedPrice.public.error.code === 'price_protected', 'no pisa precio > 0');

  const priced = await api.handlePatchProduct(db, session, ORG, fichaId, {
    precio: 1299,
    confirmar_precio: true,
    motivo: 'precio confirmado en piso',
  });
  assert(priced.precio === 1299, 'precio con confirmación');

  const collision = await api.handlePatchProduct(db, session, ORG, fichaId, {
    estilo: 'COM011',
    color: 'NEGRO',
    motivo: 'no debe pisar otra ficha',
  }).then(() => null).catch(error => error);
  assert(collision?.status === 409 && collision.public.error.code === 'ficha_exists', 'no duplica identidad');

  const juarezAdded = await api.handleSizes(db, session, ORG, 'JUAREZ', {
    motivo: 'faltaba la 24.0 en Juárez',
    mode: 'set',
    batch_id: 'sizes-juarez-1',
    rows: [
      { ficha_id: fichaId, talla: '24.0', cantidad: 1 },
      { ficha_id: fichaId, talla: '23.5', cantidad: 0 },
      { ficha_id: fichaId, talla: '24.5', cantidad: 2 },
    ],
  });
  assert(juarezAdded.procesadas.find(row => row.talla === '24.0')?.cantidad_despues === 1, 'JUÁREZ agrega talla nueva');
  assert(juarezAdded.procesadas.find(row => row.talla === '24.5')?.evento === 'StockIncreased', 'JUÁREZ ajusta al alza como StockIncreased');
  assert(juarezAdded.omitidas.some(row => row.talla === '23.5' && /no baja/i.test(row.motivo)), 'JUÁREZ no baja una talla que ya tiene pares');
  assert(db.movements.filter(row => row.branch_id === ORG.branches[0].id).every(row => row.operation === 'add' && row.quantity > 0), 'JUÁREZ guarda aumentos, nunca SET');

  const added = await api.handleSizes(db, session, ORG, 'NUEVO_LEON', {
    motivo: 'faltaba la 24.0 en NL',
    mode: 'set',
    batch_id: 'sizes-ni2001-1',
    rows: [
      { ficha_id: fichaId, talla: '24.0', cantidad: 1 },
      { estilo: 'NI2001X', color: 'LATE', talla: '25.0', cantidad: 2 },
    ],
  });
  assert(added.tallas_procesadas === 2, 'agrega tallas nuevas');
  assert(added.procesadas.find(row => row.talla === '24.0').cantidad_despues === 1, 'crea 24.0');
  assert(added.procesadas.find(row => row.talla === '25.0').cantidad_despues === 2, 'crea 25.0');

  const summed = await api.handleSizes(db, session, ORG, 'NUEVO_LEON', {
    motivo: 'entrada extra',
    mode: 'sum',
    batch_id: 'sizes-ni2001-2',
    rows: [{ ficha_id: fichaId, talla: '24.0', cantidad: 1 }],
  });
  assert(summed.procesadas[0].cantidad_antes === 1 && summed.procesadas[0].cantidad_despues === 2, 'suma talla existente');

  const deleted = await api.handleDeleteProduct(db, session, ORG, fichaId, { motivo: 'ese estilo ya no existe' });
  assert(deleted.activo === false && deleted.evento === 'CatalogProductDeactivated', 'baja lógica');
  assert(deleted.existencias.JUAREZ.pares === 4, 'la baja lógica conserva existencias de JUÁREZ');

  const missingMotivo = await api.handleDeleteProduct(db, session, ORG, fichaId, {}).then(() => null).catch(error => error);
  assert(missingMotivo?.status === 400 && missingMotivo.public.error.code === 'motivo_required', 'eliminar pide motivo');

  const inactiveSizes = await api.handleSizes(db, session, ORG, 'NUEVO_LEON', {
    motivo: 'ya no',
    mode: 'set',
    rows: [{ ficha_id: fichaId, talla: '24.0', cantidad: 1 }],
  }).then(() => null).catch(error => error);
  assert(inactiveSizes?.status === 400, 'no toca tallas de ficha inactiva');

  console.log(JSON.stringify({
    ok: true,
    estilo: renamed.estilo,
    precio: priced.precio,
    tallas: added.procesadas.map(row => `${row.talla}=${row.cantidad_despues}`),
    baja: deleted.activo,
    juarez_pares: deleted.existencias.JUAREZ.pares,
  }));
})().catch(error => {
  console.error(error);
  process.exit(1);
});
