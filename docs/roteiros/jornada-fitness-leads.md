# Fitness — Leads

> Gerado: 2026-07-24T03:54:00.599Z | Vertical: fitness | Jornada: leads

## 1. Objetivo

Validar o fluxo operacional completo da jornada **leads** com cobertura de 4 capabilities obrigatórias e confiança de contrato de 69%.

**Capabilities requeridas:**
- `lead_capture`
- `customer_identification`
- `crm_updates`
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

Total: **1** cenários (1 aprovados, 0 drafts)

### ✅ Captação de Lead via WhatsApp

- **ID**: `fitness-matricula-leads`
- **Status**: approved
- **Canais**: whatsapp
- **Pré-condições**: nenhuma
- **Integrações**: aiIntentService, api, flowEngine, meshValidator, ragService, whatsapp

**Passos:**

| Ordem | Tipo | Nome | Adapter | Canal | Timeout |
|---|---|---|---|---|
| 1 | Envio de Mensagem | Cliente envia mensagem WhatsApp | whatsapp | whatsapp | 15000ms |
| 2 | Evento de Canal | Sistema recebe inbound WhatsApp | whatsapp | whatsapp | 10000ms |
| 3 | Validação de Intenção (IA) | IA classifica intenção do cliente | aiIntentService | whatsapp | 15000ms |
| 4 | validate_flow_transition | Sistema decide roteamento: bot ou humano | flowEngine | whatsapp | 10000ms |
| 5 | validate_response | Bot gera e envia resposta ao cliente | ragService | whatsapp | 15000ms |
| 6 | Validação de Backend | Validar criação do lead no backend | api | whatsapp | 15000ms |
| 7 | validate_sla | Validar SLA de resposta ao lead | meshValidator | whatsapp | 15000ms |

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
