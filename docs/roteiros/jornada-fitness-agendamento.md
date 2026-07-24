# Fitness — Agendamento

> Gerado: 2026-07-24T03:54:00.593Z | Vertical: fitness | Jornada: agendamento

## 1. Objetivo

Validar o fluxo operacional completo da jornada **agendamento** com cobertura de 4 capabilities obrigatórias e confiança de contrato de 81%.

**Capabilities requeridas:**
- `customer_identification`
- `scheduling`
- `notifications`
- `crm_update`

## 2. Pré-condições

| Condição | Obrigatória |
|---|---|
| API em execução (porta 3001) | Sim |
| Redis acessível | Sim |
| PostgreSQL acessível | Sim |
| Tenant configurado para vertical Fitness | Sim |
| Credenciais de QA (`systemadmin` / tenant `system`) | Sim |
| RPA/Playwright disponível para replay | Sim |

## 3. Cenários

Total: **4** cenários (1 aprovados, 3 drafts)

### ✅ Agendamento de Aula Experimental via UI

- **ID**: `fitness-matricula-agendamento-ui`
- **Status**: approved
- **Canais**: chat, api
- **Pré-condições**: nenhuma
- **Integrações**: schedulingService, semanticValidator, rpa

**Passos:**

| Ordem | Tipo | Nome | Adapter | Canal | Timeout |
|---|---|---|---|---|
| 1 | Evento de Canal | Usuário abre menu Construtor → Tarefas | chat | chat | 15000ms |
| 2 | provide_data | Usuário preenche e cria a tarefa | chat | chat | 15000ms |
| 3 | provide_data | Usuário preenche o formulário de agendamento | schedulingService | chat | 15000ms |
| 4 | create_booking | Sistema cria o agendamento | schedulingService | api | 15000ms |
| 5 | validate_response | UI confirma Agendamento criado | semanticValidator | chat | 20000ms |

**Validações**: replay=true, backend=true

### ⬜ Agendamento de Aula Experimental

- **ID**: `fitness-matricula-agendamento`
- **Status**: deprecated
- **Canais**: não definidos
- **Pré-condições**: nenhuma
- **Integrações**: não definidas

⚠️ **Cenário sem passos definidos** — requer geração via bot (`POST /api/qa-waves/intelligence/generate-scenario`).

### ⬜ E2E no WhatsApp: agendar aula (pilates) com escolha de unidade, checagem de elegibilidade, pagamento e confirmação com política de cancelamento

- **ID**: `fitness_full_agendamento_whatsapp_e2e_pagamento_confirmacao`
- **Status**: active
- **Canais**: whatsapp, chat, api
- **Pré-condições**: nenhuma
- **Integrações**: aiIntentService, api, eventMesh, flowEngine, meshValidator, paymentService, ragService, schedulingService, semanticValidator, whatsapp

**Passos:**

| Ordem | Tipo | Nome | Adapter | Canal | Timeout |
|---|---|---|---|---|
| 1 | Evento de Canal | - | whatsapp | whatsapp | 15000ms |
| 2 | Envio de Mensagem | - | whatsapp | whatsapp | 15000ms |
| 3 | Validação de Intenção (IA) | - | aiIntentService | whatsapp | 15000ms |
| 4 | provide_data | - | whatsapp | whatsapp | 15000ms |
| 5 | validate_context | - | ragService | whatsapp | 15000ms |
| 6 | check_availability | - | schedulingService | whatsapp | 15000ms |
| 7 | select_slot | - | schedulingService | whatsapp | 15000ms |
| 8 | Validação de Backend | - | api | whatsapp | 15000ms |
| 9 | create_payment | - | paymentService | whatsapp | 15000ms |
| 10 | Aguardar Evento | - | eventMesh | whatsapp | 15000ms |
| 11 | Evento de Canal | - | whatsapp | whatsapp | 15000ms |
| 12 | create_booking | - | schedulingService | whatsapp | 15000ms |
| 13 | Validação de Backend | - | api | whatsapp | 15000ms |
| 14 | validate_response | - | semanticValidator | whatsapp | 15000ms |
| 15 | validate_sla | - | meshValidator | whatsapp | 15000ms |
| 16 | validate_flow_transition | - | flowEngine | whatsapp | 15000ms |

