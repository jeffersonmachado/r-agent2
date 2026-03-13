# Mapa de UI por Épico (O_QUE_FALTA)

Gerado automaticamente a partir de `docs/O_QUE_FALTA.md`.

## Epicos

- Core (eventos + execução)
- (sem UI mapeada)

- Suites verticais (MVP→v1 operacional)
- Cobertura: parcial
- PbxPage.jsx
- UI gaps:
- painel admin de filas (CRUD, multi-unidade), métricas completas por unidade/estação e auditoria operacional.
- dashboards operacionais (KPIs order_to_ready/order_to_deliver), incidentes com trilha auditável e filtros avançados.
- cobertura completa de provisionamento (tokens/expiração), auditoria e operações avançadas.

- Marketing (v1 completo)
- Cobertura: parcial
- MarketingPage.jsx
- UI gaps:
- jornadas/funil visual completo e gestão avançada de campanhas.

- Voz (base técnica entregue)
- (sem UI mapeada)

- RPA Flow Pipeline (base entregue)
- (sem UI mapeada)

- SaaS e governança (base enterprise já entregue)
- Cobertura: parcial
- TenantsPage.jsx
- SuperAdminPage.jsx
- PlanUsagePage.jsx
- SsoScimPage.jsx
- BackupPage.jsx
- UI gaps:
- governança granular (roles/permissões detalhadas) e dashboards completos de uso por tenant.

- Hardening de IA (contratos + safe-mode)
- (sem UI mapeada)

- Integrações de plataforma (base)
- (sem UI mapeada)

- Analytics e marketplace (primeiro corte)
- Cobertura: parcial
- AnalyticsPage.jsx
- NodeMarketplacePage.jsx
- UI gaps:
- atribuição/ROI avançado, custos operacionais por canal e dashboards completos por suíte.

- Governança enterprise (primeiro corte)
- Cobertura: total
- SsoScimPage.jsx
- BackupPage.jsx

- Gate operacional
- (sem UI mapeada)

- Entregas concluídas (ex-backlog)
- (sem UI mapeada)

- P0.1 Inbox multiatendente (lista, assumir, transferir, tags, notas, respostas rápidas)
- Cobertura: total
- InboxPage.jsx
- SupportPage.jsx
- QuickRepliesPage.jsx
- TicketMaintenancePage.jsx
- UI gaps:
- (nenhum)

- P0.2 Painel supervisor com métricas (TME, TMA, abandono, por agente/fila/período)
- Cobertura: parcial
- SupervisorPage.jsx
- UI gaps:
- exportação dedicada e gráficos avançados (opcional).

- P0.3 RBAC completo (admin/supervisor/agente)
- Cobertura: parcial
- RbacPage.jsx
- UI gaps:
- guardas adicionais por módulo/ação (opcional).

- P0.4 MFA funcional
- Cobertura: parcial
- MfaPage.jsx
- UI gaps:
- QR code visual (opcional).

- P0.5 Auditoria de ações
- Cobertura: total
- AuditPage.jsx

- P0.6 Mascaramento de telefone
- Cobertura: total
- ConfigPage.jsx
- InboxPage.jsx
- SupportPage.jsx
- TicketMaintenancePage.jsx
- UI gaps:
- (nenhum)

- P0.7 Wizard de onboarding (WhatsApp, filas, usuários)
- Cobertura: total
- OnboardingPage.jsx

- P1.1 Widgets + links rastreáveis (source/campaign)
- Cobertura: parcial
- MarketingPage.jsx
- UI gaps:
- painel de performance avançado (opcional).

- P1.2 URA WhatsApp empacotada (UI simples, departamentos)
- Cobertura: parcial
- WhatsAppIvrPage.jsx
- UI gaps:
- wizard guiado e integrações avançadas (opcional).

- P1.3 Conexão WhatsApp via QR (além da Cloud API)
- Cobertura: total
- WhatsAppConnectionsPage.jsx
- UI gaps:
- QR code visual (opcional).

- P2.1 IA operacional (resumo, sugestão, intenção, sentimento)
- Cobertura: parcial
- SupportPage.jsx

- P2.2 API pública com API Keys + rate limit
- Cobertura: parcial
- DeveloperKeysPage.jsx
- UI gaps:
- relatórios avançados por rota e alertas (opcional).

- P2.3 Automações low-code
- Cobertura: parcial
- AutomationsPage.jsx
- UI gaps:
- builder visual completo com drag-and-drop (opcional).

- P2.4 SLA por cliente
- Cobertura: parcial
- SlaPoliciesPage.jsx
- UI gaps:
- visão detalhada por cliente e alertas (opcional).

- P2.5 Lembretes e tarefas
- Cobertura: parcial
- TasksPage.jsx
- UI gaps:
- calendário e lembretes avançados (opcional).

- Now (0–3 meses) — hardening para v1 vendável (suíte operável)
- (sem UI mapeada)

- Next (3–6 meses) — produto inicial por suíte + analytics/ROI v1
- (sem UI mapeada)

- Next (6–12 meses) — consolidação core + PBX/voz v1
- (sem UI mapeada)

- 3.1 Gate mínimo de CI/Stack
- (sem UI mapeada)

- 3.2 DoD (por tema)
- (sem UI mapeada)
