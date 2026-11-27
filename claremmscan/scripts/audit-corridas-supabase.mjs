#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import corridasCore from '../lib/corridas-core.js';
import branchCore from '../lib/branch-upload-core.js';

function readEnv(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/).flatMap(line => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1].startsWith('#')) return [];
    return [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]];
  }));
}

const env = { ...readEnv(path.resolve('.env.local')), ...process.env };
const url = String(env.SUPABASE_URL || '').replace(/\/$/, '');
const apiKey = env.SUPABASE_PUBLISHABLE_KEY || '';
const email = env.SUPABASE_MIGRATION_EMAIL || '';
const password = env.SUPABASE_MIGRATION_PASSWORD || '';
if (!url || !apiKey || !email || !password) throw new Error('Faltan variables o credenciales de Supabase.');

const authResponse = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: apiKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const auth = await authResponse.json();
if (!authResponse.ok || !auth.access_token) throw new Error(`No se pudo autenticar: ${auth.error_description || auth.message || authResponse.status}`);
const headers = { apikey: apiKey, Authorization: `Bearer ${auth.access_token}` };

async function allRows(resource, pageSize = 1000) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const separator = resource.includes('?') ? '&' : '?';
    const response = await fetch(`${url}/rest/v1/${resource}${separator}limit=${pageSize}&offset=${offset}`, { headers });
    const body = await response.json();
    if (!response.ok) throw new Error(`${resource}: ${body.message || response.status}`);
    rows.push(...body);
    if (body.length < pageSize) return rows;
  }
}

const memberships = await allRows(`organization_members?select=organization_id&user_id=eq.${auth.user.id}`);
const organizationIds = memberships.map(row => row.organization_id);
if (!organizationIds.length) throw new Error('La cuenta no pertenece a una organización.');
const orgFilter = `in.(${organizationIds.join(',')})`;
const [products, variants, corridas, relations] = await Promise.all([
  allRows(`products?select=id,organization_id,estilo,color,linea,corrida,activo&organization_id=${orgFilter}&activo=eq.true`),
  allRows('product_variants?select=id,product_id,size'),
  allRows(`corridas?select=id,organization_id,linea,nombre,talla_inicial,talla_final,incremento,activa&organization_id=${orgFilter}&activa=eq.true`),
  allRows(`estilo_corridas?select=organization_id,estilo_key,corrida_id,orden,fuente,notas&organization_id=${orgFilter}`),
]);

const productById = new Map(products.map(product => [product.id, product]));
const styleGroups = new Map();
const sizesByProduct = new Map();
for (const product of products) {
  const estiloKey = branchCore.compactEstilo(product.estilo).replace(/-/g, '');
  const key = `${product.organization_id}|${estiloKey}`;
  if (!styleGroups.has(key)) styleGroups.set(key, { organization_id: product.organization_id, estilo: estiloKey, products: [], sizes: new Set(), lines: new Map() });
  const group = styleGroups.get(key);
  group.products.push(product);
  const line = corridasCore.normalizeLine(product.linea);
  if (line) group.lines.set(line, (group.lines.get(line) || 0) + 1);
}
for (const variant of variants) {
  const product = productById.get(variant.product_id);
  if (!product) continue;
  const key = `${product.organization_id}|${branchCore.compactEstilo(product.estilo).replace(/-/g, '')}`;
  const size = corridasCore.halfSize(variant.size);
  if (size != null) {
    styleGroups.get(key)?.sizes.add(size);
    if (!sizesByProduct.has(product.id)) sizesByProduct.set(product.id, []);
    sizesByProduct.get(product.id).push(size);
  }
}

const corridaById = new Map(corridas.map(corrida => [corrida.id, corrida]));
const relationsByStyle = new Map();
for (const relation of relations) {
  const key = `${relation.organization_id}|${relation.estilo_key}`;
  if (!relationsByStyle.has(key)) relationsByStyle.set(key, []);
  relationsByStyle.get(key).push(relation);
}

const issues = [];
for (const [key, group] of styleGroups) {
  if (!group.sizes.size) continue;
  const assigned = (relationsByStyle.get(key) || []).sort((a, b) => a.orden - b.orden).map(relation => corridaById.get(relation.corrida_id)).filter(Boolean);
  const uncovered = [...group.sizes].filter(size => !assigned.some(corrida => corridasCore.corridaContainsSize({
    linea: corrida.linea,
    inicial: corrida.talla_inicial,
    final: corrida.talla_final,
    incremento: corrida.incremento,
  }, size)));
  const scalarMismatches = group.products.flatMap(product => {
    const parsed = corridasCore.parseCorridaText(product.corrida, product.linea);
    const productSizes = sizesByProduct.get(product.id) || [];
    const outside = productSizes.filter(size => !corridasCore.corridaContainsSize(parsed, size));
    return outside.length ? [{ ficha_id: product.id, color: product.color, corrida_actual: product.corrida || '', tallas_fuera: [...new Set(outside)].sort((a, b) => a - b).map(corridasCore.formatSize) }] : [];
  });
  if (assigned.length && !uncovered.length && !scalarMismatches.length) continue;
  const preferredLines = [...group.lines].sort((a, b) => b[1] - a[1]).map(([line]) => line);
  const candidates = corridas.filter(corrida => corrida.organization_id === group.organization_id).map(corrida => ({
    ...corrida,
    inicial: corrida.talla_inicial,
    final: corrida.talla_final,
  }));
  const recommendation = corridasCore.recommendCorridas({ sizes: [...group.sizes], corridas: candidates, preferredLines });
  issues.push({
    estilo: group.estilo,
    tallas_observadas: [...group.sizes].sort((a, b) => a - b).map(corridasCore.formatSize),
    lineas_observadas: preferredLines,
    corridas_asignadas: assigned.map(corrida => corrida.nombre),
    tallas_sin_cobertura: uncovered.sort((a, b) => a - b).map(corridasCore.formatSize),
    fichas_descuadradas: scalarMismatches,
    recomendacion: recommendation.corridas.map(corrida => ({ id: corrida.id, linea: corrida.linea, nombre: corrida.nombre })),
    recomendacion_completa: recommendation.completa,
  });
}

const report = {
  generated_at: new Date().toISOString(),
  mode: 'preview',
  writes: 0,
  products: products.length,
  styles_with_sizes: [...styleGroups.values()].filter(group => group.sizes.size).length,
  styles_to_review: issues.length,
  issues: issues.sort((a, b) => a.estilo.localeCompare(b.estilo, 'es', { numeric: true })),
};
console.log(JSON.stringify(report, null, 2));
