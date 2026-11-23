#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function argsFrom(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index++) {
    if (!argv[index].startsWith('--')) continue;
    values[argv[index].slice(2)] = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : true;
  }
  return values;
}

function readEnv(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/).flatMap(line => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1].startsWith('#')) return [];
    return [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]];
  }));
}

const catalogText = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase().replace(/\s+/g, ' ');
const compactEstilo = value => catalogText(value).replace(/^0+(?=\d)/, '');
const colorTokens = value => catalogText(value).replace(/[\/\-_,+|.]/g, ' ').replace(/\s+/g, ' ').trim();
const foldedColor = value => {
  const tokens = colorTokens(value);
  if (tokens === 'B N' || tokens === 'BN') return 'BLANCO NEGRO';
  if (tokens === 'N B' || tokens === 'NB') return 'NEGRO BLANCO';
  return tokens;
};
const colorsMatch = (left, right) => Boolean(foldedColor(left) && foldedColor(left) === foldedColor(right));
const chunks = (values, size = 80) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
const catalogScore = product => (
  (Number(product.precio) > 0 ? 1000 : 0) +
  (String(product.imagen || '').trim() ? 400 : 0) +
  (product.source_system === 'saz_registered' ? 220 : 0)
);
const pickCanonical = candidates => [...candidates].sort((left, right) => catalogScore(right) - catalogScore(left) || String(left.id).localeCompare(String(right.id)))[0];

const ESTILO_TEMPLATE = {
  PI5085: 'PI5083',
  PI5086: 'PI5083',
  PI8500: 'PI8515',
  PI8008: 'PI8015',
  PI6538: 'PI6034',
  PI6506: 'PI6034',
};

