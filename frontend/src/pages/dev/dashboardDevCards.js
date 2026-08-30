/**
 * Cards de engenharia do Dashboard Legado (somente classificação DEVELOPMENT).
 *
 * Módulo dev-only (frontend/src/pages/dev/): fora das superfícies PRODUCTION
 * varridas pelo validate-experience-segregation. O DashboardPage espalha estes
 * cards apenas quando getAgentClassification(agent) === 'DEVELOPMENT'.
 */
export const DEV_DASHBOARD_CARDS = [
  {
    id: 'rpa-seeds',
    title: 'Seeds RPA',
    description: 'Visualize e reproduza seeds de /tests/rpa/seeds/',
    icon: '🌱',
    path: '/rpa-seeds',
    color: 'bg-lime-600',
    category: 'RPA',
  },
  {
    id: 'qa',
    title: 'Painel de Qualidade (QA)',
    description: 'Ferramentas de qualidade e validação',
    icon: '✅',
    path: '/qa',
    color: 'bg-teal-600',
    category: 'Qualidade',
  },
  {
    id: 'qa-mesh',
    title: 'QA Mesh',
    description: 'Malha unificada de QA + RPA com replay, evidência e go/no-go',
    icon: '🕸️',
    path: '/qa-mesh',
    color: 'bg-amber-600',
    category: 'Qualidade',
  },
  {
    id: 'generate-system',
    title: 'Gerar Sistema',
    description: 'Gere fluxos, RPA e seeds automaticamente',
    icon: '🎯',
    path: '/generate-system',
    color: 'bg-indigo-600',
    category: 'Geração',
  },
];
