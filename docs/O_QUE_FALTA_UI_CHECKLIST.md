# Checklist de UI por Épico

Gerado automaticamente a partir de `docs/O_QUE_FALTA.md`.

## Suites verticais (MVP→v1 operacional)

- [ ] painel admin de filas (CRUD, multi-unidade), métricas completas por unidade/estação e auditoria operacional.
- [ ] dashboards operacionais (KPIs order_to_ready/order_to_deliver), incidentes com trilha auditável e filtros avançados.
- [ ] cobertura completa de provisionamento (tokens/expiração), auditoria e operações avançadas.

## Marketing (v1 completo)

- [ ] jornadas/funil visual completo e gestão avançada de campanhas.

## SaaS e governança (base enterprise já entregue)

- [ ] governança granular (roles/permissões detalhadas) e dashboards completos de uso por tenant.

## Analytics e marketplace (primeiro corte)

- [ ] atribuição/ROI avançado, custos operacionais por canal e dashboards completos por suíte.

## P0.1 Inbox multiatendente (lista, assumir, transferir, tags, notas, respostas rápidas)

- [x] inbox unificado com lista/preview, notas e transferências em fluxo dedicado.

## P0.2 Painel supervisor com métricas (TME, TMA, abandono, por agente/fila/período)

- [x] dashboard supervisor com filtros por agente/fila/período.
- [ ] exportação dedicada e gráficos avançados (opcional).

## P0.3 RBAC completo (admin/supervisor/agente)

- [x] gestão de roles/permissões.
- [ ] guardas de UI por módulo/ação (opcional).

## P0.4 MFA funcional

- [x] setup TOTP e recovery codes.
- [ ] QR code visual (opcional).

## P0.6 Mascaramento de telefone

- [x] toggle de política por tenant e componente `MaskedPhone` no inbox/tickets.

## P1.1 Widgets + links rastreáveis (source/campaign)

- [x] gestão de links/UTM.
- [ ] painel de performance avançado (opcional).

## P1.2 URA WhatsApp empacotada (UI simples, departamentos)

- [x] editor simples de regras/departamentos.
- [ ] wizard guiado e integrações avançadas (opcional).

## P1.3 Conexão WhatsApp via QR (além da Cloud API)

- [x] fluxo dedicado de QR (pairing, status, reconexão e saúde da sessão).

## P2.2 API pública com API Keys + rate limit

- [x] gestão de API keys, quotas e uso.

## P2.3 Automações low-code

- [x] builder no-code e execução/publicação.

## P2.4 SLA por cliente

- [x] políticas de SLA por cliente e visão de violações básica.
- [ ] visão detalhada por cliente e alertas (opcional).

## P2.5 Lembretes e tarefas

- [x] lista de tarefas (básico).
- [x] lembretes simples (por prazo).
- [ ] calendário e lembretes avançados (opcional).