const BOXES = [
  // Pendientes de la primera prueba (no se subieron)
  { estilo: 'PI5504', color: 'BLANCO AZUL', talla: '24.0', cantidad: 1, lote: 'pendiente' },
  { estilo: 'PI5504', color: 'BLANCO AZUL', talla: '26.0', cantidad: 1, lote: 'pendiente' },
  { estilo: 'PI5526', color: 'MEZCLILLA', talla: '22.0', cantidad: 1, lote: 'pendiente' },
  { estilo: 'PI5526', color: 'MEZCLILLA', talla: '23.0', cantidad: 1, lote: 'pendiente' },
  { estilo: 'PI5083', color: 'NEGRO AMBAR', talla: '23.5', cantidad: 1, lote: 'pendiente' },
  { estilo: 'PI5083', color: 'NEGRO AMBAR', talla: '24.0', cantidad: 1, lote: 'pendiente' },
  { estilo: 'PI5053', color: 'BLANCO AQUA', talla: '24.0', cantidad: 1, lote: 'pendiente' },
  { estilo: 'PI6083', color: 'BEIGE', talla: '24.5', cantidad: 1, lote: 'pendiente' },

  // Foto 1 · PI508x (26.0 sin etiqueta legible: se omite)
  { estilo: 'PI5086', color: 'MARINO', talla: '23.5', cantidad: 1, lote: 'foto1' },
  { estilo: 'PI5086', color: 'NEGRO', talla: '27.5', cantidad: 1, lote: 'foto1' },
  { estilo: 'PI5086', color: 'NEGRO', talla: '24.0', cantidad: 1, lote: 'foto1' },
  { estilo: 'PI5085', color: 'BLANCO', talla: '28.5', cantidad: 1, lote: 'foto1' },
  { estilo: 'PI5085', color: 'MARINO BLANCO', talla: '26.5', cantidad: 1, lote: 'foto1' },
  { estilo: 'PI5086', color: 'MARINO BLANCO', talla: '27.5', cantidad: 1, lote: 'foto1' },
  { estilo: 'PI5085', color: 'MARINO', talla: '27.5', cantidad: 1, lote: 'foto1' },

  // Foto 2 · PI507x
  { estilo: 'PI5079', color: 'NEGRO BLANCO', talla: '24.5', cantidad: 1, lote: 'foto2' },
  { estilo: 'PI5074', color: 'BLANCO AZUL', talla: '23.0', cantidad: 1, lote: 'foto2' },
  { estilo: 'PI5079', color: 'BLANCO AZUL', talla: '26.0', cantidad: 1, lote: 'foto2' },
  { estilo: 'PI5079', color: 'BLANCO', talla: '26.0', cantidad: 1, lote: 'foto2' },
  { estilo: 'PI5079', color: 'BLANCO', talla: '26.5', cantidad: 1, lote: 'foto2' },
  { estilo: 'PI5074', color: 'NEGRO BLANCO', talla: '24.0', cantidad: 1, lote: 'foto2' },
  { estilo: 'PI5074', color: 'NEGRO BLANCO', talla: '22.5', cantidad: 1, lote: 'foto2' },

  // Foto 3 · PI80xx
  { estilo: 'PI8026', color: 'CASIS', talla: '25.5', cantidad: 1, lote: 'foto3' },
  { estilo: 'PI8026', color: 'CASIS', talla: '24.0', cantidad: 1, lote: 'foto3' },
  { estilo: 'PI8021', color: 'NEGRO BLANCO', talla: '23.5', cantidad: 1, lote: 'foto3' },
  { estilo: 'PI8026', color: 'NEGRO', talla: '23.5', cantidad: 2, lote: 'foto3' },
  { estilo: 'PI8026', color: 'NEGRO', talla: '22.5', cantidad: 1, lote: 'foto3' },
  { estilo: 'PI8500', color: 'NEGRO', talla: '22.5', cantidad: 1, lote: 'foto3' },
  { estilo: 'PI8021', color: 'NEGRO BLANCO', talla: '24.0', cantidad: 1, lote: 'foto3' },
  { estilo: 'PI8515', color: 'GRIS AZUL', talla: '25.5', cantidad: 1, lote: 'foto3' },
  { estilo: 'PI8515', color: 'PALO DE ROSA', talla: '22.0', cantidad: 1, lote: 'foto3' },

  // Foto 4
  { estilo: 'PI8015', color: 'MARINO', talla: '25.0', cantidad: 1, lote: 'foto4' },
  { estilo: 'PI8008', color: 'MARINO', talla: '26.0', cantidad: 1, lote: 'foto4' },
  { estilo: 'PI8017', color: 'MARINO', talla: '25.0', cantidad: 1, lote: 'foto4' },
  { estilo: 'PI7010', color: 'BLANCO NEON', talla: '27.5', cantidad: 1, lote: 'foto4' },
  { estilo: 'PI8017', color: 'ROSA LILA', talla: '25.0', cantidad: 1, lote: 'foto4' },
  { estilo: 'PI7010', color: 'BLANCO NEON', talla: '25.5', cantidad: 1, lote: 'foto4' },
  { estilo: 'PI8017', color: 'ROSA LILA', talla: '26.5', cantidad: 1, lote: 'foto4' },
  { estilo: 'PI8015', color: 'MARINO', talla: '26.5', cantidad: 1, lote: 'foto4' },

  // Foto 5
  { estilo: 'PI5069', color: 'NEGRO BLANCO', talla: '22.5', cantidad: 1, lote: 'foto5' },
  { estilo: 'PI5066', color: 'BLANCO PLATA', talla: '26.0', cantidad: 1, lote: 'foto5' },
  { estilo: 'PI5069', color: 'NEGRO BLANCO', talla: '23.5', cantidad: 1, lote: 'foto5' },
  { estilo: 'PI5069', color: 'NEGRO BLANCO', talla: '23.0', cantidad: 1, lote: 'foto5' },
  { estilo: 'PI5069', color: 'NEGRO BLANCO', talla: '24.0', cantidad: 1, lote: 'foto5' },
  { estilo: 'PI5070', color: 'BEIGE', talla: '25.5', cantidad: 1, lote: 'foto5' },
  { estilo: 'PI5066', color: 'BLANCO PLATA', talla: '23.0', cantidad: 1, lote: 'foto5' },
  { estilo: 'PI5070', color: 'BLANCO NEGRO', talla: '24.5', cantidad: 1, lote: 'foto5' },
  { estilo: 'PI5069', color: 'NEGRO BLANCO', talla: '24.5', cantidad: 1, lote: 'foto5' },

  // Foto 6
  { estilo: 'PI8015', color: 'MARINO', talla: '27.5', cantidad: 1, lote: 'foto6' },
  { estilo: 'PI7010', color: 'BLANCO NEON', talla: '26.5', cantidad: 1, lote: 'foto6' },
  { estilo: 'PI6538', color: 'NEGRO', talla: '25.5', cantidad: 1, lote: 'foto6' },
  { estilo: 'PI6506', color: 'OLIVO', talla: '26.0', cantidad: 1, lote: 'foto6' },
  { estilo: 'PI6538', color: 'NEGRO', talla: '24.0', cantidad: 1, lote: 'foto6' },
  { estilo: 'PI6506', color: 'OLIVO', talla: '25.0', cantidad: 1, lote: 'foto6' },
  { estilo: 'PI6037', color: 'NEGRO AMBAR', talla: '24.0', cantidad: 1, lote: 'foto6' },
  { estilo: 'PI7008', color: 'NEGRO BLANCO', talla: '25.5', cantidad: 1, lote: 'foto6' },
  { estilo: 'PI6034', color: 'NEGRO ROJO', talla: '24.0', cantidad: 1, lote: 'foto6' },
];

