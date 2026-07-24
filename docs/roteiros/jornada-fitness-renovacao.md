# Fitness — Renovacao

> Gerado: 2026-07-24T03:54:00.600Z | Vertical: fitness | Jornada: renovacao

## 1. Objetivo

Validar o fluxo operacional completo da jornada **renovacao** com cobertura de 6 capabilities obrigatórias e confiança de contrato de 88%.

**Capabilities requeridas:**
- `customer_identification`
- `membership_validation`
- `billing_validation`
- `payment`
- `crm_update`
- `notifications`

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

Total: **3** cenários (0 aprovados, 3 drafts)

### ⬜ Renovação de Matrícula

- **ID**: `fitness-matricula-renovacao`
- **Status**: deprecated
- **Canais**: não definidos
- **Pré-condições**: nenhuma
- **Integrações**: não definidas

⚠️ **Cenário sem passos definidos** — requer geração via bot (`POST /api/qa-waves/intelligence/generate-scenario`).

### ⬜ Renovação de plano via WhatsApp com falha de pagamento no cartão, recuperação com PIX e confirmação de renovação sem duplicidade

- **ID**: `fitness_full_renovacao_whatsapp_pagamento_falha_recuperacao`
- **Status**: active
- **Canais**: whatsapp, chat, api
- **Pré-condições**: nenhuma
- **Integrações**: accessControlService, aiIntentService, api, eventMesh, flowEngine, meshValidator, paymentService, ragService, semanticValidator, whatsapp

**Passos:**

| Ordem | Tipo | Nome | Adapter | Canal | Timeout |
|---|---|---|---|---|
| 1 | Evento de Canal | - | whatsapp | whatsapp | 15000ms |
| 2 | Envio de Mensagem | - | whatsapp | whatsapp | 15000ms |
| 3 | Validação de Intenção (IA) | - | aiIntentService | whatsapp | 15000ms |
| 4 | validate_context | - | ragService | whatsapp | 15000ms |
| 5 | validate_response | - | semanticValidator | whatsapp | 15000ms |
| 6 | Envio de Mensagem | - | whatsapp | whatsapp | 15000ms |
| 7 | provide_data | - | whatsapp | whatsapp | 15000ms |
| 8 | create_payment | - | paymentService | whatsapp | 15000ms |
| 9 | Aguardar Evento | - | eventMesh | whatsapp | 15000ms |
| 10 | validate_response | - | semanticValidator | whatsapp | 15000ms |
| 11 | Envio de Mensagem | - | whatsapp | whatsapp | 15000ms |
| 12 | create_payment | - | paymentService | whatsapp | 15000ms |
| 13 | validate_sla | - | meshValidator | whatsapp | 15000ms |
| 14 | Aguardar Evento | - | eventMesh | whatsapp | 15000ms |
| 15 | Validação de Backend | - | api | whatsapp | 15000ms |
| 16 | validate_access_release | - | accessControlService | whatsapp | 15000ms |
| 17 | validate_response | - | semanticValidator | whatsapp | 15000ms |
| 18 | validate_flow_transition | - | flowEngine | whatsapp | 15000ms |

**Validações**: replay=true, backend=true

### ⬜ Renovação E2E via WhatsApp de plano anual com cartão expirado, oferta de atualização de pagamento e confirmação de renovação sem duplicidade de cobrança

- **ID**: `fitness_full_renovacao_whatsapp_plano_anual_cartao_expirado_com_recuperacao`
- **Status**: active
- **Canais**: whatsapp, chat, api
- **Pré-condições**: nenhuma
- **Integrações**: api, eventMesh, flowEngine, meshValidator, whatsapp

**Passos:**

| Ordem | Tipo | Nome | Adapter | Canal | Timeout |
|---|---|---|---|---|
| 1 | Evento de Canal | - | whatsapp | whatsapp | 15000ms |
| 2 | Envio de Mensagem | - | whatsapp | whatsapp | 15000ms |
| 3 | Validação de Intenção (IA) | - | whatsapp | whatsapp | 15000ms |
| 4 | provide_data | - | whatsapp | whatsapp | 15000ms |
| 5 | validate_context | - | whatsapp | whatsapp | 15000ms |
| 6 | Envio de Mensagem | - | whatsapp | whatsapp | 15000ms |
| 7 | create_payment | - | whatsapp | whatsapp | 15000ms |
| 8 | validate_response | - | whatsapp | whatsapp | 15000ms |
| 9 | Aguardar Evento | - | eventMesh | whatsapp | 15000ms |
| 10 | Validação de Backend | - | api | whatsapp | 15000ms |
| 11 | validate_flow_transition | - | flowEngine | whatsapp | 15000ms |
| 12 | validate_response | - | whatsapp | whatsapp | 15000ms |
| 13 | validate_sla | - | meshValidator | whatsapp | 15000ms |
| 14 | validate_fallback | - | whatsapp | whatsapp | 15000ms |

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
