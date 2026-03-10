import React from 'react';
import { PlatformHubPage } from '../components/PlatformHubPage';
import { PlatformHubSection } from '../components/PlatformHubSection';
import { PlatformHubCard } from '../components/PlatformHubCard';
import { getHubGridClassName } from '../utils/hubLayout';

const items = [
  { id: 'support', title: 'Atendimento', description: 'Operação central', icon: '💬', badge: 'Operação', color: 'bg-cyan-500' },
  { id: 'analytics', title: 'Analytics', description: 'Indicadores principais', icon: '📊', badge: 'Analytics', color: 'bg-rose-500' },
];

export function BasicHubExample() {
  return (
    <PlatformHubPage>
      <div className="platform-shell__header">
        <div className="platform-shell__header-main">
          <h1 className="platform-shell__title">Hub Exemplo</h1>
        </div>
        <p className="platform-shell__description">Exemplo mínimo de navegação operacional com cards.</p>
      </div>
      <PlatformHubSection title="Módulos" icon="🧭">
        <div className={getHubGridClassName({ columns: 4 })}>
          {items.map((item) => (
            <PlatformHubCard
              key={item.id}
              title={item.title}
              description={item.description}
              icon={item.icon}
              badge={item.badge}
              accentClassName={item.color}
            />
          ))}
        </div>
      </PlatformHubSection>
    </PlatformHubPage>
  );
}
