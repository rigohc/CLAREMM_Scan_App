import React from 'react';
import { Package, Award, Layers, Sparkles } from 'lucide-react';

export default function StatsCards({ stats, totalProducts }) {
  const cards = [
    {
      title: 'Total en Catálogo',
      value: totalProducts || stats?.total || 0,
      subtitle: 'Estilos y modelos registrados',
      icon: Package,
      accent: 'border-amber-200 text-amber-700 bg-amber-50'
    },
    {
      title: 'Marcas Registradas',
      value: stats?.brandsCount || 0,
      subtitle: 'Firmas y talleres de calzado',
      icon: Award,
      accent: 'border-blue-200 text-blue-700 bg-blue-50'
    },
    {
      title: 'Líneas de Diseño',
      value: stats?.linesCount || 0,
      subtitle: 'Formal, Casual, Botas, Zapatilla...',
      icon: Layers,
      accent: 'border-purple-200 text-purple-700 bg-purple-50'
    },
    {
      title: 'Digitalización IA',
      value: '100% Multimodal',
      subtitle: 'Gemini Vision activo para fichas',
      icon: Sparkles,
      accent: 'border-emerald-200 text-emerald-700 bg-emerald-50'
    }
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
      {cards.map((card, idx) => {
        const Icon = card.icon;
        return (
          <div
            key={idx}
            className="bg-white rounded-2xl p-3.5 sm:p-5 relative overflow-hidden transition-all duration-300 hover:scale-[1.02] border border-slate-200 hover:border-amber-300 shadow-sm hover:shadow-md flex flex-col justify-between"
          >
            <div className="flex items-center justify-between mb-2 sm:mb-3">
              <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-500 truncate mr-1">
                {card.title}
              </span>
              <div className={`p-1.5 sm:p-2.5 rounded-xl border shrink-0 ${card.accent}`}>
                <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </div>
            </div>

            <div>
              <h3 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight font-mono">
                {card.value}
              </h3>
              <p className="text-[10px] sm:text-xs text-slate-500 mt-0.5 sm:mt-1 truncate">
                {card.subtitle}
              </p>
            </div>

            {/* Subtle light gold glow corner */}
            <div className="absolute -bottom-6 -right-6 w-16 sm:w-20 h-16 sm:h-20 bg-amber-100/40 rounded-full blur-xl pointer-events-none" />
          </div>
        );
      })}
    </div>
  );
}
