import React from 'react';
import { useAuth } from '../context/authContext';
import { getAgentClassification } from '../utils/classification';
import { NavigationLink } from '../components/NavigationLink';
import { CrudPageBase } from '../modules/crud-base';

/**
 * Platform Support — hub de suporte da plataforma.
 *
 * Acessível apenas para classificações internas (SUPPORT/DEVELOPMENT):
 * - SUPPORT: replays de diagnóstico e auditoria;
 * - DEVELOPMENT: também status técnico do sistema.
 * PRODUCTION vê apenas o aviso de acesso restrito (a rota/menu também são
 * gated por classificação em menuPermissions).
 */
export function PlatformSupportPage() {
  const { agent } = useAuth();
  const classification = getAgentClassification(agent);

  if (classification === 'PRODUCTION') {
    return (
      <CrudPageBase>
        <div className="support-header">
          <h1>Platform Support</h1>
        </div>
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 text-center">
          <p className="text-text-secondary">Acesso restrito ao suporte da plataforma.</p>
        </div>
      </CrudPageBase>
    );
  }

  const cards = [
    {
      id: 'diagnostic-replays',
      title: 'Replays de diagnóstico',
      description: 'Investigação de sessões gravadas para análise de suporte.',
      path: '/rpa-replays',
      icon: '🔍',
    },
    {
      id: 'audit',
      title: 'Auditoria',
      description: 'Trilha de auditoria e eventos operacionais do tenant.',
      path: '/audit',
      icon: '📋',
    },
  ];

  if (classification === 'DEVELOPMENT') {
    cards.push({
      id: 'system-status',
      title: 'Status do Sistema',
      description: 'Saúde dos serviços e diagnóstico técnico da plataforma.',
      path: '/dev/system-status',
      icon: '💚',
    });
  }

  return (
    <CrudPageBase>
      <div className="support-header">
        <h1>Platform Support</h1>
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
        <p className="text-sm text-text-secondary mb-4">
          Ferramentas internas de suporte e diagnóstico da plataforma ({classification}).
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cards.map((card) => (
            <NavigationLink
              key={card.id}
              to={card.path}
              className="block p-5 rounded-xl border border-border-default bg-bg-secondary hover:border-border-hover transition-all"
            >
              <div className="text-2xl mb-2">{card.icon}</div>
              <h3 className="text-lg font-semibold text-text-primary mb-1">{card.title}</h3>
              <p className="text-sm text-text-secondary">{card.description}</p>
            </NavigationLink>
          ))}
        </div>
      </div>
    </CrudPageBase>
  );
}

export default PlatformSupportPage;
