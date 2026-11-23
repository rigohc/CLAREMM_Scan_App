import EXCEL_PRODUCT_OPTION_VALUES from './product-option-values.json';
import PROVIDER_OPTION_VALUES from './provider-option-values.json';

export const DEFAULT_TEMPORADA = 'CLAREMM 26';

/**
 * Returns current date formatted as dd/mm/yy (e.g. 11/11/26)
 */
export function getFormattedDateDDMMYY(dateInput = null) {
  const d = dateInput ? new Date(dateInput) : new Date();
  const validDate = isNaN(d.getTime()) ? new Date() : d;
  const dd = String(validDate.getDate()).padStart(2, '0');
  const mm = String(validDate.getMonth() + 1).padStart(2, '0');
  const yy = String(validDate.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

export function formatCorrida(value) {
  const text = String(value || '').trim();
  const range = text.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
  const selected = text.match(/^(\d+(?:\.\d+)?)\s+al\s+(\d+(?:\.\d+)?)\s+inc\s+\d+(?:\.\d+)?$/i);
  const match = range || selected;
  return match ? `${Number(match[1]).toFixed(2)}-${Number(match[2]).toFixed(2)}` : text;
}

export const CLASIFICACIONES = EXCEL_PRODUCT_OPTION_VALUES.clasificacion;
export const LINEAS = EXCEL_PRODUCT_OPTION_VALUES.linea;

export const PRODUCT_OPTION_SEEDS = {
  color: EXCEL_PRODUCT_OPTION_VALUES.color,
  acabado: EXCEL_PRODUCT_OPTION_VALUES.acabado,
  corrida: EXCEL_PRODUCT_OPTION_VALUES.corrida,
  marca: EXCEL_PRODUCT_OPTION_VALUES.marca,
  proveedor: PROVIDER_OPTION_VALUES,
  sublinea: EXCEL_PRODUCT_OPTION_VALUES.sublinea,
  temporada: EXCEL_PRODUCT_OPTION_VALUES.temporada,
  departamento: ['CALZADO', 'ROPA'],
  clasificacion: CLASIFICACIONES,
  linea: LINEAS,
  suela: ['SUELAS'],
  plantilla: EXCEL_PRODUCT_OPTION_VALUES.plantilla,
  tacon: ['PISO'],
  forro: ['FORRO'],
  catalogo: EXCEL_PRODUCT_OPTION_VALUES.catalogo,
  comprador: EXCEL_PRODUCT_OPTION_VALUES.comprador,
  status: EXCEL_PRODUCT_OPTION_VALUES.status,
  estado: []
};

export function getProductFieldOptions(field, productOptions = {}) {
  const values = [
    ...(PRODUCT_OPTION_SEEDS[field] || []),
    ...(Array.isArray(productOptions[field]) ? productOptions[field] : [])
  ];
  const unique = new Map();
  for (const rawValue of values) {
    const text = rawValue === null || rawValue === undefined
      ? ''
      : String(rawValue).trim().replace(/\s+/g, ' ');
    const value = field === 'corrida' ? formatCorrida(text) : text;
    const key = value.normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('es');
    if (value && !unique.has(key)) unique.set(key, value);
  }
  return [...unique.values()].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}