const cli = argsFrom(process.argv.slice(2));
const apply = cli.apply === true;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const env = { ...readEnv(path.resolve(scriptDir, '../.env.local')), ...process.env };
const url = String(env.SUPABASE_URL || '').replace(/\/$/, '');
const apiKey = env.SUPABASE_PUBLISHABLE_KEY || '';
const email = String(env.SUPABASE_MIGRATION_EMAIL || '').trim();
const password = String(env.SUPABASE_MIGRATION_PASSWORD || '').trim();
if (!url || !apiKey || !email || !password) throw new Error('Faltan credenciales de Supabase.');

const authResponse = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: apiKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const auth = await authResponse.json();
if (!authResponse.ok || !auth.access_token) throw new Error(`Auth: ${auth.error_description || auth.message || authResponse.status}`);
const token = auth.access_token;
const userId = auth.user.id;

async function rest(resource, { method = 'GET', body, prefer = '' } = {}) {
  const response = await fetch(`${url}/rest/v1/${resource}`, {
    method,
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  const data = raw ? JSON.parse(raw) : null;
  if (!response.ok) throw new Error(`${method} ${resource}: ${data?.message || data?.details || raw || response.status}`);
  return data;
}

async function allRows(resource, pageSize = 1000) {
  const result = [];
  for (let offset = 0; ; offset += pageSize) {
    const separator = resource.includes('?') ? '&' : '?';
    const rows = await rest(`${resource}${separator}limit=${pageSize}&offset=${offset}`);
    result.push(...rows);
    if (rows.length < pageSize) return result;
  }
}

const memberships = await rest(`organization_members?select=organization_id&user_id=eq.${encodeURIComponent(userId)}`);
const organizations = await rest(`organizations?select=id,name&id=in.(${memberships.map(row => row.organization_id).join(',')})`);
const organization = organizations.find(row => catalogText(row.name) === 'CLAREMM');
if (!organization) throw new Error('No se encontró CLAREMM.');
const branches = await allRows(`branches?select=id,code,name&organization_id=eq.${organization.id}`);
const nuevoLeon = branches.find(row => row.code === 'NUEVO_LEON');
const juarez = branches.find(row => row.code === 'JUAREZ');
if (!nuevoLeon) throw new Error('No está la sucursal Nuevo León.');

const estilos = [...new Set([
  ...BOXES.map(row => row.estilo),
  ...Object.values(ESTILO_TEMPLATE),
])];
const products = [];
for (const group of chunks(estilos, 40)) {
  products.push(...await allRows(`products?select=id,estilo,color,precio,marca,proveedor,temporada,sublinea,departamento,clasificacion,linea,corrida,acabado,source_system,estado,imagen,activo&organization_id=eq.${organization.id}&estilo=in.(${group.join(',')})&activo=eq.true`));
}

const ofEstilo = estilo => products.filter(product => compactEstilo(product.estilo) === compactEstilo(estilo));
const matchProduct = row => pickCanonical(ofEstilo(row.estilo).filter(product => colorsMatch(product.color, row.color)));

const known = [];
const createColor = [];
const missingEstilo = [];
for (const row of BOXES) {
  const hit = matchProduct(row);
  if (hit) {
    known.push({ ...row, product: hit });
    continue;
  }
  const sibling = pickCanonical(ofEstilo(row.estilo));
  const mapped = ESTILO_TEMPLATE[row.estilo];
  const template = sibling || (mapped ? pickCanonical(ofEstilo(mapped)) : null);
  if (template) createColor.push({ ...row, template });
  else missingEstilo.push(row);
}

const summary = {
  mode: apply ? 'APPLY' : 'DRY_RUN',
  branch: nuevoLeon.name,
  boxes: BOXES.length,
  pairs: BOXES.reduce((sum, row) => sum + row.cantidad, 0),
  matched: known.length,
  newColors: [...new Set(createColor.map(row => `${row.estilo} ${row.color}`))],
  newEstilos: [...new Set(createColor.filter(row => !ofEstilo(row.estilo).length).map(row => row.estilo))],
  missingEstilos: [...new Set(missingEstilo.map(row => row.estilo))],
  note: 'ADD en Nuevo León. No se toca Juárez, ni precios, ni fotos.',
};
console.log(JSON.stringify(summary, null, 2));
if (!apply) {
  console.log('\nSimulación lista. Usa --apply para cargar existencias en Nuevo León.');
  process.exit(0);
}

const created = [];
const createdByKey = new Map();
for (const row of createColor) {
  const key = `${catalogText(row.estilo)}|${catalogText(row.color)}`;
  if (!createdByKey.has(key)) {
    const template = row.template;
    const payload = {
      organization_id: organization.id,
      source_system: 'branch_import',
      source_id: key,
      match_key: [row.estilo, row.color, template.marca].map(catalogText).join('|'),
      estilo: catalogText(row.estilo),
      color: catalogText(row.color),
      precio: Math.max(0, Number(template.precio) || 0),
      marca: template.marca || 'PIRMA',
      proveedor: template.proveedor || '',
      temporada: template.temporada || '',
      sublinea: template.sublinea || '',
      departamento: template.departamento || '',
      clasificacion: template.clasificacion || '',
      linea: template.linea || '',
      corrida: template.corrida || '',
      acabado: template.acabado || 'SINTETICO',
      activo: true,
    };
    const saved = await rest('products?on_conflict=organization_id%2Csource_system%2Csource_id', {
      method: 'POST',
      body: [payload],
      prefer: 'resolution=merge-duplicates,return=representation',
    });
    const product = saved?.[0];
    if (!product) throw new Error(`No se creó ${row.estilo} ${row.color}`);
    products.push(product);
    createdByKey.set(key, product);
    created.push({ estilo: product.estilo, color: product.color, id: product.id, precio: product.precio });
  }
  known.push({ ...row, product: createdByKey.get(key) });
}

const stockGroups = new Map();
for (const row of known) {
  const size = String(row.talla).replace(',', '.');
  const key = `${row.product.id}|${size}`;
  if (!stockGroups.has(key)) stockGroups.set(key, { product: row.product, size, cantidad: 0, lotes: [] });
  const group = stockGroups.get(key);
  group.cantidad += row.cantidad;
  group.lotes.push(row.lote);
}

const variantRequests = [...stockGroups.values()].map(row => ({ product_id: row.product.id, size: row.size }));
const variantIds = new Map();
for (const group of chunks(variantRequests, 80)) {
  const saved = await rest('product_variants?on_conflict=product_id%2Csize', {
    method: 'POST', body: group, prefer: 'resolution=merge-duplicates,return=representation',
  });
  for (const row of saved || []) variantIds.set(`${row.product_id}|${row.size}`, row.id);
}

const variantIdList = [...variantIds.values()];
const existingLevels = [];
for (const group of chunks(variantIdList, 80)) {
  existingLevels.push(...await rest(`inventory_levels?select=variant_id,quantity&branch_id=eq.${nuevoLeon.id}&variant_id=in.(${group.join(',')})`));
}
const previousByVariant = new Map(existingLevels.map(row => [row.variant_id, Number(row.quantity || 0)]));

async function branchPairTotal(branchId) {
  const rows = await allRows(`inventory_levels?select=quantity&branch_id=eq.${branchId}`);
  return rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
}
const juarezBefore = await branchPairTotal(juarez.id);
const nuevoLeonBefore = await branchPairTotal(nuevoLeon.id);

const levels = [];
const movements = [];
let addedPairs = 0;
const skipped = [];
for (const row of stockGroups.values()) {
  const variantId = variantIds.get(`${row.product.id}|${row.size}`);
  if (!variantId) throw new Error(`Sin variante ${row.product.estilo} ${row.size}`);
  const previous = previousByVariant.get(variantId) || 0;
  const importKey = `nl-cajas-20261121:${row.product.id}:${row.size}`;
  const existingMovement = await rest(`inventory_movements_relational?select=id,import_key&import_key=eq.${encodeURIComponent(importKey)}`);
  if (existingMovement?.length) {
    skipped.push(`${row.product.estilo} ${row.product.color} ${row.size}`);
    continue;
  }
  const next = previous + row.cantidad;
  addedPairs += row.cantidad;
  levels.push({ branch_id: nuevoLeon.id, variant_id: variantId, quantity: next, updated_by: userId });
  movements.push({
    organization_id: organization.id,
    branch_id: nuevoLeon.id,
    variant_id: variantId,
    operation: 'add',
    previous_quantity: previous,
    quantity: row.cantidad,
    new_quantity: next,
    reason: `Cajas Nuevo León · ${[...new Set(row.lotes)].join(', ')}`,
    import_key: importKey,
    created_by: userId,
  });
}

for (const group of chunks(levels, 80)) {
  if (!group.length) continue;
  await rest('inventory_levels?on_conflict=branch_id%2Cvariant_id', {
    method: 'POST', body: group, prefer: 'resolution=merge-duplicates,return=minimal',
  });
}
for (const group of chunks(movements, 80)) {
  if (!group.length) continue;
  await rest('inventory_movements_relational?on_conflict=import_key', {
    method: 'POST', body: group, prefer: 'resolution=merge-duplicates,return=minimal',
  });
}

const juarezAfter = await branchPairTotal(juarez.id);
const nuevoLeonAfter = await branchPairTotal(nuevoLeon.id);
console.log(JSON.stringify({
  completed: true,
  createdColors: created,
  appliedPairs: addedPairs,
  skippedAlreadyLoaded: skipped,
  missingEstilos: missingEstilo,
  juarezBefore,
  juarezAfter,
  juarezUntouched: juarezBefore === juarezAfter,
  nuevoLeonBefore,
  nuevoLeonAfter,
}, null, 2));
