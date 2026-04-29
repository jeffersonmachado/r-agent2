# QA Waves com IA — Documentação Técnica

## Visão Geral

O sistema **QA Waves com IA** estende o framework de testes do RAP com capacidades de:

1. **Análise de cobertura** — cálculo de cobertura real por vertical, jornada e etapa
2. **Detecção de gaps** — identificação de cenários faltando, frágeis ou desatualizados
3. **Geração por IA** — criação de rascunhos de cenários e seeds com LLM, sempre em status `draft_ai`
4. **Fluxo de revisão manual** — aprovação/rejeição obrigatória antes de qualquer execução
5. **Cobertura baseada em replay** — evidências reais, não apenas declarações
6. **Governança GO/NO_GO** — avaliação de wave antes de deploy

---

## Conceitos Fundamentais

### Wave
Unidade de execução de testes. Agrupa cenários de uma jornada/vertical.
- Arquivo: `qa/qa-waves/scenario-store.json`
- Identificada por `waveId` (ex: `fitness-cliente-novo`)

### Cenário (`scenario`)
Conjunto de passos semânticos que representa um fluxo de usuário.
- Passos semânticos: `send_message`, `validate_intent`, `validate_backend`, etc.
- Campos: `id`, `waveId`, `title`, `vertical`, `journey`, `status`, `semanticSteps`, `seeds`, `validators`, `platformScenarioIds`

### Seed
Variação de entrada para um cenário — define perfil, canal, dados e resultado esperado.
- Campos: `id`, `scenarioId`, `profile`, `channel`, `input`, `expectedIntent`, `constraints`, `expectedOutcome`

### Replay
Evidência de execução real de um cenário.
- Armazenado em `/tmp/ragent2-runtime/qa-waves-*/*.json` e diretórios de replay RPA
- Contém: `scenarioId`, `finishedAt`, `status`, `durationMs`

### Evidence
Replay com `status=success` e `finishedAt` recente (<7 dias).
- Sem evidência = cenário não conta como coberto para fins de governança

---

## Ciclo de Vida de Status de Cenários

```
          ┌──────────┐
   IA →   │ draft_ai │ → aprovação manual →  approved  → active
          └──────────┘                          │
                │                              ↓
                └────────────────────→    rejected / deprecated
```

**Regra crítica**: Apenas `approved`, `active` e `regression` podem ser executados.
`draft_ai` **nunca** é executado automaticamente.

Definido em: `api/modules/qa-waves/waveScenario.constants.js` → `EXECUTABLE_SCENARIO_STATUS`

---

## Arquitetura

```
api/services/qaWavesIntelligenceService.js   ← núcleo da inteligência
api/modules/qa-waves/routes.js               ← endpoints /intelligence/* e /governance
api/composition/qa-waves/index.js            ← injeção de dependências
qa/qa-waves/coverage-map.json                ← mapa de cobertura por vertical
qa/qa-waves/ai-drafts.json                   ← rascunhos gerados por IA (auto-criado)
qa/qa-waves/governance-report.json           ← relatórios GO/NO_GO (auto-criado)
frontend/src/components/qa-waves/CoverageGapsTab.jsx   ← UI de cobertura
scripts/qa-waves-analyze.js                 ← CLI de análise
scripts/qa-waves-generate-gaps.js           ← CLI de geração de gaps
scripts/qa-waves-generate-seeds.js          ← CLI de geração de seeds
scripts/qa-waves-governance.js              ← CLI de governança
```

---

## Fluxo de Geração por IA

```
1. Detectar gap via analyzeCoverageGaps()
2. Chamar generateScenarioDraft({ vertical, journey, stage, gap })
   → Chama generateAiResponse() via aiProviderService
   → Fallback estrutural se IA indisponível
   → Persiste em qa/qa-waves/ai-drafts.json com status=draft_ai
3. Revisar na UI: /dev/qa-waves → tab "Cobertura e Gaps" → seção "Revisão de Cenários"
4. Aprovar: POST /api/qa-waves/intelligence/approve-scenario { draftId }
5. Executar: POST /api/test-executions (apenas cenários approved/active/regression)
```

---

## Endpoints da API

### Cobertura

```
GET /api/qa-waves/intelligence/coverage
  Query: ?vertical=fitness&journey=fitness_new_customer
  → Retorna cobertura por vertical/jornada

POST /api/qa-waves/intelligence/analyze-gaps
  Body: { vertical, journey? }
  → Análise detalhada com missingScenarios, weakScenarios, replayStats
```

### Geração por IA

```
POST /api/qa-waves/intelligence/generate-scenario
  Body: { vertical, journey, stage, gap, context? }
  → Retorna draft em status draft_ai

POST /api/qa-waves/intelligence/generate-seeds
  Body: { scenarioId, quantity?, scenarioContext? }
  → Retorna array de seeds em draft_ai
```

### Revisão

