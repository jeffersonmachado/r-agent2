# Cognitive Core — Tool Registry

Data: 2026-06-12
Código: `src/core/cognitive/tool-registry/index.js`

## Contrato CognitiveTool

```js
{
  id: string,
  visibility: 'PRODUCTION' | 'SUPPORT' | 'DEVELOPMENT',
  permissions: string[],
  description: string,
  execute(input, context),       // context: { tenantId, actor, planId, stepId }
  rollback?(input, context, output)  // opcional (compensação)
}
```

## Regras invioláveis

1. **Nenhuma execução direta** — todo passo de plano passa por `registry.execute(id, input, context)`.
2. **Tenant obrigatório** — execução sem `context.tenantId` falha (`cognitive_tool_tenant_required`).
3. **Visibility** — ator `PRODUCTION` só executa/enxerga tools `PRODUCTION`; `SUPPORT` enxerga `PRODUCTION+SUPPORT`; `DEVELOPMENT` enxerga tudo.
4. **Permissionamento** — `actor.permissions` deve cobrir `tool.permissions` (curinga `*` suportado para fluxos internos).
5. **Sem simulação** — alvo indisponível gera erro explícito (`cognitive_tool_unavailable`), nunca resposta fingida (corrige o padrão de fallback silencioso do `CAPABILITY_REGISTRY` do Agent OS).

## Tools padrão (13) — todas PRODUCTION

| Tool | Permissão | Delegação real |
|---|---|---|
| `searchCustomer` | `crm.read` | `marketingService.listLeads` / `getLeadById` (filtro por nome/telefone/e-mail) |
| `createLead` | `crm.write` | `marketingService.upsertLead` |
| `updateLead` | `crm.write` | `marketingService.updateLead` |
| `createOpportunity` | `crm.write` | módulo CRM — **gap PARTIAL**: sem service layer exportado; erro explícito até consolidação (injetável via `crmOpportunityService`) |
| `createAppointment` | `agenda.write` | `scheduleService.createSchedule` |
| `rescheduleAppointment` | `agenda.write` | `scheduleService.updateScheduleStatus({ action: 'reschedule' })` |
| `cancelAppointment` | `agenda.write` | `scheduleService.updateScheduleStatus({ action: 'cancel' })` |
| `sendWhatsappMessage` | `channel.send` | `whatsappService.sendTextMessage` |
| `createTicket` | `ticket.write` | `queueService.createTicket` |
| `transferConversation` | `conversation.transfer` | `handoverService.takeOver` |
| `originateCall` | `pbx.call` | `ccClick2CallService.createClick2CallRequest` |
| `createCampaign` | `campaign.write` | `ccCampaignsService.upsertCampaign` |
| `generateInsight` | `workspace.write` | `WorkspaceInsightService.persistInsight` (source `cognitive-core`) |

Serviços são resolvidos lazy em tempo de execução e são injetáveis via `registerDefaultTools(registry, deps)` (usado nos testes — nenhum teste toca banco/serviços reais).

## Ocultação garantida

Nenhuma tool padrão referencia QA Waves, Replay, Seeds, Mesh ou RPA. Teste de regressão: `tests/unit/cognitiveCoreToolRegistry.test.js` valida id+descrição de toda tool visível para `PRODUCTION` contra `OPERATIONAL_FORBIDDEN_PATTERN` (`src/core/cognitive/visibility.js`).
