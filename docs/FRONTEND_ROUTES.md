# Rotas do Frontend

Atualizado em 2026-08-03. Fonte: `frontend/src/main.jsx`, `frontend/src/navigation/menu.js` e rotas contextuais de projetos/storefront.

## Rotas públicas

| Rota | Descrição |
| --- | --- |
| `/` | Landing pública SaaS quando o usuário não está autenticado; dashboard quando autenticado. |
| `/login` | Tela de autenticação. |
| `/saas` | Landing pública do produto SaaS. |
| `/saas/products` | Página pública de produtos SaaS. |
| `/saas/solutions` | Página pública de soluções SaaS. |
| `/saas/pricing` | Página pública de preços. |
| `/saas/signup` | Página pública de criação de conta. |
| `/storefront/order` | Checkout/pedido público do storefront. |
| `/storefront/order/:id` | Status público de um pedido do storefront. |
| `/kiosk` | Interface pública de quiosque. |
| `/panel` | Painel público operacional. |
| `/station` | Interface pública de estação. |

## Rotas autenticadas

| Rota | Descrição |
| --- | --- |
| `/workspace` | RAP Workspace com visão 360 do cliente, timeline, ações e insights. |
| `/dashboard` | Dashboard operacional atual. |
| `/dashboard-legacy` | Dashboard legado com catálogo antigo de funcionalidades. |
| `/support` | Central de atendimento e conversas. |
| `/inbox` | Caixa de entrada de tickets/conversas. |
| `/maintenance` | Manutenção administrativa de tickets. |
| `/quick-replies` | Gestão de respostas rápidas. |
| `/departments` | Gestão de departamentos. |
| `/failed-messages` | Monitoramento de falhas de entrega. |
| `/whatsapp-templates` | Templates WhatsApp Business API. |
| `/bulk-messaging` | Disparos em massa. |
| `/marketing` | Rotinas e ativos de marketing. |
| `/crm` | Painel principal do CRM. |
| `/crm/dashboard` | Alias do painel principal do CRM. |
| `/crm/accounts` | Contas do CRM. |
| `/crm/contacts` | Contatos do CRM. |
| `/crm/leads` | Leads do CRM. |
| `/crm/pipelines` | Pipelines comerciais. |
| `/crm/opportunities` | Oportunidades comerciais. |
| `/crm/activities` | Atividades comerciais. |
| `/crm/analytics` | Análises do CRM. |
| `/crm/reports` | Relatórios do CRM. |
| `/crm/campaigns` | Campanhas do CRM. |
| `/crm/webhooks` | Webhooks do CRM. |
| `/crm/rbac` | Permissões/RBAC do CRM. |
| `/crm/audit` | Auditoria do CRM. |
| `/supervisor` | Painel supervisor. |
| `/operations-dashboard` | Painel operacional. |
| `/analytics` | Análises e métricas. |
| `/tenant-intelligence` | Inteligência do tenant. |
| `/channel-health` | Saúde dos canais. |
| `/system-status` | Alias legado de `/dev/system-status` (status dos serviços). |
| `/plan-usage` | Plano e consumo. |
| `/orders` | Pedidos operacionais. |
| `/kitchen` | Operação de cozinha. |
| `/dispatch` | Operação de despacho. |
| `/channel-accounts` | Contas de canal. |
| `/whatsapp-connections` | Conexões WhatsApp/QR. |
| `/whatsapp-ivr` | URA WhatsApp. |
| `/chat-humano` | Dashboard de chat humano. |
| `/fila-fisica` | Dashboard de fila física. |
| `/pbx` | Painel PBX. |
| `/pbx/extensions` | Ramais PBX. |
| `/pbx/trunks` | Troncos PBX. |
| `/pbx/routes` | Rotas PBX. |
| `/pbx/acls` | ACLs PBX. |
| `/pbx/dids` | DIDs PBX. |
| `/pbx/ivr` | IVR PBX. |
| `/pbx/queues` | Filas PBX. |
| `/pbx/queue-members` | Membros de filas PBX. |
| `/pbx/dialplan` | Dialplan PBX. |
| `/pbx/media` | Mídia PBX. |
| `/pbx/recordings` | Gravações PBX. |
| `/pbx/cdr` | CDR PBX. |
| `/pbx/governance` | Governança PBX. |
| `/pbx/cc/pause-reasons` | Motivos de pausa de contact center. |
| `/pbx/cc/contact-reasons` | Motivos de contato de contact center. |
| `/pbx/cc/campaigns` | Campanhas de contact center. |
| `/pbx/cc/campaign-list` | Lista de campanha de contact center. |
| `/pbx/cc/callbacks` | Callbacks de contact center. |
| `/pbx/cc/click2call` | Click2Call de contact center. |
| `/pbx/referencia/xml` | Referência XML PBX. |
| `/editor` | Editor visual de fluxos. |
| `/bpmn-editor` | Editor BPMN. |
| `/node-marketplace` | Mercado de nodes. |
| `/solutions` | Pacotes de solução. |
| `/automations` | Automações. |
| `/projects` | Lista de projetos. |
| `/projects/:id` | Quadro do projeto. |
| `/projects/:id/list` | Lista do projeto. |
| `/projects/:id/dashboard` | Painel do projeto. |
| `/projects/:id/timeline` | Linha do tempo do projeto. |
| `/projects/:id/gantt` | Gantt do projeto. |
| `/projects/:id/calendar` | Calendário do projeto. |
| `/projects/:id/activities` | Atividades do projeto. |
| `/projects/:id/settings` | Configurações do projeto. |
| `/tasks` | Tarefas. |
| `/agenda` | Agenda. |
| `/sla-policies` | Políticas de SLA. |
| `/generate-system` | Geração de sistema/fluxo/RPA/seed. |
| `/dev/rpa-test` | Execução de testes RPA. |
| `/dev/rpa-replays` | Replays RPA (rota canônica; `/rpa-replays` é alias). |
| `/dev/rpa-seeds` | Seeds RPA (rota canônica; `/rpa-seeds` é alias legado). |
| `/chat` | Chat de teste. |
| `/ai-tools` | Ferramentas de IA. |
| `/segmentation` | Segmentação. |
| `/faq` | Perguntas frequentes. |
| `/knowledge-base` | Base de conhecimento. |
| `/product-docs` | Documentação de produto. |
| `/rag-documents` | Documentos RAG. |
| `/web-scraping` | Raspagem de sites. |
| `/qa` | Painel de qualidade. |
| `/qa/stability` | Estabilidade QA. |
| `/qa-mesh` | Malha unificada de execução QA. |
| `/export` | Exportação de dados. |
| `/vertical/dashboard` | Painel vertical. |
| `/beauty/schedule` | Agenda da vertical Beleza. |
| `/beauty/campaigns` | Campanhas da vertical Beleza. |
| `/beauty/leads` | Leads da vertical Beleza. |
| `/beauty/customers` | Clientes da vertical Beleza. |
| `/beauty/bundles` | Bundles da vertical Beleza. |
| `/beauty/services` | Serviços da vertical Beleza. |
| `/beauty/payments` | Pagamentos da vertical Beleza. |
| `/fitness/students` | Alunos da vertical Fitness. |
| `/fitness/memberships` | Memberships da vertical Fitness. |
| `/fitness/attendance` | Presença da vertical Fitness. |
| `/config` | Configuração do sistema. |
| `/agents` | Gestão de agentes. |
| `/onboarding` | Onboarding do tenant. |
| `/tenants` | Organizações/tenants. |
| `/mfa` | Configuração de MFA. |
| `/developer-keys` | Chaves de desenvolvedor/API. |
| `/access-control` | Controle de acesso. |
| `/rbac` | RBAC da plataforma. |
| `/audit` | Auditoria. |
| `/sso-scim` | SSO/SCIM. |
| `/backup` | Backup e recuperação. |
| `/super-admin` | Painel de super-admin. |
| `/dev` | Central de desenvolvimento. |
| `/dev-dashboard` | Alias da central de desenvolvimento. |
| `/dev/system-status` | Status dos serviços (rota canônica). |
| `/dev/qa-waves` | QA Waves integrado. |
| `/dev/qa-waves/operational-health` | QA Waves: saúde operacional. |
| `/dev/qa-waves/enterprise-governance` | QA Waves: governança enterprise. |
| `/dev/qa-audit` | Auditoria QA. |
| `/dev/qa-gaps` | Gaps operacionais de QA. |

## Observações de navegação

- O rail primário usa macroáreas derivadas de `navigationMenu` e `workspaceAreas`.
- O menu secundário lista as rotas da macroárea ativa e agora também pode exibir rotas marcadas apenas como ocultas do rail.
- Rotas públicas não entram no rail autenticado por desenho.
- Rotas PBX sob `/pbx/*` que não têm página dedicada usam o módulo genérico `PbxModulePage`.
- Rotas com prefixo `/dev` (e aliases `/rpa-replays`, `/rpa-seeds`, `/system-status`) são classificadas DEVELOPMENT pela política de segregação de experiência (`api/modules/agent-os/experience-segregation.js`): ficam ocultas para PRODUCTION, e o guard `frontend/src/utils/menuPermissions.js` (`PROTECTED_PATH_PREFIXES`) exige `super_admin` mesmo em acesso direto por URL. A segregação é in-app (mesma SPA/API); não existe app separado para suporte/dev.
- A Gestão de Trabalho (antigas rotas `/dev/work-management*`) foi extraída da SPA em 2026-07-28 para o app standalone de engenharia `dev/work-management/` (Vite, porta 5177), desconectado do pacote operacional e fora do pipeline de release.
