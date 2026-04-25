export const navigationMenu = [
  {
    id: 'cockpit',
    label: 'Cockpit',
    icon: '◉',
    path: '/dashboard',
    description: 'Visao geral do sistema e fila de trabalho.',
    children: [
      {
        id: 'dashboard-legacy',
        label: 'Dashboard Legado',
        path: '/dashboard-legacy',
        description: 'Hub antigo com catalogo completo de funcionalidades.',
        hiddenInSidebar: true,
        keywords: ['dashboard antigo', 'hub antigo', 'dashboard legado'],
      },
    ],
  },
  {
    id: 'relacionamento',
    label: 'Relacionamento',
    icon: '◎',
    path: '/support',
    description: 'Atendimento, CRM e comunicacao.',
    children: [
      {
        id: 'atendimento',
        label: 'Atendimento',
        children: [
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
            label: 'Manutencao',
            path: '/maintenance',
            permission: { resource: 'tickets', action: 'list_all' },
            hiddenInSidebar: true,
          },
          {
            id: 'quick-replies',
            label: 'Respostas Rapidas',
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
          { id: 'crm-analytics', label: 'Analises CRM', path: '/crm/analytics', permission: { resource: 'crm', action: 'read' }, hiddenInSubNav: true },
          { id: 'crm-reports', label: 'Relatorios CRM', path: '/crm/reports', permission: { resource: 'crm', action: 'read' }, hiddenInSubNav: true },
          { id: 'crm-campaigns', label: 'Campanhas CRM', path: '/crm/campaigns', permission: { resource: 'crm', action: 'read' }, hiddenInSubNav: true },
          { id: 'crm-webhooks', label: 'Webhooks do CRM', path: '/crm/webhooks', permission: { resource: 'crm', action: 'read' }, hiddenInSubNav: true },
          { id: 'crm-rbac', label: 'RBAC CRM', path: '/crm/rbac', permission: { resource: 'crm', action: 'read' }, hiddenInSubNav: true },
          { id: 'crm-audit', label: 'Auditoria CRM', path: '/crm/audit', permission: { resource: 'crm', action: 'read' }, hiddenInSubNav: true },
        ],
      },
      {
        id: 'canais-mensageria',
        label: 'Canais e Conteudo',
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
    label: 'Operacao',
    icon: '△',
    path: '/supervisor',
    description: 'Execucao, monitoramento e canais.',
    children: [
      {
        id: 'operacao-monitoramento',
        label: 'Monitoramento',
        children: [
          { id: 'supervisor', label: 'Supervisor', path: '/supervisor', permission: { resource: 'reports', action: 'read' }, roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'] },
          { id: 'operations-dashboard', label: 'Painel Operacional', path: '/operations-dashboard', permission: { resource: 'reports', action: 'read' }, roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'] },
          { id: 'analytics', label: 'Analytics', path: '/analytics', permission: { resource: 'reports', action: 'read' } },
          { id: 'tenant-intelligence', label: 'Tenant Intelligence', path: '/tenant-intelligence', permission: { resource: 'reports', action: 'read' } },
          { id: 'channel-health', label: 'Saude de Canais', path: '/channel-health', permission: { resource: 'config', action: 'read' }, roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'] },
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
          { id: 'whatsapp-connections', label: 'Conexoes WhatsApp', path: '/whatsapp-connections', permission: { resource: 'config', action: 'update' }, roles: ['admin', 'owner', 'manager', 'supervisor', 'super_admin'] },
          { id: 'whatsapp-ivr', label: 'URA WhatsApp', path: '/whatsapp-ivr', permission: { resource: 'config', action: 'update' }, roles: ['admin', 'owner', 'manager', 'supervisor', 'super_admin'] },
          { id: 'chat-humano', label: 'Cockpit Chat Humano', path: '/chat-humano', permission: { resource: 'reports', action: 'read' }, roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'], hiddenInSidebar: true },
          { id: 'fila-fisica', label: 'Fila Fisica', path: '/fila-fisica', permission: { resource: 'reports', action: 'read' }, roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'], hiddenInSidebar: true },
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
    label: 'Automacao',
    icon: '□',
    path: '/editor',
    description: 'Fluxos, orquestracao e execucao.',
    children: [
      {
        id: 'design',
        label: 'Modelagem',
        children: [
          { id: 'editor', label: 'Editor de Fluxos', path: '/editor', permission: { resource: 'flows', action: 'read' }, roles: ['supervisor', 'admin', 'super_admin'] },
          { id: 'bpmn-editor', label: 'Editor BPMN', path: '/bpmn-editor', permission: { resource: 'flows', action: 'read' }, roles: ['supervisor', 'admin', 'super_admin'] },
          { id: 'node-marketplace', label: 'Mercado de Nodes', path: '/node-marketplace', permission: { resource: 'config', action: 'read' }, roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'] },
          { id: 'solutions', label: 'Pacotes de Solucao', path: '/solutions', permission: { resource: 'config', action: 'read' }, roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'] },
        ],
      },
      {
        id: 'execucao',
        label: 'Execucao',
        children: [
          { id: 'automations', label: 'Automacoes', path: '/automations', permission: { resource: 'config', action: 'update' }, roles: ['admin', 'owner', 'manager', 'supervisor', 'super_admin'] },
          { id: 'projects', label: 'Projetos', path: '/projects', permission: { resource: 'projects', action: 'read' }, roles: ['operator', 'manager', 'admin', 'owner', 'supervisor', 'super_admin'] },
          { id: 'tasks', label: 'Tarefas', path: '/tasks', permission: { resource: 'config', action: 'update' }, roles: ['admin', 'owner', 'manager', 'supervisor', 'super_admin'] },
          { id: 'generate-system', label: 'Gerar Sistema', path: '/generate-system', permission: { resource: 'config', action: 'read' }, hiddenInSidebar: true },
          { id: 'rpa-test', label: 'Teste RPA', path: '/rpa-test', permission: { resource: 'flows', action: 'read' }, hiddenInSidebar: true },
          { id: 'rpa-replays', label: 'Replays RPA', path: '/rpa-replays', permission: { resource: 'flows', action: 'read' }, hiddenInSidebar: true },
          { id: 'rpa-seeds', label: 'Seeds RPA', path: '/rpa-seeds', permission: { resource: 'flows', action: 'read' }, hiddenInSidebar: true },
          { id: 'chat', label: 'Chat de Teste', path: '/chat', permission: { resource: 'tickets', action: 'read' }, hiddenInSidebar: true },
        ],
      },
      {
        id: 'assistentes',
        label: 'Assistentes',
        children: [
          { id: 'ai-tools', label: 'Ferramentas de IA', path: '/ai-tools', permission: { resource: 'tickets', action: 'read' } },
          { id: 'segmentation', label: 'Segmentacao', path: '/segmentation', permission: { resource: 'tickets', action: 'read' } },
        ],
      },
    ],
  },
  {
    id: 'inteligencia',
    label: 'Inteligencia',
    icon: '◇',
    path: '/knowledge-base',
    description: 'Conhecimento, RAG e documentacao.',
    children: [
      {
        id: 'conhecimento',
        label: 'Conhecimento',
        children: [
          { id: 'faq', label: 'Perguntas Frequentes', path: '/faq', permission: { resource: 'rag', action: 'update' } },
          { id: 'knowledge-base', label: 'Base de Conhecimento', path: '/knowledge-base', permission: { resource: 'rag', action: 'read' } },
          { id: 'product-docs', label: 'Documentacao de Produto', path: '/product-docs', permission: { resource: 'rag', action: 'read' } },
          { id: 'rag-documents', label: 'Documentos RAG', path: '/rag-documents', permission: { resource: 'rag', action: 'read' } },
          { id: 'web-scraping', label: 'Raspagem de Sites', path: '/web-scraping', permission: { resource: 'rag', action: 'create' } },
        ],
      },
      {
        id: 'governed-insights',
        label: 'Analises Governadas',
        roles: ['admin', 'owner', 'super_admin'],
        children: [
          { id: 'export', label: 'Exportacao', path: '/export', permission: { resource: 'reports', action: 'export' }, roles: ['supervisor', 'admin', 'super_admin'] },
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
    description: 'Workspaces por vertical.',
    roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'],
    children: [
      {
        id: 'vertical-hub',
        label: 'Hub Vertical',
        children: [
          { id: 'vertical-dashboard', label: 'Cockpit Vertical', path: '/vertical/dashboard', permission: { resource: 'reports', action: 'read' } },
        ],
      },
    ],
  },
  {
    id: 'plataforma',
    label: 'Plataforma',
    icon: '▤',
    path: '/config',
    description: 'Configuracao, governanca e administracao.',
    children: [
      {
        id: 'administracao',
        label: 'Administracao',
        children: [
          { id: 'config', label: 'Configuracao', path: '/config', permission: { resource: 'config', action: 'read' } },
          { id: 'agents', label: 'Agentes', path: '/agents', permission: { resource: 'agents', action: 'list_all' } },
          { id: 'onboarding', label: 'Onboarding', path: '/onboarding', permission: { resource: 'tenant', action: 'read' } },
          { id: 'tenants', label: 'Tenants', path: '/tenants', permission: { resource: 'tenant', action: 'read' }, roles: ['owner', 'admin', 'super_admin'] },
          { id: 'mfa', label: 'MFA', path: '/mfa', permission: { resource: 'config', action: 'update' }, roles: ['admin', 'owner', 'manager', 'supervisor', 'super_admin'] },
          { id: 'developer-keys', label: 'Developer Keys', path: '/developer-keys', permission: { resource: 'config', action: 'read' }, roles: ['admin', 'owner', 'manager', 'supervisor', 'super_admin'] },
          { id: 'agenda', label: 'Agenda', path: '/agenda', permission: { resource: 'reports', action: 'read' }, roles: ['admin', 'owner', 'manager', 'supervisor', 'super_admin'], hiddenInSidebar: true },
          { id: 'sla-policies', label: 'SLA', path: '/sla-policies', permission: { resource: 'reports', action: 'read' }, roles: ['admin', 'owner', 'manager', 'supervisor', 'super_admin'] },
        ],
      },
      {
        id: 'governanca',
        label: 'Governanca',
        roles: ['admin', 'owner', 'super_admin'],
        children: [
          { id: 'access-control', label: 'Controle de Acesso', path: '/access-control', permission: { resource: 'config', action: 'read' }, roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'] },
          { id: 'rbac', label: 'RBAC', path: '/rbac', permission: { resource: 'agents', action: 'update' }, roles: ['admin', 'owner', 'super_admin'] },
          { id: 'audit', label: 'Auditoria', path: '/audit', permission: { resource: 'audit', action: 'read' } },
          { id: 'sso-scim', label: 'SSO / SCIM', path: '/sso-scim', permission: { resource: 'config', action: 'read' }, roles: ['admin', 'owner', 'super_admin'] },
          { id: 'backup', label: 'Backup / DR', path: '/backup', permission: { resource: 'config', action: 'read' }, roles: ['admin', 'owner', 'super_admin'] },
        ],
      },
      {
        id: 'qualidade',
        label: 'Qualidade',
        roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'],
        children: [
          { id: 'qa', label: 'QA', path: '/qa', permission: { resource: 'reports', action: 'read' }, hiddenInSidebar: true },
          { id: 'qa-stability', label: 'QA Stability', path: '/qa/stability', permission: { resource: 'reports', action: 'read' }, hiddenInSidebar: true },
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
            label: 'Work Management',
            children: [
              { id: 'dev-work-management-overview', label: 'Overview', path: '/dev/work-management', permission: { resource: 'reports', action: 'read' }, roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'] },
              { id: 'dev-work-management-projects', label: 'Projects', path: '/dev/work-management/projects', permission: { resource: 'reports', action: 'read' }, roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'] },
              { id: 'dev-work-management-board', label: 'Board', path: '/dev/work-management/board', permission: { resource: 'reports', action: 'read' }, roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'] },
              { id: 'dev-work-management-timeline', label: 'Timeline', path: '/dev/work-management/timeline', permission: { resource: 'reports', action: 'read' }, roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'] },
              { id: 'dev-work-management-deliverables', label: 'Deliverables', path: '/dev/work-management/deliverables', permission: { resource: 'reports', action: 'read' }, roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'] },
              { id: 'dev-work-management-operations', label: 'Operations', path: '/dev/work-management/operations', permission: { resource: 'reports', action: 'read' }, roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'] },
              { id: 'dev-work-management-qa', label: 'QA & Validation', path: '/dev/work-management/qa-validation', permission: { resource: 'reports', action: 'read' }, roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'] },
              { id: 'dev-work-management-documents', label: 'Documents', path: '/dev/work-management/documents', permission: { resource: 'reports', action: 'read' }, roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'] },
              { id: 'dev-work-management-team', label: 'Team', path: '/dev/work-management/team', permission: { resource: 'reports', action: 'read' }, roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'] },
              { id: 'dev-work-management-metrics', label: 'Metrics', path: '/dev/work-management/metrics', permission: { resource: 'reports', action: 'read' }, roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'] },
              { id: 'dev-work-management-ai-suggestions', label: 'AI Suggestions', path: '/dev/work-management/ai-suggestions', permission: { resource: 'reports', action: 'read' }, roles: ['supervisor', 'manager', 'admin', 'owner', 'super_admin'] },
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
      { id: 'beauty-services', label: 'Servicos', path: '/beauty/services', permission: { resource: 'reports', action: 'read' } },
      { id: 'beauty-payments', label: 'Pagamentos', path: '/beauty/payments', permission: { resource: 'reports', action: 'read' } },
    ],
  },
  fitness: {
    id: 'fitness',
    label: 'Fitness',
    color: '#10b981',
    description: 'Adesao, frequencia e retencao da vertical Fitness.',
    items: [
      { id: 'vertical-dashboard-fitness', label: 'Painel Vertical', path: '/vertical/dashboard', permission: { resource: 'reports', action: 'read' } },
      { id: 'fitness-students', label: 'Alunos', path: '/fitness/students', permission: { resource: 'reports', action: 'read' } },
      { id: 'fitness-memberships', label: 'Memberships', path: '/fitness/memberships', permission: { resource: 'reports', action: 'read' } },
      { id: 'fitness-attendance', label: 'Presenca', path: '/fitness/attendance', permission: { resource: 'reports', action: 'read' } },
    ],
  },
  ecommerce: {
    id: 'ecommerce',
    label: 'Comercio Eletronico',
    color: '#f97316',
    description: 'Catalogo, pedidos e relacionamento para operacoes de e-commerce.',
    items: [
      { id: 'vertical-dashboard-ecommerce', label: 'Painel Vertical', path: '/vertical/dashboard', permission: { resource: 'reports', action: 'read' } },
    ],
  },
  varejo: {
    id: 'varejo',
    label: 'Varejo',
    color: '#ef4444',
    description: 'Operacao comercial e atendimento para varejo omnichannel.',
    items: [
      { id: 'vertical-dashboard-varejo', label: 'Painel Vertical', path: '/vertical/dashboard', permission: { resource: 'reports', action: 'read' } },
    ],
  },
  servicos: {
    id: 'servicos',
    label: 'Servicos',
    color: '#3b82f6',
    description: 'Agenda, execucao e handover para operacoes baseadas em servicos.',
    items: [
      { id: 'vertical-dashboard-servicos', label: 'Painel Vertical', path: '/vertical/dashboard', permission: { resource: 'reports', action: 'read' } },
    ],
  },
  saude: {
    id: 'saude',
    label: 'Saude',
    color: '#14b8a6',
    description: 'Triagem, agenda e relacionamento para a vertical de saude.',
    items: [
      { id: 'vertical-dashboard-saude', label: 'Painel Vertical', path: '/vertical/dashboard', permission: { resource: 'reports', action: 'read' } },
    ],
  },
  educacao: {
    id: 'educacao',
    label: 'Educacao',
    color: '#8b5cf6',
    description: 'Onboarding, jornada e retencao para operacoes de educacao.',
    items: [
      { id: 'vertical-dashboard-educacao', label: 'Painel Vertical', path: '/vertical/dashboard', permission: { resource: 'reports', action: 'read' } },
    ],
  },
  financeiro: {
    id: 'financeiro',
    label: 'Financeiro',
    color: '#eab308',
    description: 'Cobranca, recuperacao e relacionamento para servicos financeiros.',
    items: [
      { id: 'vertical-dashboard-financeiro', label: 'Painel Vertical', path: '/vertical/dashboard', permission: { resource: 'reports', action: 'read' } },
    ],
  },
  cobranca: {
    id: 'cobranca',
    label: 'Cobranca',
    color: '#f59e0b',
    description: 'Negociacao e recuperacao para operacoes de cobranca.',
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
