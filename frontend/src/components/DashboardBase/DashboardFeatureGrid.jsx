import React, { useMemo, useState } from 'react';
import { DashboardFeatureCard } from './DashboardFeatureCard';

const INPUT_CLASS =
  'w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all';
const SELECT_CLASS =
  'w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all appearance-none cursor-pointer hover:border-border-hover';

/**
 * DashboardFeatureGrid
 *
 * Encapsula o padrão recorrente nos dashboards "hub":
 *   filtro de busca + filtro de categoria + grid de feature cards.
 *
 * @param {{ id, title, description, icon, path, color, category }[]} features
 * @param {(path: string) => void} onNavigate
 * @param {string} [searchLabel]
 * @param {string} [categoryLabel]
 */
export function DashboardFeatureGrid({ features, onNavigate, searchLabel = 'Buscar card', categoryLabel = 'Categoria' }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');

  const categories = useMemo(
    () => Array.from(new Set(features.map((f) => f.category))).sort(),
    [features],
  );

  const filteredFeatures = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return features.filter((feature) => {
      if (selectedCategory && feature.category !== selectedCategory) return false;
      if (!query) return true;
      return (
        feature.title.toLowerCase().includes(query) ||
        feature.description.toLowerCase().includes(query)
      );
    });
  }, [features, searchTerm, selectedCategory]);

  return (
    <>
      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
          <span>🔍</span>
          <span>Filtros da Navegação</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">{searchLabel}</label>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por nome ou descrição..."
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">{categoryLabel}</label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">Todas as categorias</option>
              {categories.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {filteredFeatures.map((feature) => (
          <DashboardFeatureCard
            key={feature.id}
            icon={feature.icon}
            title={feature.title}
            description={feature.description}
            category={feature.category}
            color={feature.color}
            onClick={() => onNavigate(feature.path)}
          />
        ))}
      </div>
    </>
  );
}
