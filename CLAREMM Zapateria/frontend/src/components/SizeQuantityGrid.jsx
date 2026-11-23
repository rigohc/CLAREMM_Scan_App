import React from 'react';

export default function SizeQuantityGrid({
  sizes,
  values,
  onChange,
  currentQuantities = {},
  operation = 'set',
  label = 'Existencia inicial por talla'
}) {
  if (!sizes.length) return null;

  return (
    <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3 sm:p-4">
      <div>
        <h4 className="text-sm font-bold text-slate-800">{label}</h4>
        <p className="mt-1 text-xs text-slate-600">
          Captura pares por talla. Las casillas vacías no cambian la existencia.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
        {sizes.map(size => {
          const current = Number(currentQuantities[size] || 0);
          const entered = values[size] ?? '';
          const next = entered === ''
            ? current
            : operation === 'add'
              ? current + Number(entered)
              : Number(entered);
          return (
            <label key={size} className="min-w-0 rounded-lg border border-slate-200 bg-white p-2">
              <span className="flex items-center justify-between gap-1 text-xs font-bold text-slate-700">
                <span>Talla {size}</span>
                <span className="text-[10px] font-medium text-slate-400">{current} actual</span>
              </span>
              <input
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={entered}
                onChange={event => onChange(size, event.target.value)}
                aria-label={`Pares para talla ${size}`}
                placeholder={operation === 'add' ? 'Sumar' : 'Total'}
                className="mt-1.5 min-h-11 w-full rounded-md border border-slate-300 px-2 text-center text-base font-semibold text-slate-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200"
              />
              {operation === 'add' && entered !== '' && (
                <span className="mt-1 block text-center text-[10px] text-emerald-700">
                  Quedará: {next}
                </span>
              )}
            </label>
          );
        })}
      </div>
    </section>
  );
}
