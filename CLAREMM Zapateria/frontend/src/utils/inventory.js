export function getSizesForCorrida(corrida) {
  const match = String(corrida || '').trim().match(/^(\d+(?:\.\d{1,2})?)-(\d+(?:\.\d{1,2})?)$/);
  if (!match) return [];

  const start = Math.round(Number(match[1]) * 100);
  const end = Math.round(Number(match[2]) * 100);
  if (end < start) return [];

  const startFraction = start % 100;
  const endFraction = end % 100;
  if (![0, 50].includes(startFraction) || ![0, 50].includes(endFraction)) return [];

  const step = startFraction === 50 || endFraction === 50 ? 50 : 100;
  if ((end - start) % step !== 0) return [];

  return Array.from({ length: (end - start) / step + 1 }, (_, index) => {
    return ((start + index * step) / 100).toFixed(2).replace(/\.?0+$/, '');
  });
}
