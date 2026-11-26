'use strict';

const crypto = require('node:crypto');
const core = require('../lib/branch-upload-core.js');

const ORG_NAME = 'CLAREMM';
const PRODUCT_SELECT = 'id,estilo,color,marca,proveedor,temporada,sublinea,departamento,clasificacion,linea,corrida,acabado,precio,source_system,estado,imagen,descripcion,activo,created_at,organization_id';

function fail(status, code, message, extra = {}) {
  const error = new Error(message);
  error.status = status;
  error.public = { error: { code, message, ...extra } };
  return error;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (status === 429) {
    const retryAfter = body?.error?.retry_after || 2;
    res.setHeader('Retry-After', String(retryAfter));
  }
  return res.status(status).json(body);
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
}

function splitRoute(value) {
  if (value == null || value === '') return [];
  const raw = Array.isArray(value) ? value.filter(Boolean).join('/') : String(value);
  let pathname = raw.split('#')[0];
  try {
    pathname = new URL(raw, 'http://localhost').pathname;
  } catch {
    pathname = raw.split('?')[0];
  }
  const cleaned = pathname.replace(/^\/api\/v1\/?/, '').replace(/^\//, '');
  return cleaned.split('/').map(part => String(part || '').split('?')[0]).filter(Boolean);
}

function pathParts(req) {
  const headers = req.headers || {};
  const candidates = [
    req.query?.__route,
    req.query?.path,
    req.query?.['...path'],
    req.url,
    headers['x-invoke-path'],
    headers['x-forwarded-uri'],
    headers['x-vercel-original-path'],
  ];
  for (const candidate of candidates) {
    const parts = splitRoute(candidate);
    if (parts.length) return parts;
  }
  return [];
}

function queryOf(req) {
  const url = new URL(req.url || '/api/v1', 'http://localhost');
  const extra = Object.fromEntries(url.searchParams.entries());
  const query = { ...extra, ...(req.query || {}) };
  delete query.path;
  delete query.__route;
  delete query['...path'];
  return query;
}

const API_ROUTES = [
  'GET /api/v1/branches',
  'GET /api/v1/catalog/products?estilo=&color=&marca=',
  'GET /api/v1/catalog/products/{ficha_id}',
  'GET /api/v1/branches/{JUAREZ|NUEVO_LEON}/inventory?estilo=&color=&talla=',
  'POST /api/v1/branches/{branch}/upload/preview',
  'POST /api/v1/branches/{branch}/upload/apply',
  'POST /api/v1/branches/{JUAREZ|NUEVO_LEON}/sizes',
  'PATCH /api/v1/catalog/products/{ficha_id}',
  'PATCH /api/v1/catalog/products',
  'DELETE /api/v1/catalog/products/{ficha_id}',
  'GET /api/v1/branches/{branch}/history?batch_id=',
  'GET /api/v1/branches/{branch}/summary',
  'GET /api/v1/review/pending?branch=&estado=',
];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const WRITE_CHUNK = 200;
const READ_CHUNK = 80;
const sessionCache = { value: null, expiresAt: 0 };
const orgCache = { value: null, at: 0 };

function chunks(values, size = WRITE_CHUNK) {
  return Array.from({ length: Math.ceil((values || []).length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function retryAfterOf(response, fallback = 2) {
  const raw = response.headers?.get?.('retry-after');
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function agentAuth(req) {
  const expected = process.env.CLAREMM_AGENT_API_KEY || '';
  if (!expected) throw fail(503, 'api_key_not_configured', 'Falta CLAREMM_AGENT_API_KEY en el servidor.');
  const provided = req.headers['x-api-key'] || req.headers['X-API-Key'];
  if (!safeEqual(provided, expected)) throw fail(401, 'unauthorized', 'API key inválida o ausente.');
}

async function passwordGrant(url, apiKey, email, password) {
  const authResponse = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const raw = await authResponse.text();
  let auth = null;
  try { auth = raw ? JSON.parse(raw) : null; } catch { auth = null; }
  if (authResponse.status === 429) {
    throw fail(429, 'rate_limited', 'Supabase limitó la autenticación. Reintenta.', { retry_after: retryAfterOf(authResponse) });
  }
  if (authResponse.status >= 500) {
    throw fail(503, 'auth_unavailable', 'Supabase no pudo emitir el token. Reintenta.', { retry_after: 2 });
  }
  if (!authResponse.ok || !auth?.access_token) {
    throw fail(503, 'auth_failed', 'No se pudo autenticar el agente contra Supabase.');
  }
  return auth;
}

async function supabaseSession({ force = false } = {}) {
  const now = Date.now();
  if (!force && sessionCache.value && now < sessionCache.expiresAt) return sessionCache.value;
  const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const publishable = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || (!serviceRole && !publishable)) throw fail(503, 'supabase_not_configured', 'Faltan credenciales de Supabase.');
  if (serviceRole) {
    const session = { url, apiKey: serviceRole, token: serviceRole, userId: null, service: true };
    sessionCache.value = session;
    sessionCache.expiresAt = now + 24 * 60 * 60 * 1000;
    return session;
  }
  const email = String(process.env.SUPABASE_MIGRATION_EMAIL || '').trim();
  const password = String(process.env.SUPABASE_MIGRATION_PASSWORD || '').trim();
  if (!email || !password) throw fail(503, 'supabase_not_configured', 'Falta usuario de servicio de Supabase.');
  const auth = await passwordGrant(url, publishable, email, password);
  const expiresIn = Number(auth.expires_in || 3600);
  const session = { url, apiKey: publishable, token: auth.access_token, userId: auth.user?.id || null, service: false };
  sessionCache.value = session;
  sessionCache.expiresAt = now + Math.max(30_000, (expiresIn - 120) * 1000);
  return session;
}

function restClient(session) {
  async function rest(resource, { method = 'GET', body, prefer = '', attempt = 0 } = {}) {
    const response = await fetch(`${session.url}/rest/v1/${resource}`, {
      method,
      headers: {
        apikey: session.apiKey,
        Authorization: `Bearer ${session.token}`,
        'Content-Type': 'application/json',
        ...(prefer ? { Prefer: prefer } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 401 && !session.service && attempt === 0) {
      sessionCache.value = null;
      sessionCache.expiresAt = 0;
      const refreshed = await supabaseSession({ force: true });
      session.token = refreshed.token;
      session.userId = refreshed.userId;
      return rest(resource, { method, body, prefer, attempt: 1 });
    }
    if ((response.status === 429 || response.status === 503) && attempt < 2) {
      const wait = retryAfterOf(response, response.status === 429 ? 2 : 1);
      if (attempt === 0 && wait <= 3) {
        await sleep(wait * 1000);
        return rest(resource, { method, body, prefer, attempt: attempt + 1 });
      }
      throw fail(response.status === 429 ? 429 : 503, response.status === 429 ? 'rate_limited' : 'supabase_unavailable', 'Supabase rechazó la petición por carga. Reintenta.', {
        retry_after: wait,
        resource,
      });
    }
    const raw = await response.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = { message: raw }; }
    if (!response.ok) throw fail(502, 'supabase_error', data?.message || data?.details || raw || response.status, { resource });
    return data;
  }
  async function allRows(resource, pageSize = 1000) {
    const result = [];
    for (let offset = 0; ; offset += pageSize) {
      const separator = resource.includes('?') ? '&' : '?';
      const rows = await rest(`${resource}${separator}limit=${pageSize}&offset=${offset}`);
      result.push(...(rows || []));
      if (!rows || rows.length < pageSize) return result;
    }
  }
  return { rest, allRows };
}

async function loadOrg(db) {
  if (orgCache.value && Date.now() - orgCache.at < 60_000) return orgCache.value;
  const organizations = await db.allRows('organizations?select=id,name');
  const organization = organizations.find(row => core.normalize(row.name) === ORG_NAME) || organizations[0];
  if (!organization) throw fail(500, 'org_missing', 'No se encontró la organización CLAREMM.');
  const branches = await db.allRows(`branches?select=id,code,name,active&organization_id=eq.${organization.id}`);
  orgCache.value = { organization, branches: branches.filter(row => row.active !== false) };
  orgCache.at = Date.now();
  return orgCache.value;
}

function findBranch(branches, code) {
  const wanted = core.normalize(code).replace(/ /g, '_');
  const branch = branches.find(row => core.normalize(row.code).replace(/ /g, '_') === wanted)
    || branches.find(row => core.normalize(row.name).replace(/ /g, '_') === wanted);
  if (!branch) throw fail(404, 'branch_not_found', `No existe la sucursal ${code}.`, { branch: code });
  return branch;
}

function sazEstado(product, registryIds) {
  if (/PENDIENTE DE SAZ/i.test(String(product.estado || ''))) return 'Pendiente de SAZ';
  if (registryIds.has(product.id) || /CARGADO EN SAZ|REGISTRADO EN SAZ/i.test(String(product.estado || ''))) return 'En SAZ';
  if (/PRECARGADO EN SAZ/i.test(String(product.estado || '')) || product.source_system === 'saz_precargado') return 'En SAZ';
  return 'Pendiente de SAZ';
}

async function productsForEstilos(db, organizationId, estilos, { includeInactive = false } = {}) {
  const values = [...new Set((estilos || []).flatMap(core.estiloKeys))];
  const products = [];
  const activeFilter = includeInactive ? '' : '&activo=eq.true';
  const groups = chunks(values, READ_CHUNK).filter(group => group.length);
  for (let index = 0; index < groups.length; index += 3) {
    const batch = await Promise.all(groups.slice(index, index + 3).map(group => (
      db.allRows(`products?select=${PRODUCT_SELECT}&organization_id=eq.${organizationId}${activeFilter}&estilo=in.(${group.map(encodeURIComponent).join(',')})`)
    )));
    for (const rows of batch) products.push(...rows);
  }
  const unique = new Map();
  for (const product of products) unique.set(product.id, product);
  return [...unique.values()];
}

async function registryIdsFor(db, organizationId, productIds) {
  const ids = new Set();
  for (const group of chunks(productIds, 80)) {
    if (!group.length) continue;
    const rows = await db.allRows(`saz_product_registry?select=product_id&organization_id=eq.${organizationId}&product_id=in.(${group.join(',')})`);
    for (const row of rows) ids.add(row.product_id);
  }
  return ids;
}

async function branchPairTotal(db, branchId) {
  try {
    const rows = await db.rest(`inventory_levels?select=quantity.sum()&branch_id=eq.${branchId}`);
    const row = rows?.[0] || {};
    const sum = row.sum ?? row.quantity;
    if (sum != null && sum !== '') return Number(sum) || 0;
  } catch {
    // PostgREST sin agregado: suma en memoria.
  }
  const rows = await db.allRows(`inventory_levels?select=quantity&branch_id=eq.${branchId}`);
  return rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
}

async function findBatch(db, organizationId, branchId, batchId) {
  const encoded = encodeURIComponent(batchId);
  try {
    const rows = await db.rest(`inventory_migration_runs?select=id,source_summary,created_at,pair_count,variant_count,product_count&organization_id=eq.${organizationId}&branch_id=eq.${branchId}&source_summary->>batch_id=eq.${encoded}&order=created_at.desc&limit=5`);
    return (rows || []).find(row => String(row.source_summary?.batch_id || '') === String(batchId)) || null;
  } catch {
    const rows = await db.rest(`inventory_migration_runs?select=id,source_summary,created_at,pair_count,variant_count,product_count&organization_id=eq.${organizationId}&branch_id=eq.${branchId}&order=created_at.desc&limit=80`);
    return (rows || []).find(row => String(row.source_summary?.batch_id || '') === String(batchId)) || null;
  }
}

function catalogDto(product, registryIds, extra = {}) {
  return {
    ficha_id: product.id,
    estilo: product.estilo,
    color: product.color,
    marca: product.marca || '',
    tipo: product.linea || '',
    material: product.acabado || '',
    precio: Number(product.precio || 0),
    corrida: product.corrida || '',
    proveedor: product.proveedor || '',
    temporada: product.temporada || '',
    sublinea: product.sublinea || '',
    departamento: product.departamento || '',
    clasificacion: product.clasificacion || '',
    activo: product.activo !== false,
    estado_saz: sazEstado(product, registryIds),
    created_at: product.created_at,
    ...extra,
  };
}

function requireMotivo(body, query) {
  const motivo = core.text(body?.motivo || query?.motivo);
  if (!motivo) throw fail(400, 'motivo_required', 'Indica el motivo de la corrección.');
  return motivo;
}

function parseFichaId(value) {
  const id = core.text(value);
  if (!id) return '';
  if (!UUID_RE.test(id)) throw fail(400, 'ficha_invalid', 'ficha_id debe ser el UUID de la ficha.');
  return id;
}

async function loadProductById(db, org, fichaId) {
  const id = parseFichaId(fichaId);
  const products = await db.rest(`products?select=${PRODUCT_SELECT}&id=eq.${id}&organization_id=eq.${org.organization.id}`);
  const product = products?.[0];
  if (!product) throw fail(404, 'ficha_not_found', 'No existe esa ficha.', { ficha_id: id });
  return product;
}

async function loadProductByIdentity(db, org, estilo, color, { includeInactive = false } = {}) {
  if (!core.text(estilo) || !core.text(color)) {
    throw fail(400, 'identity_required', 'Indica ficha_id o estilo + color.');
  }
  const wanted = core.colorKey(color);
  const products = (await productsForEstilos(db, org.organization.id, [estilo], { includeInactive }))
    .filter(product => core.sameEstilo(product.estilo, estilo) && core.colorKey(product.color) === wanted);
  if (!products.length) throw fail(404, 'ficha_not_found', `No existe ${core.padEstilo(estilo)} · ${wanted}.`);
  if (products.length > 1) {
    throw fail(409, 'ambiguous_ficha', 'Hay más de una ficha con ese estilo y color. Usa ficha_id.', {
      fichas: products.map(product => ({ ficha_id: product.id, estilo: product.estilo, color: product.color, corrida: product.corrida || '' })),
    });
  }
  return products[0];
}

async function resolveCatalogProduct(db, org, { fichaId, body = {}, query = {}, includeInactive = false } = {}) {
  const id = core.text(fichaId || body.ficha_id || query.ficha_id);
  if (id) return loadProductById(db, org, id);
  const estilo = body.estilo_actual || query.estilo || body.estilo;
  const color = body.color_actual || query.color || body.color;
  return loadProductByIdentity(db, org, estilo, color, { includeInactive });
}

async function productStockSnapshot(db, org, productId) {
  const variants = await db.allRows(`product_variants?select=id,size&product_id=eq.${productId}`);
  const ids = variants.map(row => row.id).filter(Boolean);
  const byVariant = new Map(variants.map(row => [row.id, core.sizeKey(row.size) || String(row.size || '')]));
  const existencias = {};
  for (const branch of org.branches) {
    const code = core.normalize(branch.code).replace(/ /g, '_');
    const tallas = {};
    let pares = 0;
    if (ids.length) {
      const levels = await db.rest(`inventory_levels?select=variant_id,quantity&branch_id=eq.${branch.id}&variant_id=in.(${ids.join(',')})`);
      for (const level of levels || []) {
        const qty = Math.trunc(Number(level.quantity || 0));
        if (qty <= 0) continue;
        const size = byVariant.get(level.variant_id);
        if (!size) continue;
        tallas[size] = (tallas[size] || 0) + qty;
        pares += qty;
      }
    }
    existencias[code] = { pares, tallas };
  }
  return existencias;
}

async function auditRun(db, session, org, summary, counts = {}) {
  await db.rest('inventory_migration_runs', {
    method: 'POST',
    body: {
      organization_id: org.organization.id,
      branch_id: summary.branch_id || org.branches[0]?.id,
      source_summary: { api: 'v1', actor: 'agent', ...summary },
      product_count: counts.product_count || 0,
      variant_count: counts.variant_count || 0,
      pair_count: counts.pair_count || 0,
      created_by: session.userId,
    },
    prefer: 'return=minimal',
  });
}

async function handleBranches(db, org) {
  return org.branches.map(row => ({ id: row.id, code: row.code, name: row.name }));
}

async function handleCatalog(db, org, query) {
  const estilo = core.text(query.estilo);
  const color = core.text(query.color);
  const marca = core.text(query.marca);
  if (!estilo && !color && !marca) throw fail(400, 'query_required', 'Indica estilo, color o marca.');
  let products = [];
  if (estilo) products = await productsForEstilos(db, org.organization.id, [estilo]);
  else {
    const filter = color
      ? `color=ilike.*${encodeURIComponent(core.colorKey(color))}*`
      : `marca=ilike.*${encodeURIComponent(marca)}*`;
    products = await db.allRows(`products?select=${PRODUCT_SELECT}&organization_id=eq.${org.organization.id}&activo=eq.true&${filter}`);
  }
  products = products.filter(product => {
    if (estilo && !core.sameEstilo(product.estilo, estilo)) return false;
    if (color && core.colorKey(product.color) !== core.colorKey(color)) return false;
    if (marca && !core.normalize(product.marca).includes(core.normalize(marca))) return false;
    return true;
  });
  const registry = await registryIdsFor(db, org.organization.id, products.map(product => product.id));
  return { products: products.map(product => catalogDto(product, registry)) };
}

async function handleInventory(db, org, branchCode, query) {
  const branch = findBranch(org.branches, branchCode);
  const products = await productsForEstilos(db, org.organization.id, query.estilo ? [query.estilo] : []);
  const wantedColor = query.color ? core.colorKey(query.color) : '';
  const wantedSize = query.talla ? core.sizeKey(query.talla) : '';
  const filtered = (query.estilo || query.color)
    ? products.filter(product => (!query.estilo || core.sameEstilo(product.estilo, query.estilo)) && (!wantedColor || core.colorKey(product.color) === wantedColor))
    : [];
  if (!query.estilo && !query.color) throw fail(400, 'query_required', 'Filtra inventario por estilo o color para no descargar la sucursal completa.');
  const variants = [];
  for (const group of chunks(filtered.map(product => product.id), 80)) {
    if (!group.length) continue;
    variants.push(...await db.allRows(`product_variants?select=id,product_id,size&product_id=in.(${group.join(',')})`));
  }
  const levels = [];
  for (const group of chunks(variants.map(row => row.id), 200)) {
    if (!group.length) continue;
    levels.push(...await db.rest(`inventory_levels?select=variant_id,quantity&branch_id=eq.${branch.id}&variant_id=in.(${group.join(',')})`));
  }
  const productById = new Map(filtered.map(product => [product.id, product]));
  const quantityByVariant = new Map(levels.map(row => [row.variant_id, Number(row.quantity || 0)]));
  const rows = [];
  for (const variant of variants) {
    const product = productById.get(variant.product_id);
    if (!product) continue;
    if (wantedSize && core.sizeKey(variant.size) !== wantedSize) continue;
    const cantidad = quantityByVariant.get(variant.id) || 0;
    if (cantidad <= 0 && wantedSize) continue;
    rows.push({ estilo: product.estilo, color: product.color, talla: core.sizeKey(variant.size) || String(variant.size), cantidad, ficha_id: product.id });
  }
  return { branch: { id: branch.id, code: branch.code, name: branch.name }, rows };
}

function requireMode(mode) {
  const value = core.normalize(mode);
  if (value === 'SET' || value === 'SUM' || value === 'ADD') return value === 'SET' ? 'set' : 'sum';
  throw fail(400, 'mode_required', 'El modo es obligatorio y debe ser "set" o "sum".');
}

async function handlePreview(db, org, branchCode, body) {
  const branch = findBranch(org.branches, branchCode);
  if (core.blockedBranch(branch.code)) throw fail(409, 'juarez_blocked', 'La carga por API no toca JUÁREZ. Usa NUEVO_LEON.', { branch: branch.code });
  const classified = core.classifyRows({
    rows: body?.rows || [],
    products: await productsForEstilos(db, org.organization.id, (body?.rows || []).map(row => row.estilo)),
    productExtras: body?.products || [],
    createUnknowns: Boolean(body?.create_unknowns),
  });
  return { branch: { id: branch.id, code: branch.code, name: branch.name }, ...core.buildPreview(classified) };
}

async function upsertVariants(db, rows) {
  const variantIds = new Map();
  const seen = new Set();
  const payload = [];
  for (const row of rows) {
    const key = `${row.product.id}|${row.talla}`;
    if (seen.has(key)) continue;
    seen.add(key);
    payload.push({ product_id: row.product.id, size: row.talla });
  }
  for (const group of chunks(payload, WRITE_CHUNK)) {
    if (!group.length) continue;
    const saved = await db.rest('product_variants?on_conflict=product_id%2Csize', {
      method: 'POST',
      body: group,
      prefer: 'resolution=merge-duplicates,return=representation',
    });
    for (const variant of saved || []) variantIds.set(`${variant.product_id}|${core.sizeKey(variant.size)}`, variant.id);
  }
  return variantIds;
}

async function postChunks(db, resource, payload, prefer) {
  for (const group of chunks(payload, WRITE_CHUNK)) {
    if (!group.length) continue;
    await db.rest(resource, { method: 'POST', body: group, prefer });
  }
}

async function handleApply(db, session, org, branchCode, body) {
  const branch = findBranch(org.branches, branchCode);
  if (core.blockedBranch(branch.code)) throw fail(409, 'juarez_blocked', 'La carga por API no toca JUÁREZ ni el inventario local. Solo NUEVO_LEON.', { branch: branch.code });
  const mode = requireMode(body?.mode);
  const batchId = core.text(body?.batch_id);
  if (!batchId) throw fail(400, 'batch_required', 'batch_id es obligatorio para no duplicar pares.');
  if (!/^[A-Za-z0-9._:-]{3,80}$/.test(batchId)) throw fail(400, 'batch_invalid', 'batch_id solo admite letras, números, punto, guion y dos puntos.');
  const createUnknowns = Boolean(body?.create_unknowns);
  const rows = body?.rows || [];
  const productsInput = body?.products || [];
  const existing = await findBatch(db, org.organization.id, branch.id, batchId);
  if (existing?.source_summary?.result) {
    return { ...existing.source_summary.result, idempotent: true, batch_id: batchId, mode };
  }
  const [catalogSeed, totalesAntes] = await Promise.all([
    productsForEstilos(db, org.organization.id, [...rows, ...productsInput].map(row => row.estilo)),
    branchPairTotal(db, branch.id),
  ]);
  let catalog = catalogSeed;
  let classified = core.classifyRows({ rows, products: catalog, productExtras: productsInput, createUnknowns });
  const created = [];
  const omitidas = [...classified.omitidas];
  const createPayload = [];
  const createMeta = [];
  for (const row of core.dedupeByLookup(classified.creables)) {
    const siblings = row.siblings || [];
    const template = siblings[0] || {};
    const price = core.inheritPrice({ estilo: row.estilo, size: row.talla, products: siblings, explicitPrice: row.precio });
    const tipo = core.inferTipo({ tipo: row.tipo, size: row.talla, siblings });
    const material = core.resolveMaterial({
      labelMaterial: row.material,
      existingAcabado: '',
      labelSource: row.material_source,
    });
    const review = {
      status: 'pendiente',
      kind: 'created',
      precio_origen: price.precio_origen,
      tipo_inferido: tipo.tipo_inferido,
      batch_id: batchId,
      branch_code: branch.code,
      label_material: material.label,
      label_material_source: material.label_source,
    };
    createPayload.push({
      organization_id: org.organization.id,
      source_system: 'branch_import',
      source_id: core.productSourceId(batchId, row.estilo, row.color),
      match_key: [row.estilo, row.color, row.marca || template.marca].map(core.normalize).join('|'),
      estilo: /^\d+$/.test(core.compactEstilo(row.estilo)) ? core.padEstilo(row.estilo) : core.normalize(row.estilo),
      color: core.colorKey(row.color),
      precio: price.precio,
      marca: core.text(row.marca) || core.text(template.marca),
      proveedor: core.text(template.proveedor),
      temporada: core.text(template.temporada) || 'CLAREMM 26',
      sublinea: core.text(template.sublinea),
      departamento: core.text(template.departamento) || 'CALZADO',
      clasificacion: core.text(template.clasificacion),
      linea: tipo.linea,
      corrida: core.text(template.corrida),
      acabado: material.material,
      activo: true,
      imagen: '',
      estado: '',
      descripcion: core.writeReview('', review),
    });
    createMeta.push({ row, price, tipo, material, review });
  }
  const sourceIds = createPayload.map(row => row.source_id);
  if (new Set(sourceIds).size !== sourceIds.length) {
    throw fail(500, 'duplicate_product_upsert', 'No se puede upsertar la misma ficha dos veces en una llamada.');
  }
  for (const group of chunks(createPayload, WRITE_CHUNK)) {
    if (!group.length) continue;
    const saved = await db.rest('products?on_conflict=organization_id%2Csource_system%2Csource_id', {
      method: 'POST',
      body: group,
      prefer: 'resolution=merge-duplicates,return=representation',
    });
    catalog = catalog.concat(saved || []);
    for (const product of saved || []) {
      const meta = createMeta.find(item => core.lookupKey(item.row.estilo, item.row.color) === core.lookupKey(product.estilo, product.color));
      created.push({
        ficha_id: product.id,
        estilo: product.estilo,
        color: product.color,
        tallas: [],
        tipo: product.linea,
        tipo_inferido: Boolean(meta?.tipo.tipo_inferido),
        precio: Number(product.precio || 0),
        precio_origen: meta?.price.precio_origen || 'cero',
        material: product.acabado,
      });
    }
  }
  classified = core.classifyRows({ rows, products: catalog, productExtras: productsInput, createUnknowns });
  for (const row of classified.desconocidas.filter(item => !item.willCreate)) {
    omitidas.push({ row: row.source_rows?.[0], estilo: row.estilo, color: row.color, talla: row.talla, cantidad: row.cantidad, motivo: row.motivo });
  }
  const stockRows = classified.encontradas;
  const variantIds = await upsertVariants(db, stockRows);
  const variantIdList = [...new Set([...variantIds.values()])];
  const currentByVariant = new Map();
  const appliedKeys = new Set();
  await Promise.all([
    (async () => {
      for (const group of chunks(variantIdList, 200)) {
        if (!group.length) continue;
        const levels = await db.rest(`inventory_levels?select=variant_id,quantity&branch_id=eq.${branch.id}&variant_id=in.(${group.join(',')})`);
        for (const row of levels || []) currentByVariant.set(row.variant_id, Number(row.quantity || 0));
      }
    })(),
    (async () => {
      const keys = await db.allRows(`inventory_movements_relational?select=import_key&import_key=like.${encodeURIComponent(`api-v1:${batchId}:`)}*`);
      for (const row of keys) appliedKeys.add(row.import_key);
    })(),
  ]);
  const levelsPayload = [];
  const movementPayload = [];
  const procesadas = [];
  const reviewPatches = [];
  const patchedProducts = new Set();
  for (const row of stockRows) {
    const variantId = variantIds.get(`${row.product.id}|${row.talla}`);
    if (!variantId) {
      omitidas.push({ estilo: row.estilo, color: row.color, talla: row.talla, cantidad: row.cantidad, motivo: 'No se pudo preparar la talla.' });
      continue;
    }
    const importKey = `api-v1:${batchId}:${row.product.id}:${row.talla}`;
    const previous = currentByVariant.get(variantId) || 0;
    if (appliedKeys.has(importKey)) {
      procesadas.push({ estilo: row.estilo, color: row.color, talla: row.talla, cantidad: row.cantidad, ficha_id: row.product.id, cantidad_antes: previous, cantidad_despues: previous, idempotent: true });
      continue;
    }
    const next = mode === 'sum' ? previous + row.cantidad : row.cantidad;
    levelsPayload.push({ branch_id: branch.id, variant_id: variantId, quantity: next, updated_by: session.userId });
    movementPayload.push({
      organization_id: org.organization.id,
      branch_id: branch.id,
      variant_id: variantId,
      operation: mode === 'sum' ? 'add' : 'set',
      previous_quantity: previous,
      quantity: row.cantidad,
      new_quantity: next,
      reason: `API carga sucursal · ${batchId} · ${mode}`,
      import_key: importKey,
      created_by: session.userId,
    });
    procesadas.push({ estilo: row.estilo, color: row.color, talla: row.talla, cantidad: row.cantidad, ficha_id: row.product.id, cantidad_antes: previous, cantidad_despues: next });
    const createdRow = created.find(item => item.ficha_id === row.product.id);
    if (createdRow && !createdRow.tallas.includes(row.talla)) createdRow.tallas.push(row.talla);
    const material = core.resolveMaterial({
      labelMaterial: row.material,
      existingAcabado: row.product.acabado,
      labelSource: row.material_source,
    });
    if (material.mismatch && !patchedProducts.has(row.product.id)) {
      patchedProducts.add(row.product.id);
      reviewPatches.push({
        id: row.product.id,
        descripcion: core.writeReview(row.product.descripcion, {
          status: 'pendiente',
          kind: 'material_mismatch',
          batch_id: batchId,
          branch_code: branch.code,
          label_material: material.label,
          label_material_source: material.label_source,
          catalog_material: row.product.acabado,
        }),
      });
    }
  }
  await postChunks(db, 'inventory_movements_relational?on_conflict=import_key', movementPayload, 'resolution=merge-duplicates,return=minimal');
  await postChunks(db, 'inventory_levels?on_conflict=branch_id%2Cvariant_id', levelsPayload, 'resolution=merge-duplicates,return=minimal');
  for (const group of chunks(reviewPatches, 8)) {
    await Promise.all(group.map(patch => db.rest(`products?id=eq.${patch.id}&organization_id=eq.${org.organization.id}`, {
      method: 'PATCH',
      body: { descripcion: patch.descripcion },
      prefer: 'return=minimal',
    })));
  }
  const paresProcesados = procesadas.reduce((sum, row) => sum + Number(row.cantidad || 0), 0);
  const totalesDespues = await branchPairTotal(db, branch.id);
  const result = {
    batch_id: batchId,
    mode,
    branch: { id: branch.id, code: branch.code, name: branch.name },
    tallas_procesadas: procesadas.length,
    pares_procesados: paresProcesados,
    procesadas,
    creados: created,
    omitidas,
    totales_antes: { sucursal: branch.code, pares: totalesAntes },
    totales_despues: { sucursal: branch.code, pares: totalesDespues },
    filas_entrada: rows.length,
    filas_agrupadas: classified.filas,
    reconstruccion: {
      entrada: rows.length,
      agrupadas: classified.filas,
      procesadas: procesadas.length,
      creados: created.length,
      omitidas: omitidas.length,
      cuadran: classified.filas === procesadas.length + omitidas.filter(row => row.talla || row.motivo).length - omitidas.filter(row => !row.talla && !row.estilo).length,
    },
  };
  await db.rest('inventory_migration_runs', {
    method: 'POST',
    body: {
      organization_id: org.organization.id,
      branch_id: branch.id,
      source_summary: {
        batch_id: batchId,
        mode,
        api: 'v1',
        key: 'agent',
        result,
      },
      product_count: created.length,
      variant_count: procesadas.length,
      pair_count: paresProcesados,
      created_by: session.userId,
    },
    prefer: 'return=minimal',
  });
  return result;
}

async function handleGetProduct(db, org, fichaId) {
  const product = await loadProductById(db, org, fichaId);
  const registry = await registryIdsFor(db, org.organization.id, [product.id]);
  const existencias = await productStockSnapshot(db, org, product.id);
  return catalogDto(product, registry, { existencias });
}

async function handlePatchProduct(db, session, org, fichaId, body, query = {}) {
  const product = await resolveCatalogProduct(db, org, { fichaId, body, query, includeInactive: true });
  const motivo = requireMotivo(body, query);
  const planned = core.catalogPatchFromBody(product, body);
  if (planned.empty) throw fail(400, 'empty_patch', 'No hay campos para corregir.');
  if (planned.priceProtected) {
    throw fail(409, 'price_protected', 'El precio mayor a 0 no se pisa sin confirmar_precio: true.', {
      precio_actual: Number(product.precio || 0),
      precio_nuevo: planned.patch.precio,
    });
  }
  if (!core.text(planned.nextEstilo) || !core.text(planned.nextColor)) {
    throw fail(400, 'identity_required', 'Estilo y color no pueden quedar vacíos.');
  }
  if (planned.identityChanged) {
    const collisions = (await productsForEstilos(db, org.organization.id, [planned.nextEstilo]))
      .filter(row => row.id !== product.id && core.lookupKey(row.estilo, row.color) === core.lookupKey(planned.nextEstilo, planned.nextColor));
    if (collisions.length) {
      throw fail(409, 'ficha_exists', `Ya existe ${planned.nextEstilo} · ${planned.nextColor}. Únela o usa esa ficha.`, {
        ficha_id: collisions[0].id,
      });
    }
  }
  const review = core.parseReview(product.descripcion).review || {};
  const patch = {
    ...planned.patch,
    descripcion: core.writeReview(product.descripcion, {
      ...review,
      status: 'revisado',
      reviewed_at: new Date().toISOString(),
      motivo,
      kind: planned.identityChanged ? 'estilo_actualizado' : 'catalog_patch',
    }),
  };
  const saved = await db.rest(`products?id=eq.${product.id}&organization_id=eq.${org.organization.id}`, {
    method: 'PATCH',
    body: patch,
    prefer: 'return=representation',
  });
  const updated = saved?.[0] || (await db.rest(`products?select=${PRODUCT_SELECT}&id=eq.${product.id}`))[0];
  await auditRun(db, session, org, {
    kind: 'catalog_patch',
    evento: 'CatalogProductUpdated',
    ficha_id: product.id,
    patch: planned.patch,
    motivo,
  }, { product_count: 1 });
  const registry = await registryIdsFor(db, org.organization.id, [updated.id]);
  return catalogDto(updated, registry, {
    evento: 'CatalogProductUpdated',
    cambios: planned.patch,
    motivo,
  });
}

async function handleDeleteProduct(db, session, org, fichaId, body, query = {}) {
  const product = await resolveCatalogProduct(db, org, { fichaId, body, query, includeInactive: true });
  const motivo = requireMotivo(body, query);
  const existencias = await productStockSnapshot(db, org, product.id);
  if (product.activo === false) {
    const registry = await registryIdsFor(db, org.organization.id, [product.id]);
    return catalogDto(product, registry, {
      evento: 'CatalogProductDeactivated',
      already_inactive: true,
      motivo,
      existencias,
    });
  }
  const review = core.parseReview(product.descripcion).review || {};
  const patch = {
    activo: false,
    descripcion: core.writeReview(product.descripcion, {
      ...review,
      status: 'baja',
      reviewed_at: new Date().toISOString(),
      motivo,
      kind: 'catalog_deactivate',
    }),
  };
  const saved = await db.rest(`products?id=eq.${product.id}&organization_id=eq.${org.organization.id}`, {
    method: 'PATCH',
    body: patch,
    prefer: 'return=representation',
  });
  const updated = saved?.[0] || { ...product, activo: false };
  await auditRun(db, session, org, {
    kind: 'catalog_delete',
    evento: 'CatalogProductDeactivated',
    ficha_id: product.id,
    estilo: product.estilo,
    color: product.color,
    motivo,
    existencias,
  }, { product_count: 1 });
  const registry = await registryIdsFor(db, org.organization.id, [updated.id]);
  return catalogDto(updated, registry, {
    evento: 'CatalogProductDeactivated',
    motivo,
    existencias,
    aviso: 'Baja lógica: la ficha queda inactiva. Las existencias de JUÁREZ no se bajan.',
  });
}

async function handleSizes(db, session, org, branchCode, body) {
  const branch = findBranch(org.branches, branchCode);
  const juarez = core.blockedBranch(branch.code);
  const motivo = requireMotivo(body, {});
  const mode = requireMode(body?.mode);
  const batchId = core.text(body?.batch_id) || `sizes:${Date.now()}`;
  if (!/^[A-Za-z0-9._:-]{3,80}$/.test(batchId)) throw fail(400, 'batch_invalid', 'batch_id solo admite letras, números, punto, guion y dos puntos.');
  const grouped = core.groupSizeRows(body?.rows || []);
  if (!grouped.rows.length && grouped.invalid.length) {
    throw fail(400, 'rows_invalid', 'No hay tallas válidas para aplicar.', { omitidas: grouped.invalid });
  }
  const omitidas = [...grouped.invalid];
  const resolved = [];
  for (const row of grouped.rows) {
    try {
      const product = await resolveCatalogProduct(db, org, {
        fichaId: row.ficha_id,
        body: { estilo: row.estilo, color: row.color },
      });
      if (product.activo === false) {
        omitidas.push({ ...row, motivo: 'La ficha está inactiva. Reactívala antes de tocar tallas.' });
        continue;
      }
      if (mode === 'sum' && row.cantidad < 1) {
        omitidas.push({ ...row, motivo: 'En modo sum la cantidad debe ser al menos 1.' });
        continue;
      }
      resolved.push({ ...row, product, estilo: product.estilo, color: product.color });
    } catch (error) {
      omitidas.push({ ...row, motivo: error.public?.error?.message || error.message });
    }
  }
  if (!resolved.length) {
    throw fail(400, 'rows_invalid', 'Ninguna talla pudo aplicarse.', { omitidas });
  }
  const existing = await findBatch(db, org.organization.id, branch.id, batchId);
  if (existing?.source_summary?.result && existing.source_summary?.kind === 'sizes') {
    return { ...existing.source_summary.result, idempotent: true, batch_id: batchId, mode };
  }
  const variantIds = await upsertVariants(db, resolved);
  const variantIdList = [...new Set([...variantIds.values()])];
  const currentByVariant = new Map();
  const appliedKeys = new Set();
  await Promise.all([
    (async () => {
      for (const group of chunks(variantIdList, 200)) {
        if (!group.length) continue;
        const levels = await db.rest(`inventory_levels?select=variant_id,quantity&branch_id=eq.${branch.id}&variant_id=in.(${group.join(',')})`);
        for (const row of levels || []) currentByVariant.set(row.variant_id, Number(row.quantity || 0));
      }
    })(),
    (async () => {
      const keys = await db.allRows(`inventory_movements_relational?select=import_key&import_key=like.${encodeURIComponent(`api-v1:${batchId}:`)}*`);
      for (const row of keys) appliedKeys.add(row.import_key);
    })(),
  ]);
  const levelsPayload = [];
  const movementPayload = [];
  const procesadas = [];
  for (const row of resolved) {
    const variantId = variantIds.get(`${row.product.id}|${row.talla}`);
    if (!variantId) {
      omitidas.push({ estilo: row.estilo, color: row.color, talla: row.talla, cantidad: row.cantidad, motivo: 'No se pudo preparar la talla.' });
      continue;
    }
    const importKey = `api-v1:${batchId}:${row.product.id}:${row.talla}`;
    const previous = currentByVariant.get(variantId) || 0;
    if (appliedKeys.has(importKey)) {
      procesadas.push({
        estilo: row.estilo, color: row.color, talla: row.talla, cantidad: row.cantidad,
        ficha_id: row.product.id, cantidad_antes: previous, cantidad_despues: previous, idempotent: true,
      });
      continue;
    }
    const next = mode === 'sum' ? previous + row.cantidad : row.cantidad;
    if (juarez && !core.juarezAllowsQuantity(previous, next)) {
      omitidas.push({
        estilo: row.estilo, color: row.color, talla: row.talla, cantidad: row.cantidad, ficha_id: row.product.id,
        cantidad_antes: previous, cantidad_despues: previous,
        motivo: `JUÁREZ no baja: ${row.talla} tiene ${previous} y no se deja en ${next}.`,
      });
      continue;
    }
    if (next === previous) {
      omitidas.push({
        estilo: row.estilo, color: row.color, talla: row.talla, cantidad: row.cantidad, ficha_id: row.product.id,
        cantidad_antes: previous, cantidad_despues: previous,
        motivo: `La talla ${row.talla} ya tiene ${previous}; no hubo cambio.`,
      });
      continue;
    }
    const evento = mode === 'sum' || juarez ? 'StockIncreased' : 'StockSet';
    const operation = evento === 'StockIncreased' ? 'add' : 'set';
    const movementQuantity = operation === 'add' ? next - previous : row.cantidad;
    levelsPayload.push({ branch_id: branch.id, variant_id: variantId, quantity: next, updated_by: session.userId });
    movementPayload.push({
      organization_id: org.organization.id,
      branch_id: branch.id,
      variant_id: variantId,
      operation,
      previous_quantity: previous,
      quantity: movementQuantity,
      new_quantity: next,
      reason: `API tallas · ${batchId} · ${mode} · ${motivo}`,
      import_key: importKey,
      created_by: session.userId,
    });
    procesadas.push({
      estilo: row.estilo, color: row.color, talla: row.talla, cantidad: row.cantidad,
      ficha_id: row.product.id, cantidad_antes: previous, cantidad_despues: next, evento,
    });
  }
  await postChunks(db, 'inventory_movements_relational?on_conflict=import_key', movementPayload, 'resolution=merge-duplicates,return=minimal');
  await postChunks(db, 'inventory_levels?on_conflict=branch_id%2Cvariant_id', levelsPayload, 'resolution=merge-duplicates,return=minimal');
  const pares = procesadas.reduce((sum, row) => sum + Math.abs(Number(row.cantidad_despues || 0) - Number(row.cantidad_antes || 0)), 0);
  const result = {
    batch_id: batchId,
    mode,
    motivo,
    branch: { id: branch.id, code: branch.code, name: branch.name },
    evento: juarez || mode === 'sum' ? 'StockIncreased' : 'StockSet',
    tallas_procesadas: procesadas.length,
    procesadas,
    omitidas,
    creadas: procesadas.filter(row => Number(row.cantidad_antes || 0) === 0 && Number(row.cantidad_despues || 0) > 0).map(row => row.talla),
  };
  await db.rest('inventory_migration_runs', {
    method: 'POST',
    body: {
      organization_id: org.organization.id,
      branch_id: branch.id,
      source_summary: { api: 'v1', kind: 'sizes', batch_id: batchId, mode, motivo, result },
      product_count: [...new Set(procesadas.map(row => row.ficha_id))].length,
      variant_count: procesadas.length,
      pair_count: pares,
      created_by: session.userId,
    },
    prefer: 'return=minimal',
  });
  return result;
}

async function handleHistory(db, org, branchCode, query) {
  const branch = findBranch(org.branches, branchCode);
  let resource = `inventory_movements_relational?select=id,operation,previous_quantity,quantity,new_quantity,reason,import_key,created_at,variant_id&organization_id=eq.${org.organization.id}&branch_id=eq.${branch.id}&order=created_at.desc`;
  if (query.batch_id) resource += `&import_key=like.${encodeURIComponent(`api-v1:${query.batch_id}:`)}*`;
  if (query.desde) resource += `&created_at=gte.${encodeURIComponent(query.desde)}`;
  if (query.hasta) resource += `&created_at=lte.${encodeURIComponent(query.hasta)}`;
  const movements = await db.allRows(resource);
  const batches = (await db.allRows(`inventory_migration_runs?select=id,source_summary,created_at,pair_count,variant_count,product_count,created_by&organization_id=eq.${org.organization.id}&branch_id=eq.${branch.id}&order=created_at.desc`))
    .filter(row => row.source_summary?.api === 'v1' && (!query.batch_id || row.source_summary.batch_id === query.batch_id));
  return {
    branch: { id: branch.id, code: branch.code, name: branch.name },
    batches: batches.map(row => ({
      batch_id: row.source_summary?.batch_id,
      mode: row.source_summary?.mode || row.source_summary?.result?.mode,
      created_at: row.created_at,
      filas: row.variant_count,
      pares: row.pair_count,
      resultado: row.source_summary?.result || null,
    })),
    movements: movements.slice(0, 500),
  };
}

async function handleSummary(db, org, branchCode) {
  const branch = findBranch(org.branches, branchCode);
  const pares = await branchPairTotal(db, branch.id);
  let registros = 0;
  let estilos = 0;
  let valor_total = 0;
  try {
    const levels = await db.allRows(`inventory_levels?select=quantity,product_variants(product_id,products(estilo,precio))&branch_id=eq.${branch.id}&quantity=gt.0`);
    const styleSet = new Set();
    for (const row of levels) {
      registros += 1;
      const product = row.product_variants?.products;
      if (product?.estilo) styleSet.add(core.compactEstilo(product.estilo));
      valor_total += Number(row.quantity || 0) * Number(product?.precio || 0);
    }
    estilos = styleSet.size;
  } catch {
    const levels = await db.allRows(`inventory_levels?select=variant_id,quantity&branch_id=eq.${branch.id}&quantity=gt.0`);
    registros = levels.length;
  }
  return {
    branch: { id: branch.id, code: branch.code, name: branch.name },
    pares,
    registros,
    estilos,
    valor_total,
  };
}

async function handleReview(db, org, query) {
  const status = core.normalize(query.estado || 'pendiente') || 'PENDIENTE';
  const branchCode = core.text(query.branch);
  const products = await db.allRows(`products?select=${PRODUCT_SELECT}&organization_id=eq.${org.organization.id}&descripcion=like.*CLAREMM_REVIEW:*`);
  const items = [];
  for (const product of products) {
    const parsed = core.parseReview(product.descripcion);
    const review = parsed.review;
    if (!review) continue;
    if (status && core.normalize(review.status) !== status && status !== 'TODOS') continue;
    if (branchCode && core.normalize(review.branch_code) !== core.normalize(branchCode)) continue;
    items.push({
      ficha_id: product.id,
      estilo: product.estilo,
      color: product.color,
      marca: product.marca,
      tipo: product.linea,
      tipo_inferido: Boolean(review.tipo_inferido),
      material: product.acabado,
      label_material: review.label_material || '',
      label_material_source: review.label_material_source || '',
      precio: Number(product.precio || 0),
      precio_origen: review.precio_origen || '',
      estado_revision: review.status || 'pendiente',
      kind: review.kind,
      batch_id: review.batch_id || '',
      created_at: product.created_at,
      estado_saz: sazEstado(product, new Set()),
    });
  }
  return { items };
}

async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return send(res, 204, {});
  try {
    await agentAuth(req);
    const parts = pathParts(req);
    const query = queryOf(req);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (req.method === 'GET' && parts.length === 0) {
      return send(res, 200, { ok: true, version: 'v1', routes: API_ROUTES });
    }
    const session = await supabaseSession();
    const db = restClient(session);
    const org = await loadOrg(db);
    let result;
    if (req.method === 'GET' && parts.length === 1 && parts[0] === 'branches') result = await handleBranches(db, org);
    else if (req.method === 'GET' && parts[0] === 'catalog' && parts[1] === 'products' && parts[2]) result = await handleGetProduct(db, org, parts[2]);
    else if (req.method === 'GET' && parts[0] === 'catalog' && parts[1] === 'products' && !parts[2]) result = await handleCatalog(db, org, query);
    else if (req.method === 'GET' && parts[0] === 'branches' && parts[2] === 'inventory') result = await handleInventory(db, org, parts[1], query);
    else if (req.method === 'POST' && parts[0] === 'branches' && parts[2] === 'upload' && parts[3] === 'preview') result = await handlePreview(db, org, parts[1], body);
    else if (req.method === 'POST' && parts[0] === 'branches' && parts[2] === 'upload' && parts[3] === 'apply') result = await handleApply(db, session, org, parts[1], body);
    else if ((req.method === 'POST' || req.method === 'PATCH') && parts[0] === 'branches' && parts[2] === 'sizes') result = await handleSizes(db, session, org, parts[1], body);
    else if (req.method === 'PATCH' && parts[0] === 'catalog' && parts[1] === 'products') result = await handlePatchProduct(db, session, org, parts[2], body, query);
    else if (req.method === 'DELETE' && parts[0] === 'catalog' && parts[1] === 'products') result = await handleDeleteProduct(db, session, org, parts[2], body, query);
    else if (req.method === 'GET' && parts[0] === 'branches' && parts[2] === 'history') result = await handleHistory(db, org, parts[1], query);
    else if (req.method === 'GET' && parts[0] === 'branches' && parts[2] === 'summary') result = await handleSummary(db, org, parts[1]);
    else if (req.method === 'GET' && parts[0] === 'review' && parts[1] === 'pending') result = await handleReview(db, org, query);
    else throw fail(404, 'not_found', 'Ruta de API no reconocida.');
    return send(res, 200, result);
  } catch (error) {
    const status = error.status || 500;
    return send(res, status, error.public || { error: { code: 'unexpected', message: error.message || 'Error inesperado.' } });
  }
}

module.exports = handler;
module.exports.handleApply = handleApply;
module.exports.handlePatchProduct = handlePatchProduct;
module.exports.handleDeleteProduct = handleDeleteProduct;
module.exports.handleSizes = handleSizes;
module.exports.handleGetProduct = handleGetProduct;
module.exports.supabaseSession = supabaseSession;
