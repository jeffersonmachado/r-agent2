# Fitness — Checkin

> Gerado: 2026-07-24T03:54:00.596Z | Vertical: fitness | Jornada: checkin

## 1. Objetivo

Validar o fluxo operacional completo da jornada **checkin** com cobertura de 5 capabilities obrigatórias e confiança de contrato de 85%.

**Capabilities requeridas:**
- `customer_identification`
- `membership_validation`
- `access_decision`
- `turnstile_release`
- `attendance_record`

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

### ⬜ Check-in Diário na Academia

- **ID**: `fitness-matricula-checkin`
- **Status**: deprecated
- **Canais**: não definidos
- **Pré-condições**: nenhuma
- **Integrações**: não definidas

⚠️ **Cenário sem passos definidos** — requer geração via bot (`POST /api/qa-waves/intelligence/generate-scenario`).

### ⬜ Check-in via WhatsApp sem reserva ativa e com pagamento pendente: orientar, bloquear entrada e oferecer regularização

- **ID**: `fitness_full_checkin_sem_reserva_com_pagamento_pendente_whatsapp`
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
| 4 | provide_data | - | whatsapp | whatsapp | 15000ms |
| 5 | validate_response | - | semanticValidator | whatsapp | 15000ms |
| 6 | create_payment | - | paymentService | whatsapp | 15000ms |
| 7 | validate_sla | - | meshValidator | whatsapp | 15000ms |
| 8 | Aguardar Evento | - | eventMesh | whatsapp | 15000ms |
| 9 | Evento de Canal | - | whatsapp | whatsapp | 15000ms |
| 10 | Validação de Backend | - | api | whatsapp | 15000ms |
| 11 | validate_access_release | - | accessControlService | whatsapp | 15000ms |
| 12 | validate_flow_transition | - | flowEngine | whatsapp | 15000ms |
| 13 | validate_context | - | ragService | whatsapp | 15000ms |

**Validações**: replay=true, backend=true

### ⬜ Check-in completo via WhatsApp com QR dinâmico, validação de biometria na catraca e liberação de acesso (alto risco)

- **ID**: `fitness_full_checkin_whatsapp_qr_com_biometria_e_trava_de_acesso`
- **Status**: active
- **Canais**: whatsapp, chat, api
- **Pré-condições**: nenhuma
- **Integrações**: accessControlService, aiIntentService, api, eventMesh, meshValidator, ragService, semanticValidator, whatsapp

**Passos:**

| Ordem | Tipo | Nome | Adapter | Canal | Timeout |
|---|---|---|---|---|
| 1 | Envio de Mensagem | - | whatsapp | whatsapp | 15000ms |
| 2 | Validação de Intenção (IA) | - | aiIntentService | whatsapp | 15000ms |
| 3 | provide_data | - | whatsapp | whatsapp | 15000ms |
| 4 | Validação de Backend | - | api | whatsapp | 15000ms |
| 5 | validate_response | - | semanticValidator | whatsapp | 15000ms |
| 6 | Evento de Canal | - | whatsapp | whatsapp | 15000ms |
| 7 | validate_context | - | ragService | whatsapp | 15000ms |
| 8 | Aguardar Evento | - | eventMesh | whatsapp | 15000ms |
| 9 | Validação de Backend | - | api | whatsapp | 15000ms |
| 10 | validate_access_release | - | accessControlService | whatsapp | 15000ms |
| 11 | validate_response | - | semanticValidator | whatsapp | 15000ms |
| 12 | validate_sla | - | meshValidator | whatsapp | 15000ms |
| 13 | Envio de Mensagem | - | whatsapp | whatsapp | 15000ms |
| 14 | Validação de Backend | - | api | whatsapp | 15000ms |
| 15 | validate_response | - | semanticValidator | whatsapp | 15000ms |
| 16 | validate_fallback | - | api | whatsapp | 15000ms |

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