**Validações**: replay=true, backend=true

### ⬜ WhatsApp: agendar avaliação física com personal, validar disponibilidade, pagamento antecipado e confirmação com política de cancelamento

- **ID**: `fitness_full_agendamento_avaliacao_e_pagamento_whatsapp`
- **Status**: active
- **Canais**: whatsapp, chat, api
- **Pré-condições**: nenhuma
- **Integrações**: aiIntentService, api, eventMesh, flowEngine, meshValidator, paymentService, ragService, schedulingService, semanticValidator, whatsapp

**Passos:**

| Ordem | Tipo | Nome | Adapter | Canal | Timeout |
|---|---|---|---|---|
| 1 | Evento de Canal | - | whatsapp | whatsapp | 15000ms |
| 2 | Envio de Mensagem | - | whatsapp | whatsapp | 15000ms |
| 3 | Validação de Intenção (IA) | - | aiIntentService | whatsapp | 15000ms |
| 4 | provide_data | - | whatsapp | whatsapp | 15000ms |
| 5 | check_availability | - | schedulingService | whatsapp | 15000ms |
| 6 | select_slot | - | schedulingService | whatsapp | 15000ms |
| 7 | provide_data | - | whatsapp | whatsapp | 15000ms |
| 8 | validate_response | - | semanticValidator | whatsapp | 15000ms |
| 9 | create_payment | - | paymentService | whatsapp | 15000ms |
| 10 | Envio de Mensagem | - | whatsapp | whatsapp | 15000ms |
| 11 | validate_sla | - | meshValidator | whatsapp | 15000ms |
| 12 | Aguardar Evento | - | eventMesh | whatsapp | 15000ms |
| 13 | Evento de Canal | - | whatsapp | whatsapp | 15000ms |
| 14 | create_booking | - | schedulingService | whatsapp | 15000ms |
| 15 | Validação de Backend | - | api | whatsapp | 15000ms |
| 16 | validate_response | - | semanticValidator | whatsapp | 15000ms |
| 17 | validate_context | - | ragService | whatsapp | 15000ms |
| 18 | validate_flow_transition | - | flowEngine | whatsapp | 15000ms |

**Validações**: replay=true, backend=true

## 4. Evidência Esperada

Após execução de todos os cenários aprovados via QA Mesh:

| Artefato | Formato | Local |
|---|---|---|
| Resultado da execução | JSON | `qa-mesh/meshHistory/` |
| Relatório GO/NO_GO | JSON | `qa-mesh/go-no-go-report.json` |
| Replay (se aplicável) | JSON + trace | `qa/` (governado) |
| Evidência de smoke | JSON | `qa/smoke/prod-like/` |
| Diagrama da jornada | Mermaid | `docs/diagrams/qa-waves/journey-*.md` |

## 5. Validações de Governança

Gates aplicáveis após execução:

```bash
npm run validate:qa-governance        # QA Mesh GO/NO_GO
npm run validate:qa-waves-registry     # Integridade do registry
npm run validate:replay-governance     # Integridade de replay
npm run validate:self-proving          # Prova final
```

## 6. Troubleshooting

| Sintoma | Causa provável | Ação |
|---|---|---|
| Cenário falha na validação de schema | Passos não conformes com `waveScenarioSchema.js` | Regerar via bot ou corrigir manualmente |
| Execução retorna 500 | API ou dependência indisponível | Verificar `docker-compose.prod.yml` serviços |
| Mesh runner falha | Adapter não configurado para o canal | Verificar configuração de canais no tenant |
| Replay não gera evidência | RPA não configurado ou browser ausente | Rodar `npx playwright install` |
| GO/NO_GO retorna NO_GO | Bloqueadores ativos no enterprise governance | Rodar `npm run validate:qa-governance` e inspecionar `reports/` |
| Cenário sem passos (draft) | Não passou pelo bot de geração | Usar `POST /api/qa-waves/intelligence/generate-scenario` |
