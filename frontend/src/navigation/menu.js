export const navigationMenu = [
  {
    id: 'cockpit',
    label: 'Painel',
    icon: '◉',
    path: '/workspace',
    description: 'Espaço de trabalho 360, cliente no centro da operação.',
    permission: { resource: 'workspace', action: 'read' },
    children: [
      {
        id: 'dashboard-legacy',
        label: 'Dashboard Legado',
        path: '/dashboard-legacy',
        description: 'Hub antigo com catálogo completo de funcionalidades.',
        hiddenInSidebar: true,
        keywords: ['dashboard antigo', 'hub antigo', 'dashboard legado'],
      },
    ],
  },
  {
    id: 'relacionamento',
    label: 'Relacionamento',
    icon: '◎',
    path: '/workspace',
    description: 'Atendimento, CRM e comunicação.',
    children: [
      {
        id: 'atendimento',
        label: 'Atendimento',
        children: [
          {
            id: 'workspace',
            label: 'RAP Espaço de Trabalho',
            path: '/workspace',
            permission: { resource: 'workspace', action: 'read' },
            keywords: ['cliente 360', 'timeline', 'workspace', 'insights', 'ações'],
          },
          {
            id: 'support',
            label: 'Central de Atendimento',
            path: '/support',
            permission: { resource: 'tickets', action: 'read' },
            keywords: ['tickets', 'conversas', 'workspace'],
          },
          {
            id: 'inbox',
            label: 'Caixa de Entrada',
            path: '/inbox',
            permission: { resource: 'tickets', action: 'read' },
          },
          {
            id: 'maintenance',
            label: 'Manutenção',
            path: '/maintenance',
            permission: { resource: 'tickets', action: 'list_all' },
            hiddenInSidebar: true,
          },
          {
            id: 'quick-replies',
            label: 'Respostas Rápidas',
            path: '/quick-replies',
            permission: { resource: 'quick_replies', action: 'read' },
          },
          {
            id: 'departments',
            label: 'Departamentos',
            path: '/departments',
            permission: { resource: 'departments', action: 'read' },
          },
          {
            id: 'failed-messages',
            label: 'Falhas de Entrega',
            path: '/failed-messages',
            permission: { resource: 'tickets', action: 'read' },
          },
        ],
      },
      {
        id: 'crm',
        label: 'CRM',
        roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'],
        children: [
          {
            id: 'crm-dashboard',
            label: 'Painel CRM',
            path: '/crm',
            permission: { resource: 'crm', action: 'read' },
          },
          { id: 'crm-accounts', label: 'Contas', path: '/crm/accounts', permission: { resource: 'crm', action: 'read' }, hiddenInSubNav: true },
          { id: 'crm-contacts', label: 'Contatos', path: '/crm/contacts', permission: { resource: 'crm', action: 'read' }, hiddenInSubNav: true },
          { id: 'crm-leads', label: 'Leads', path: '/crm/leads', permission: { resource: 'crm', action: 'read' }, hiddenInSubNav: true },
          { id: 'crm-pipelines', label: 'Pipelines', path: '/crm/pipelines', permission: { resource: 'crm', action: 'read' }, hiddenInSubNav: true },
          { id: 'crm-opportunities', label: 'Oportunidades', path: '/crm/opportunities', permission: { resource: 'crm', action: 'read' }, hiddenInSubNav: true },
          { id: 'crm-activities', label: 'Atividades', path: '/crm/activities', permission: { resource: 'crm', action: 'read' }, hiddenInSubNav: true },
          { id: 'crm-analytics', label: 'Análises CRM', path: '/crm/analytics', permission: { resource: 'crm', action: 'read' }, hiddenInSubNav: true },
          { id: 'crm-reports', label: 'Relatórios CRM', path: '/crm/reports', permission: { resource: 'crm', action: 'read' }, hiddenInSubNav: true },
          { id: 'crm-campaigns', label: 'Campanhas CRM', path: '/crm/campaigns', permission: { resource: 'crm', action: 'read' }, hiddenInSubNav: true },
          { id: 'crm-webhooks', label: 'Webhooks do CRM', path: '/crm/webhooks', permission: { resource: 'crm', action: 'read' }, hiddenInSubNav: true },
          { id: 'crm-rbac', label: 'RBAC CRM', path: '/crm/rbac', permission: { resource: 'crm', action: 'read' }, hiddenInSubNav: true },
          { id: 'crm-audit', label: 'Auditoria CRM', path: '/crm/audit', permission: { resource: 'crm', action: 'read' }, hiddenInSubNav: true },
        ],
      },
      {
        id: 'canais-mensageria',
        label: 'Canais e Conteúdo',
        children: [
          {
            id: 'whatsapp-templates',
            label: 'Templates WhatsApp',
            path: '/whatsapp-templates',
            permission: { resource: 'flows', action: 'read' },
          },
          {
            id: 'bulk-messaging',
            label: 'Disparos em Massa',
            path: '/bulk-messaging',
            permission: { resource: 'bulk_messaging', action: 'read' },
            roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'],
          },
          {
            id: 'marketing',
            label: 'Marketing',
            path: '/marketing',
            permission: { resource: 'config', action: 'read' },
            roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'],
          },
        ],
      },
    ],
  },
  {
    id: 'operacao',
    label: 'Operação',
    icon: '△',
    path: '/supervisor',
    description: 'Execução, monitoramento e canais.',
    children: [
      {
        id: 'operacao-monitoramento',
        label: 'Monitoramento',
        children: [
          { id: 'supervisor', label: 'Supervisor', path: '/supervisor', permission: { resource: 'reports', action: 'read' }, roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'] },
          { id: 'operations-dashboard', label: 'Painel Operacional', path: '/operations-dashboard', permission: { resource: 'reports', action: 'read' }, roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'] },
          { id: 'analytics', label: 'Análises', path: '/analytics', permission: { resource: 'reports', action: 'read' } },
          { id: 'tenant-intelligence', label: 'Inteligência do Tenant', path: '/tenant-intelligence', permission: { resource: 'reports', action: 'read' } },
          { id: 'channel-health', label: 'Saúde de Canais', path: '/channel-health', permission: { resource: 'config', action: 'read' }, roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'] },
          { id: 'system-status', label: 'Status do Sistema', path: '/system-status', permission: { resource: 'config', action: 'read' } },
          { id: 'plan-usage', label: 'Plano e Uso', path: '/plan-usage', permission: { resource: 'config', action: 'read' }, roles: ['admin', 'owner', 'super_admin'] },
          { id: 'orders', label: 'Pedidos', path: '/orders', permission: { resource: 'reports', action: 'read' }, hiddenInSidebar: true },
          { id: 'kitchen', label: 'Cozinha', path: '/kitchen', permission: { resource: 'reports', action: 'read' }, hiddenInSidebar: true },
          { id: 'dispatch', label: 'Despacho', path: '/dispatch', permission: { resource: 'reports', action: 'read' }, hiddenInSidebar: true },
        ],
      },
      {
        id: 'operacao-canais',
        label: 'Canais',
        children: [
          { id: 'channel-accounts', label: 'Contas de Canal', path: '/channel-accounts', permission: { resource: 'config', action: 'read' }, roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'] },
          { id: 'whatsapp-connections', label: 'Conexões WhatsApp', path: '/whatsapp-connections', permission: { resource: 'config', action: 'update' }, roles: ['admin', 'owner', 'manager', 'supervisor', 'super_admin'] },
          { id: 'whatsapp-ivr', label: 'URA WhatsApp', path: '/whatsapp-ivr', permission: { resource: 'config', action: 'update' }, roles: ['admin', 'owner', 'manager', 'supervisor', 'super_admin'] },
          { id: 'chat-humano', label: 'Painel de Chat Humano', path: '/chat-humano', permission: { resource: 'reports', action: 'read' }, roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'], hiddenInSidebar: true },
          { id: 'fila-fisica', label: 'Fila Física', path: '/fila-fisica', permission: { resource: 'reports', action: 'read' }, roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'], hiddenInSidebar: true },
        ],
      },
      {
        id: 'pbx',
        label: 'PBX',
        roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'],
        children: [
          { id: 'pbx-dashboard', label: 'PBX', path: '/pbx', permission: { resource: 'config', action: 'read' } },
          { id: 'pbx-extensions', label: 'Ramais', path: '/pbx/extensions', permission: { resource: 'config', action: 'read' }, hiddenInSubNav: true },
          { id: 'pbx-trunks', label: 'Troncos', path: '/pbx/trunks', permission: { resource: 'config', action: 'read' }, hiddenInSubNav: true },
          { id: 'pbx-routes', label: 'Rotas', path: '/pbx/routes', permission: { resource: 'config', action: 'read' }, hiddenInSubNav: true },
        ],
      },
    ],
  },
  {
    id: 'automacao',
    label: 'Automação',
    icon: '□',
    path: '/editor',
    description: 'Fluxos, orquestração e execução.',
    children: [
      {
        id: 'design',
        label: 'Modelagem',
        children: [
          { id: 'editor', label: 'Editor de Fluxos', path: '/editor', permission: { resource: 'flows', action: 'read' }, roles: ['supervisor', 'admin', 'super_admin'] },
          { id: 'bpmn-editor', label: 'Editor BPMN', path: '/bpmn-editor', permission: { resource: 'flows', action: 'read' }, roles: ['supervisor', 'admin', 'super_admin'] },
          { id: 'node-marketplace', label: 'Mercado de Nodes', path: '/node-marketplace', permission: { resource: 'config', action: 'read' }, roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'] },
          { id: 'solutions', label: 'Pacotes de Solução', path: '/solutions', permission: { resource: 'config', action: 'read' }, roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'] },
        ],
      },
      {
        id: 'execucao',
        label: 'Execução',
        children: [
          { id: 'automations', label: 'Automações', path: '/automations', permission: { resource: 'config', action: 'update' }, roles: ['admin', 'owner', 'manager', 'supervisor', 'super_admin'] },
          { id: 'projects', label: 'Projetos', path: '/projects', permission: { resource: 'projects', action: 'read' }, roles: ['operator', 'manager', 'admin', 'owner', 'supervisor', 'super_admin'] },
          { id: 'tasks', label: 'Tarefas', path: '/tasks', permission: { resource: 'config', action: 'update' }, roles: ['admin', 'owner', 'manager', 'supervisor', 'super_admin'] },
          { id: 'generate-system', label: 'Gerar Sistema', path: '/generate-system', permission: { resource: 'config', action: 'read' }, hiddenInSidebar: true },
          { id: 'rpa-test', label: 'Teste RPA', path: '/dev/rpa-test', permission: { resource: 'flows', action: 'read' }, hiddenInSidebar: true },
          { id: 'rpa-replays', label: 'Replays RPA', path: '/dev/rpa-replays', permission: { resource: 'flows', action: 'read' }, hiddenInSidebar: true },
          { id: 'rpa-seeds', label: 'Seeds RPA', path: '/rpa-seeds', permission: { resource: 'flows', action: 'read' }, hiddenInSidebar: true },
          { id: 'chat', label: 'Chat de Teste', path: '/chat', permission: { resource: 'tickets', action: 'read' }, hiddenInSidebar: true },
        ],
      },
      {
        id: 'assistentes',
        label: 'Assistentes',
        children: [
          { id: 'ai-tools', label: 'Ferramentas de IA', path: '/ai-tools', permission: { resource: 'tickets', action: 'read' } },
          { id: 'segmentation', label: 'Segmentação', path: '/segmentation', permission: { resource: 'tickets', action: 'read' } },
        ],
      },
    ],
  },
  {
    id: 'inteligencia',
    label: 'Inteligência',
    icon: '◇',
    path: '/knowledge-base',
    description: 'Conhecimento, RAG e documentação.',
    children: [
      {
        id: 'conhecimento',
        label: 'Conhecimento',
        children: [
          { id: 'faq', label: 'Perguntas Frequentes', path: '/faq', permission: { resource: 'rag', action: 'update' } },
          { id: 'knowledge-base', label: 'Base de Conhecimento', path: '/knowledge-base', permission: { resource: 'rag', action: 'read' } },
          { id: 'product-docs', label: 'Documentação de Produto', path: '/product-docs', permission: { resource: 'rag', action: 'read' } },
          { id: 'rag-documents', label: 'Documentos RAG', path: '/rag-documents', permission: { resource: 'rag', action: 'read' } },
          { id: 'web-scraping', label: 'Raspagem de Sites', path: '/web-scraping', permission: { resource: 'rag', action: 'create' } },
        ],
      },
      {
        id: 'governed-insights',
        label: 'Análises Governadas',
        roles: ['admin', 'owner', 'super_admin'],
        children: [
          { id: 'export', label: 'Exportação', path: '/export', permission: { resource: 'reports', action: 'export' }, roles: ['supervisor', 'admin', 'super_admin'] },
          { id: 'audit-hidden-copy', label: 'Auditoria', path: '/audit', permission: { resource: 'audit', action: 'read' }, hiddenInSidebar: true, hiddenInSubNav: true },
        ],
      },
    ],
  },
  {
    id: 'verticais',
    label: 'Verticais',
    icon: '▣',
    path: '/vertical/dashboard',
    description: 'Espaços de trabalho por vertical.',
    roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'],
    children: [
      {
        id: 'vertical-hub',
        label: 'Hub Vertical',
        children: [
          { id: 'vertical-dashboard', label: 'Painel Vertical', path: '/vertical/dashboard', permission: { resource: 'reports', action: 'read' } },
        ],
      },
    ],
  },
  {
    id: 'plataforma',
    label: 'Plataforma',
    icon: '▤',
    path: '/config',
    description: 'Configuração, governança e administração.',
    children: [
      {
        id: 'administracao',
        label: 'Administração',
        children: [
          { id: 'config', label: 'Configuração', path: '/config', permission: { resource: 'config', action: 'read' } },
          { id: 'agents', label: 'Agentes', path: '/agents', permission: { resource: 'agents', action: 'list_all' } },
          { id: 'onboarding', label: 'Onboarding', path: '/onboarding', permission: { resource: 'tenant', action: 'read' } },
          { id: 'tenants', label: 'Organizações', path: '/tenants', permission: { resource: 'tenant', action: 'read' }, roles: ['owner', 'admin', 'super_admin'] },
          { id: 'mfa', label: 'MFA', path: '/mfa', permission: { resource: 'config', action: 'update' }, roles: ['admin', 'owner', 'manager', 'supervisor', 'super_admin'] },
          { id: 'developer-keys', label: 'Chaves de Desenvolvedor', path: '/developer-keys', permission: { resource: 'config', action: 'read' }, roles: ['admin', 'owner', 'manager', 'supervisor', 'super_admin'] },
          { id: 'agenda', label: 'Agenda', path: '/agenda', permission: { resource: 'reports', action: 'read' }, roles: ['admin', 'owner', 'manager', 'supervisor', 'super_admin'], hiddenInSidebar: true },
          { id: 'sla-policies', label: 'SLA', path: '/sla-policies', permission: { resource: 'reports', action: 'read' }, roles: ['admin', 'owner', 'manager', 'supervisor', 'super_admin'] },
        ],
      },
      {
        id: 'governanca',
        label: 'Governança',
        roles: ['admin', 'owner', 'super_admin'],
        children: [
          { id: 'access-control', label: 'Controle de Acesso', path: '/access-control', permission: { resource: 'config', action: 'read' }, roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'] },
          { id: 'rbac', label: 'RBAC', path: '/rbac', permission: { resource: 'agents', action: 'update' }, roles: ['admin', 'owner', 'super_admin'] },
          { id: 'audit', label: 'Auditoria', path: '/audit', permission: { resource: 'audit', action: 'read' } },
          { id: 'sso-scim', label: 'SSO / SCIM', path: '/sso-scim', permission: { resource: 'config', action: 'read' }, roles: ['admin', 'owner', 'super_admin'] },
          { id: 'backup', label: 'Backup / Recuperação', path: '/backup', permission: { resource: 'config', action: 'read' }, roles: ['admin', 'owner', 'super_admin'] },
        ],
      },
      {
        id: 'qualidade',
        label: 'Qualidade',
        roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'],
        children: [
          { id: 'qa', label: 'QA', path: '/qa', permission: { resource: 'reports', action: 'read' }, hiddenInSidebar: true },
          { id: 'qa-stability', label: 'Estabilidade QA', path: '/qa/stability', permission: { resource: 'reports', action: 'read' }, hiddenInSidebar: true },
          { id: 'qa-mesh', label: 'QA Mesh', path: '/qa-mesh', permission: { resource: 'reports', action: 'read' }, hiddenInSidebar: true },
        ],
      },
      {
        id: 'super-admin',
        label: 'Super Admin',
        roles: ['super_admin'],
        children: [
          { id: 'super-admin-page', label: 'Super Admin', path: '/super-admin', roles: ['super_admin'] },
          { id: 'dev', label: 'Central Dev', path: '/dev', roles: ['super_admin'] },
          { id: 'dev-qa-waves', label: 'QA Waves', path: '/dev/qa-waves', permission: { resource: 'reports', action: 'read' }, roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'] },
          {
            id: 'dev-work-management',
            label: 'Gestão de Trabalho',
            children: [
              { id: 'dev-work-management-overview', label: 'Visão Geral', path: '/dev/work-management', permission: { resource: 'reports', action: 'read' }, roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'] },
              { id: 'dev-work-management-projects', label: 'Projetos', path: '/dev/work-management/projects', permission: { resource: 'reports', action: 'read' }, roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'] },
              { id: 'dev-work-management-board', label: 'Quadro', path: '/dev/work-management/board', permission: { resource: 'reports', action: 'read' }, roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'] },
              { id: 'dev-work-management-timeline', label: 'Linha do Tempo', path: '/dev/work-management/timeline', permission: { resource: 'reports', action: 'read' }, roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'] },
              { id: 'dev-work-management-deliverables', label: 'Entregáveis', path: '/dev/work-management/deliverables', permission: { resource: 'reports', action: 'read' }, roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'] },
              { id: 'dev-work-management-operations', label: 'Operações', path: '/dev/work-management/operations', permission: { resource: 'reports', action: 'read' }, roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'] },
              { id: 'dev-work-management-qa', label: 'QA & Validation', path: '/dev/work-management/qa-validation', permission: { resource: 'reports', action: 'read' }, roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'] },
              { id: 'dev-work-management-documents', label: 'Documentos', path: '/dev/work-management/documents', permission: { resource: 'reports', action: 'read' }, roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'] },
              { id: 'dev-work-management-team', label: 'Equipe', path: '/dev/work-management/team', permission: { resource: 'reports', action: 'read' }, roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'] },
              { id: 'dev-work-management-metrics', label: 'Métricas', path: '/dev/work-management/metrics', permission: { resource: 'reports', action: 'read' }, roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'] },
              { id: 'dev-work-management-ai-suggestions', label: 'Sugestões de IA', path: '/dev/work-management/ai-suggestions', permission: { resource: 'reports', action: 'read' }, roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'] },
            ],
          },
        ],
      },
    ],
  },
];

export const verticalWorkspaces = {
  beauty: {
    id: 'beauty',
    label: 'Beleza',
    color: '#ec4899',
    description: 'Agenda, relacionamento e receita da vertical Beauty.',
    items: [
      { id: 'vertical-dashboard-beauty', label: 'Painel Vertical', path: '/vertical/dashboard', permission: { resource: 'reports', action: 'read' } },
      { id: 'beauty-schedule', label: 'Agenda', path: '/beauty/schedule', permission: { resource: 'reports', action: 'read' } },
      { id: 'beauty-campaigns', label: 'Campanhas', path: '/beauty/campaigns', permission: { resource: 'reports', action: 'read' } },
      { id: 'beauty-leads', label: 'Leads', path: '/beauty/leads', permission: { resource: 'reports', action: 'read' } },
      { id: 'beauty-customers', label: 'Clientes', path: '/beauty/customers', permission: { resource: 'reports', action: 'read' } },
      { id: 'beauty-bundles', label: 'Bundles', path: '/beauty/bundles', permission: { resource: 'reports', action: 'read' } },
      { id: 'beauty-services', label: 'Serviços', path: '/beauty/services', permission: { resource: 'reports', action: 'read' } },
      { id: 'beauty-payments', label: 'Pagamentos', path: '/beauty/payments', permission: { resource: 'reports', action: 'read' } },
    ],
  },
  fitness: {
    id: 'fitness',
    label: 'Fitness',
    color: '#10b981',
    description: 'Adesão, frequência e retenção da vertical Fitness.',
    items: [
      { id: 'vertical-dashboard-fitness', label: 'Painel Vertical', path: '/vertical/dashboard', permission: { resource: 'reports', action: 'read' } },
      { id: 'fitness-students', label: 'Alunos', path: '/fitness/students', permission: { resource: 'reports', action: 'read' } },
      { id: 'fitness-memberships', label: 'Memberships', path: '/fitness/memberships', permission: { resource: 'reports', action: 'read' } },
      { id: 'fitness-attendance', label: 'Presença', path: '/fitness/attendance', permission: { resource: 'reports', action: 'read' } },
    ],
  },
  ecommerce: {
    id: 'ecommerce',
    label: 'Comércio Eletrônico',
    color: '#f97316',
    description: 'Catálogo, pedidos e relacionamento para operações de e-commerce.',
    items: [
      { id: 'vertical-dashboard-ecommerce', label: 'Painel Vertical', path: '/vertical/dashboard', permission: { resource: 'reports', action: 'read' } },
    ],
  },
  varejo: {
    id: 'varejo',
    label: 'Varejo',
    color: '#ef4444',
    description: 'Operação comercial e atendimento para varejo omnichannel.',
    items: [
      { id: 'vertical-dashboard-varejo', label: 'Painel Vertical', path: '/vertical/dashboard', permission: { resource: 'reports', action: 'read' } },
    ],
  },
  servicos: {
    id: 'servicos',
    label: 'Serviços',
    color: '#3b82f6',
    description: 'Agenda, execução e handover para operações baseadas em serviços.',
    items: [
      { id: 'vertical-dashboard-servicos', label: 'Painel Vertical', path: '/vertical/dashboard', permission: { resource: 'reports', action: 'read' } },
    ],
  },
  saude: {
    id: 'saude',
    label: 'Saúde',
    color: '#14b8a6',
    description: 'Triagem, agenda e relacionamento para a vertical de saúde.',
    items: [
      { id: 'vertical-dashboard-saude', label: 'Painel Vertical', path: '/vertical/dashboard', permission: { resource: 'reports', action: 'read' } },
    ],
  },
  educacao: {
    id: 'educacao',
    label: 'Educação',
    color: '#8b5cf6',
    description: 'Onboarding, jornada e retenção para operações de educação.',
    items: [
      { id: 'vertical-dashboard-educacao', label: 'Painel Vertical', path: '/vertical/dashboard', permission: { resource: 'reports', action: 'read' } },
    ],
  },
  financeiro: {
    id: 'financeiro',
    label: 'Financeiro',
    color: '#eab308',
    description: 'Cobrança, recuperação e relacionamento para serviços financeiros.',
    items: [
      { id: 'vertical-dashboard-financeiro', label: 'Painel Vertical', path: '/vertical/dashboard', permission: { resource: 'reports', action: 'read' } },
    ],
  },
  cobranca: {
    id: 'cobranca',
    label: 'Cobrança',
    color: '#f59e0b',
    description: 'Negociação e recuperação para operações de cobrança.',
    items: [
      { id: 'vertical-dashboard-cobranca', label: 'Painel Vertical', path: '/vertical/dashboard', permission: { resource: 'reports', action: 'read' } },
    ],
  },
};

const VERTICAL_INFERENCE_RULES = {
  beauty: [
    'beauty',
    'beleza',
    'salao',
    'salão',
    'estetica',
    'estética',
    'spa',
    'barbearia',
    'cosmetica',
    'cosmética',
    'cabeleireiro',
    'cabelo',
    'manicure',
  ],
  fitness: [
    'fitness',
    'academia',
    'gym',
    'musculacao',
    'musculação',
    'pilates',
    'crossfit',
    'wellness',
    'treino',
    'personal',
  ],
  ecommerce: ['ecommerce', 'e-commerce', 'loja virtual', 'marketplace', 'checkout', 'carrinho'],
  varejo: ['varejo', 'retail', 'loja fisica', 'loja física', 'pdv'],
  servicos: ['servicos', 'serviços', 'agencia', 'agência', 'consultoria', 'prestacao de servicos', 'prestação de serviços'],
  saude: ['saude', 'saúde', 'clinica', 'clínica', 'hospital', 'odontologia', 'medicina'],
  educacao: ['educacao', 'educação', 'escola', 'curso', 'ensino', 'aluno'],
  financeiro: ['financeiro', 'financeira', 'banco', 'fintech', 'credito', 'crédito'],
  cobranca: ['cobranca', 'cobrança', 'negociacao', 'negociação', 'recuperacao', 'recuperação'],
};

const VERTICAL_ALIAS_RULES = {
  beauty: ['beauty', 'beleza', 'salao', 'salão', 'estetica', 'estética', 'spa', 'barbearia'],
  fitness: ['fitness', 'academia', 'gym', 'musculacao', 'musculação', 'pilates', 'crossfit', 'wellness'],
  ecommerce: ['ecommerce', 'e-commerce'],
  varejo: ['varejo', 'retail'],
  servicos: ['servicos', 'serviços'],
  saude: ['saude', 'saúde'],
  educacao: ['educacao', 'educação'],
  financeiro: ['financeiro', 'financeira', 'fintech'],
  cobranca: ['cobranca', 'cobrança'],
};

function normalizeVerticalAlias(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;

  for (const [workspaceKey, aliases] of Object.entries(VERTICAL_ALIAS_RULES)) {
    if (aliases.includes(normalized)) {
      return workspaceKey;
    }
  }

  return null;
}

function inferWorkspaceKeyFromTenantSettings(tenant) {
  if (!tenant || typeof tenant !== 'object') return null;

  const settings = tenant.settings && typeof tenant.settings === 'object'
    ? tenant.settings
    : {};

  return normalizeVerticalAlias(settings.vertical)
    || normalizeVerticalAlias(settings.segment)
    || normalizeVerticalAlias(settings.industry)
    || null;
}

function collectTenantVerticalSignals(tenantContext) {
  if (!tenantContext || typeof tenantContext !== 'object') return '';

  const signals = [
    tenantContext.ramo_atividade,
    tenantContext.objetivo,
    tenantContext.site_oficial,
    Array.isArray(tenantContext.escopo) ? tenantContext.escopo.join(' ') : '',
  ];

  return signals
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function inferWorkspaceKeyFromTenantContext(tenantContext) {
  const haystack = collectTenantVerticalSignals(tenantContext);
  if (!haystack) return null;

  for (const [workspaceKey, keywords] of Object.entries(VERTICAL_INFERENCE_RULES)) {
    if (keywords.some((keyword) => haystack.includes(keyword))) {
      return workspaceKey;
    }
  }

  return null;
}

export function inferWorkspaceKeyFromTenantProfile(tenantProfile) {
  if (!tenantProfile || typeof tenantProfile !== 'object') return null;

  return inferWorkspaceKeyFromTenantSettings(tenantProfile.tenant)
    || inferWorkspaceKeyFromTenantContext(tenantProfile.context)
    || null;
}

export function getWorkspaceKeysForPath(currentPath, options = {}) {
  const { tenantContext = null, tenantProfile = null, includeAllVerticals = false } = options;
  const normalized = normalizeNavigationPath(currentPath);

  if (normalized.startsWith('/beauty/')) return ['beauty'];
  if (normalized.startsWith('/fitness/')) return ['fitness'];

  if (normalized === '/vertical/dashboard') {
    if (includeAllVerticals) {
      return Object.keys(verticalWorkspaces);
    }

    const inferredWorkspace = inferWorkspaceKeyFromTenantProfile(tenantProfile)
      || inferWorkspaceKeyFromTenantContext(tenantContext);
    return [inferredWorkspace || 'beauty'];
  }

  return [];
}

export function normalizeNavigationPath(path) {
  if (!path || typeof path !== 'string') return '/';
  const cleaned = path.split('?')[0].split('#')[0];
  if (cleaned.startsWith('/r-agent2/')) {
    const withoutBase = cleaned.substring('/r-agent2'.length);
    return withoutBase || '/';
  }
  if (cleaned.length > 1 && cleaned.endsWith('/')) {
    return cleaned.slice(0, -1);
  }
  return cleaned;
}

export function pathMatches(basePath, currentPath) {
  const base = normalizeNavigationPath(basePath);
  const current = normalizeNavigationPath(currentPath);
  return current === base || (base !== '/' && current.startsWith(`${base}/`));
}

export function flattenNavigationNodes(nodes, items = []) {
  nodes.forEach((node) => {
    items.push(node);
    if (Array.isArray(node.children) && node.children.length > 0) {
      flattenNavigationNodes(node.children, items);
    }
  });
  return items;
}

export function flattenNavigationLeaves(nodes, items = []) {
  nodes.forEach((node) => {
    if (node.path) {
      items.push(node);
    }
    if (Array.isArray(node.children) && node.children.length > 0) {
      flattenNavigationLeaves(node.children, items);
    }
  });
  return items;
}

export function findNavigationTrail(nodes, currentPath, trail = []) {
  for (const node of nodes) {
    const nextTrail = [...trail, node];
    if (node.path && pathMatches(node.path, currentPath)) {
      if (Array.isArray(node.children) && node.children.length > 0) {
        const deeper = findNavigationTrail(node.children, currentPath, nextTrail);
        if (deeper.length > 0) return deeper;
      }
      return nextTrail;
    }
    if (Array.isArray(node.children) && node.children.length > 0) {
      const nested = findNavigationTrail(node.children, currentPath, nextTrail);
      if (nested.length > 0) return nested;
    }
  }
  return [];
}

export function getTopLevelNode(nodes, currentPath) {
  const trail = findNavigationTrail(nodes, currentPath);
  return trail[0] || null;
}

export function getWorkspaceForPath(currentPath) {
  return getWorkspaceKeysForPath(currentPath)[0] || null;
}

export function getAllNavigationEntries() {
  return flattenNavigationLeaves(navigationMenu);
}

export function getRouteCatalog(nodes = navigationMenu) {
  return flattenNavigationLeaves(nodes, []).map((entry) => ({
    id: entry.id,
    label: entry.label,
    path: entry.path,
    permission: entry.permission || null,
    roles: Array.isArray(entry.roles) ? entry.roles : null,
    hiddenInSidebar: Boolean(entry.hiddenInSidebar),
    hiddenInSubNav: Boolean(entry.hiddenInSubNav),
  }));
}
