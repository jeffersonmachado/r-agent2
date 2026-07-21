# Alimentação — Food Order Flow

> Gerado: 2026-07-21T09:12:35.348Z | Vertical: food | Jornada: food_order_flow

## 1. Objetivo

Validar o fluxo operacional completo da jornada **food_order_flow** na vertical Alimentação.

## 2. Pré-condições

| Condição | Obrigatória |
|---|---|
| API em execução (porta 3001) | Sim |
| Redis acessível | Sim |
| PostgreSQL acessível | Sim |
| Tenant configurado para vertical Alimentação | Sim |
| Credenciais de QA (`systemadmin` / tenant `system`) | Sim |
| RPA/Playwright disponível para replay | Sim |

## 3. Cenários

Total: **2** cenários (1 aprovados, 1 drafts)

### ✅ Food pedido via WhatsApp até confirmação

- **ID**: `food-pedido-whatsapp`
- **Status**: approved
- **Canais**: whatsapp
- **Pré-condições**: Módulo de pedidos ativo; Tenant autenticado
- **Integrações**: api, whatsapp

**Passos:**

| Ordem | Tipo | Nome | Adapter | Canal | Timeout |
|---|---|---|---|---|
| 1 | Evento de Canal | Pedido recebido via WhatsApp webhook | whatsapp | whatsapp | 15000ms |
| 2 | Validação de Backend | Status do pedido atualizado | api | - | 15000ms |

**Validações**: replay=true, backend=true

### ✅ Food Orders screen smoke

- **ID**: `business-food-scr-01`
- **Status**: approved
- **Canais**: não definidos
- **Pré-condições**: nenhuma
- **Integrações**: não definidas

⚠️ **Cenário sem passos definidos** — requer geração via bot (`POST /api/qa-waves/intelligence/generate-scenario`).

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
