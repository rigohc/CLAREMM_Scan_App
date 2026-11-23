function formatSize(hundredths) {
  return (hundredths / 100).toFixed(2).replace(/\.?0+$/, '');
}

export function getSizesForCorrida(corrida) {
  const match = String(corrida || '').trim().match(/^(\d+(?:\.\d{1,2})?)-(\d+(?:\.\d{1,2})?)$/);
  if (!match) {
    throw new Error('La corrida debe usar el formato talla inicial-final, por ejemplo 21.50-27.00.');
  }

  const start = Math.round(Number(match[1]) * 100);
  const end = Math.round(Number(match[2]) * 100);
  if (end < start) {
    throw new Error('La talla final de la corrida debe ser igual o mayor que la inicial.');
  }

  const startFraction = start % 100;
  const endFraction = end % 100;
  const hasHalfSize = startFraction === 50 || endFraction === 50;
  if (![0, 50].includes(startFraction) || ![0, 50].includes(endFraction)) {
    throw new Error('Para existencias, las tallas deben ser enteras o medias tallas (.5).');
  }

  const step = hasHalfSize ? 50 : 100;
  if ((end - start) % step !== 0) {
    throw new Error('El rango de corrida no coincide con incrementos de talla entera o media.');
  }

  const sizes = [];
  for (let size = start; size <= end; size += step) {
    sizes.push(formatSize(size));
  }
  return sizes;
}

export function validateInventoryItems(corrida, items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Indica al menos una talla con cantidad.');
  }

  const corridaSizes = new Set(getSizesForCorrida(corrida));
  const seenSizes = new Set();
  return items.map((item) => {
    const size = String(item?.size ?? '').trim();
    const quantity = item?.quantity;
    if (!corridaSizes.has(size)) {
      throw new Error(`La talla ${size || '(vacía)'} no pertenece a la corrida del producto.`);
    }
    if (seenSizes.has(size)) {
      throw new Error(`La talla ${size} está repetida.`);
    }
    if (!Number.isSafeInteger(quantity) || quantity < 0) {
      throw new Error(`La cantidad de la talla ${size} debe ser un entero no negativo.`);
    }
    seenSizes.add(size);
    return { size, quantity };
  });
}