```
GET  /api/qa-waves/intelligence/drafts
  Query: ?status=draft_ai&vertical=fitness
  → Lista rascunhos de IA

POST /api/qa-waves/intelligence/approve-scenario
  Body: { draftId, approvedBy? }

POST /api/qa-waves/intelligence/reject-scenario
  Body: { draftId, rejectedBy?, reason? }
```

### Governança

```
GET /api/qa-waves/governance
  → Lista todos os relatórios GO/NO_GO

POST /api/qa-waves/governance/evaluate
  Body: { waveId, scenarioIds?, policy? }
  → Avalia e persiste relatório
  → policy: { minCoverage, minQuality, maxCriticalFailures, replayRequired }
```

---

## Coverage Map (`qa/qa-waves/coverage-map.json`)

Define os cenários **obrigatórios** por vertical, jornada e etapa.
Verticais disponíveis: `fitness`, `beauty`, `pbx`, `core`.

```json
{
  "verticals": [{
    "vertical": "fitness",
    "journeys": [{
      "id": "fitness_new_customer",
      "stages": [{
        "id": "agendamento",
        "requiredScenarios": ["fitness_booking_experimental_class"]
      }]
    }]
  }]
}
```

Para adicionar novas verticais ou jornadas: editar `qa/qa-waves/coverage-map.json` diretamente.

---

## Lógica de Cobertura por Replay

Um cenário é considerado **coberto** quando existe em `scenario-store.json` com status executável.

Um cenário é considerado **evidenciado** quando:
- Tem replay com `finishedAt` há menos de 7 dias (`REPLAY_FRESHNESS_DAYS`)
- Sem falhas (`status !== failed`)

Regras de fraqueza:
| Condição | Resultado |
|----------|-----------|
| Sem seeds | `missingSeeds` |
| Sem validadores | `missingValidators` |
| Sem replay | Gap de evidência |
| Replay com falha | Gap crítico |
| Replay > 7 dias | Precisa revalidar |
| Replay > 30 dias | Gap de qualidade |

---

## Governança GO/NO_GO

**Critérios padrão** (configuráveis via `policy`):

| Critério | Valor padrão |
|----------|-------------|
| `minCoverage` | 0.70 (70%) |
| `minQuality` | 0.80 (80%) |
| `maxCriticalFailures` | 0 |
| `replayRequired` | true |

**Resultado `NO_GO`** quando:
- Cobertura < `minCoverage`
- Qualidade < `minQuality`
- Falhas críticas > `maxCriticalFailures`

Relatórios persistidos em `qa/qa-waves/governance-report.json`.

---

## Scripts CLI

```bash
# Analisar cobertura atual
npm run qa:waves:analyze
npm run qa:waves:analyze -- --vertical=fitness

# Gerar cenários para gaps detectados
npm run qa:waves:generate-gaps -- --vertical=fitness
npm run qa:waves:generate-gaps -- --vertical=fitness --dry-run

# Gerar seeds para um cenário
npm run qa:waves:generate-seeds -- --scenarioId=fitness_booking_experimental_class --quantity=8

# Avaliar governança de uma wave
npm run qa:waves:governance -- --waveId=fitness-cliente-novo
npm run qa:waves:governance -- --waveId=fitness-cliente-novo --minCoverage=0.8
npm run qa:waves:governance -- --list
```

---

## Interface do Usuário

Em `/dev/qa-waves`, aba **"Cobertura e Gaps"**:

1. **Cobertura por Vertical e Jornada** — barras de progresso com drill-down
2. **Análise de Gaps** — formulário com vertical/jornada/etapa/gap + botão "Analisar Gaps"
3. **Geração por IA** — botão "Gerar Cenário por IA" (requer vertical, etapa e gap preenchidos)
4. **Revisão de Cenários** — lista de `draft_ai` com botões "Aprovar" e "Rejeitar"
5. **Governança** — relatórios GO/NO_GO com detalhes de qualidade e falhas

---

## Integração com RAP / QA Mesh

- **Replays** lidos de `getAllReplayReadDirs()` (mesma fonte do RPA Replays page)
- **Mesh scenarios** acessíveis via `getOfficialReference()` do `qaMeshService`
- **Governança** complementa o `go-no-go-report.json` do QA Mesh existente
- **Pipeline**: `qa:waves:governance` pode ser adicionado ao CI antes do deploy
  ```bash
  npm run qa:waves:governance -- --waveId=$WAVE_ID || exit 1
  ```

---

## Segurança

- Todos os endpoints requerem autenticação (`requireAuth`)
- Cenários `draft_ai` não podem ser executados — verificação em `EXECUTABLE_SCENARIO_STATUS`
- Geração por IA usa o `aiProviderService` existente (suporte a OpenAI e Anthropic)
- Dados de rascunho persistidos localmente em `qa/qa-waves/` (não em banco de dados)
