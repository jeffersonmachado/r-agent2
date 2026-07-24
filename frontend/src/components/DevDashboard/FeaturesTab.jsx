import React from 'react';
import { useTheme } from '../../styles/themeContext';
import { NavigationLink } from '../NavigationLink';
import { DEV_FEATURES } from '../../utils/devDashboardUtils';

/**
 * Tab de Funcionalidades
 */
export function FeaturesTab() {
  const { theme } = useTheme();

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4 text-text-primary">
        Funcionalidades de Desenvolvimento
      </h2>
      <p className="mb-6 text-text-secondary">
        Acesse ferramentas de desenvolvimento, testes e geração de código.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {DEV_FEATURES.map((feature) => (
          <NavigationLink
            key={feature.id}
            to={feature.path}
            className="block"
          >
            <div 
              className="rounded-lg border hover:shadow-lg transition-all p-4 cursor-pointer h-full"
              style={{ 
                backgroundColor: theme.colors.bg.secondary,
                borderColor: theme.colors.border.default,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = theme.colors.border.hover;
                e.currentTarget.style.backgroundColor = theme.colors.bg.hover;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = theme.colors.border.default;
                e.currentTarget.style.backgroundColor = theme.colors.bg.secondary;
              }}
            >
              <div className="flex items-start justify-between mb-3">
                <div className={`${feature.color} w-10 h-10 rounded-lg flex items-center justify-center text-xl`}>
                  {feature.icon}
                </div>
                <span className="text-xs px-2 py-1 rounded" style={{ 
                  color: theme.colors.text.tertiary,
                  backgroundColor: theme.colors.bg.tertiary
                }}>
                  {feature.category}
                </span>
              </div>
              <h3 className="text-base font-semibold mb-1 text-text-primary">
                {feature.title}
              </h3>
              <p className="text-sm text-text-secondary">
                {feature.description}
              </p>
            </div>
          </NavigationLink>
        ))}
      </div>
    </div>
  );
}

