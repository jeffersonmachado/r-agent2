# Fitness — Onboarding

> Gerado: 2026-07-24T03:54:00.599Z | Vertical: fitness | Jornada: onboarding

## 1. Objetivo

Validar o fluxo operacional completo da jornada **onboarding** com cobertura de 4 capabilities obrigatórias e confiança de contrato de 75%.

**Capabilities requeridas:**
- `customer_identification`
- `crm_updates`
- `notifications`
- `onboarding`

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

Total: **2** cenários (0 aprovados, 2 drafts)

### ⬜ Onboarding do Novo Aluno

- **ID**: `fitness-matricula-onboarding`
- **Status**: deprecated
- **Canais**: não definidos
- **Pré-condições**: nenhuma
- **Integrações**: não definidas

⚠️ **Cenário sem passos definidos** — requer geração via bot (`POST /api/qa-waves/intelligence/generate-scenario`).

### ⬜ [Manual] Onboarding de novo aluno via WhatsApp — primeiro acesso completo

- **ID**: `fitness_full_onboarding_whatsapp_primeiro_acesso_e2e`
- **Status**: active
- **Canais**: whatsapp, chat, api
- **Pré-condições**: nenhuma
- **Integrações**: accessControlService, aiIntentService, api, flowEngine, meshValidator, ragService, schedulingService, semanticValidator, whatsapp

**Passos:**

| Ordem | Tipo | Nome | Adapter | Canal | Timeout |
|---|---|---|---|---|
| 1 | Evento de Canal | - | whatsapp | whatsapp | 15000ms |
| 2 | Envio de Mensagem | - | whatsapp | whatsapp | 15000ms |
| 3 | Validação de Intenção (IA) | - | aiIntentService | whatsapp | 15000ms |
| 4 | provide_data | - | whatsapp | whatsapp | 15000ms |
| 5 | Validação de Backend | - | api | whatsapp | 15000ms |
| 6 | validate_context | - | ragService | whatsapp | 15000ms |
| 7 | Envio de Mensagem | - | whatsapp | whatsapp | 15000ms |
| 8 | provide_data | - | whatsapp | whatsapp | 15000ms |
| 9 | check_availability | - | schedulingService | whatsapp | 15000ms |
| 10 | select_slot | - | schedulingService | whatsapp | 15000ms |
| 11 | create_booking | - | schedulingService | whatsapp | 15000ms |
| 12 | Validação de Backend | - | api | whatsapp | 15000ms |
| 13 | Envio de Mensagem | - | whatsapp | whatsapp | 15000ms |
| 14 | validate_access_release | - | accessControlService | whatsapp | 15000ms |
| 15 | validate_response | - | semanticValidator | whatsapp | 15000ms |
| 16 | validate_sla | - | meshValidator | whatsapp | 15000ms |
| 17 | validate_flow_transition | - | flowEngine | whatsapp | 15000ms |
| 18 | validate_fallback | - | api | whatsapp | 15000ms |

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
