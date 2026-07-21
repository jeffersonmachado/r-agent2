# Prompt: Implementar "Regras de Negócio — Visão de Processos" no qa-waves-ui

## Contexto

O módulo **Regras de Negócio — Visão de Processos** adiciona uma 3ª aba "Engenharia" ao qa-waves-ui (/dev). Ele infere fluxos de negócio e regras de dependência entre entidades a partir de um grafo de entidades+relações fornecido como JSON, avalia cobertura e detecta gaps. A lógica central é portada do `FlowInferencer` do Replay2 (Python → JavaScript).

**Stack alvo**: JavaScript ES modules (backend + frontend), Express, React 18 + Vite, CSS custom properties, Framer Motion, Lucide React. Persistência em memória (mock), com contrato para futura migração a banco.

---

## O que faz a feature

| Camada | Descrição |
|---|---|
| **Inferência de grafo** | `FlowInferencer` analisa entidades e detecta dependências. Cada aresta `A→B` vira uma regra: *"A exige B cadastrado"* |
| **Geração de fluxos** | Agrupa entidades em componentes conectados, ordena topologicamente (raízes → folhas) e gera fluxos nomeados como `PRODUTO → PRECO → VENDA → ITEM_VENDA` |
| **Avaliação de cobertura** | Para cada fluxo, verifica se todas as entidades do caminho têm entradas no source-map. Entidades ausentes viram **gaps de negócio** |
| **Persistência** | Em memória via repositório (padrão `stateRepository.js`). Contrato de dados definido em `shared/contracts/business-rules.contract.json` |
| **Painel** | 3ª aba "Engenharia" com: cards de sumário, lista de fluxos com % cobertura, detalhamento de gaps com severidade/impacto/recomendação |

---

## Arquivos de referência no Replay2 (para consulta de lógica)

```
/home/jmachado/projetos/dakota/replay2/gateway/dakota_gateway/synthetic/flow_inferencer.py      # core: InferredRule, InferredFlow, InferredBusinessModel, FlowInferencer
/home/jmachado/projetos/dakota/replay2/gateway/dakota_gateway/synthetic/integrated_pipeline.py   # orquestração: IntegratedPipeline.run() fase 2b
/home/jmachado/projetos/dakota/replay2/gateway/control/templates/business-rules.html             # template frontend (referência visual)
```

---

## Tarefas de implementação

### Fase 1 — Backend (Express, JavaScript ES modules)

#### 1.1 Contrato de dados (`shared/contracts/business-rules.contract.json`)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Business Rules Contracts",
  "definitions": {
    "InferredRule": {
      "type": "object",
      "required": ["ruleId", "description", "dependsOn", "enables", "dependencyType", "isCritical"],
      "properties": {
        "ruleId": { "type": "string" },
        "description": { "type": "string" },
        "dependsOn": { "type": "string" },
        "enables": { "type": "string" },
        "dependencyType": { "type": "string", "const": "requires" },
        "isCritical": { "type": "boolean" }
      }
    },
    "FlowStep": {
      "type": "object",
      "required": ["entity", "operation", "why"],
      "properties": {
        "entity": { "type": "string" },
        "operation": { "type": "string" },
        "why": { "type": "string" }
      }
    },
    "InferredFlow": {
      "type": "object",
      "required": ["flowId", "flowName", "description", "steps", "entitiesInFlow", "coverage", "coveredEntities", "totalEntities"],
      "properties": {
        "flowId": { "type": "string" },
        "flowName": { "type": "string" },
        "description": { "type": "string" },
        "steps": { "type": "array", "items": { "$ref": "#/definitions/FlowStep" } },
        "entitiesInFlow": { "type": "array", "items": { "type": "string" } },
        "coverage": { "type": "number", "minimum": 0, "maximum": 100 },
        "coveredEntities": { "type": "integer" },
        "totalEntities": { "type": "integer" }
      }
    },
    "BusinessGap": {
      "type": "object",
      "required": ["gapId", "severity", "description", "missingEntity", "affectedFlow", "impact", "recommendation", "suggestedFiles", "status"],
      "properties": {
        "gapId": { "type": "string" },
        "severity": { "type": "string", "enum": ["critical", "high", "medium", "low"] },
        "description": { "type": "string" },
        "missingEntity": { "type": "string" },
        "affectedFlow": { "type": "string" },
        "impact": { "type": "string" },
        "recommendation": { "type": "string" },
        "suggestedFiles": { "type": "array", "items": { "type": "string" } },
        "status": { "type": "string", "enum": ["open", "investigating", "resolved", "dismissed"] }
      }
    },
    "BusinessRulesState": {
      "type": "object",
      "required": ["rulesEvaluated", "rulesOk", "rulesBroken", "gaps", "flows", "recommendation", "sourceInfo"],
      "properties": {
        "rulesEvaluated": { "type": "integer" },
        "rulesOk": { "type": "integer" },
        "rulesBroken": { "type": "integer" },
        "gaps": { "type": "array", "items": { "$ref": "#/definitions/BusinessGap" } },
        "flows": { "type": "array", "items": { "$ref": "#/definitions/InferredFlow" } },
        "recommendation": { "type": "string" },
        "sourceInfo": { "type": "string" }
      }
    },
    "PipelineInput": {
      "type": "object",
      "required": ["entities", "relationships"],
      "properties": {
        "sourceLabel": { "type": "string" },
        "entities": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["name"],
            "properties": {
              "name": { "type": "string" },
              "fields": { "type": "array", "items": { "type": "string" } }
            }
          }
        },
        "relationships": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["from", "to"],
            "properties": {
              "from": { "type": "string" },
              "to": { "type": "string" }
            }
          }
        },
        "sourceFiles": {
          "type": "object",
          "description": "Mapa entityName → [arquivos .prg/.dbo que a implementam]",
          "additionalProperties": { "type": "array", "items": { "type": "string" } }
        }
      }
    }
  }
}
```

#### 1.2 Serviço de inferência (`backend/src/services/business-rules/`)

Portar a lógica do `FlowInferencer` de Python para JavaScript:

- **`flow-inferencer.js`** — `infer(entityGraph, entities)` → `{ rules, flows }`
  - `findRootsAndLeaves(entityGraph, entities)` — entidades sem dependências e sem dependentes
  - `generateRules(entityGraph)` — cada aresta do grafo → objeto rule
  - `generateFlows(entityGraph, entities)` — componentes conectados + ordenação topológica → array de fluxos
  - `findConnectedComponents(entityGraph, entities)` — BFS no grafo não-direcionado
  - `topologicalSortComponent(componentEntities, entityGraph)` — algoritmo de Kahn

- **`coverage-evaluator.js`** — `evaluate(flows, sourceFiles)` → `{ flowsWithCoverage, gaps }`
  - Para cada fluxo, verificar se cada entidade tem entrada em `sourceFiles`
  - Calcular % cobertura por fluxo
  - Gerar gap para entidades não encontradas, com severidade baseada na posição no fluxo (raiz=critical, folha=low)

- **`pipeline-runner.js`** — `run(input)` → `BusinessRulesState`
  - Recebe `PipelineInput` (JSON com entities + relationships + sourceFiles)
  - Constrói `entityGraph` a partir de `relationships`
  - Chama `FlowInferencer.infer()` → regras + fluxos
  - Chama `CoverageEvaluator.evaluate()` → fluxos com cobertura + gaps
  - Monta e retorna `BusinessRulesState` completo

#### 1.3 Repositório (`backend/src/repositories/business-rules.repository.js`)

Seguir o padrão de `stateRepository.js` (dados em memória):

- `getLatestState()` — retorna o `BusinessRulesState` atual ou `null`
- `saveState(state)` — armazena o estado em memória
- `getGaps(filters)` — filtra gaps por status/severity
- `updateGap(gapId, updates)` — atualiza status/notes de um gap
- `clearState()` — reseta o estado (útil para testes)
- Incluir mock data inicial (`baseBusinessRulesState`) para demonstração sem execução de pipeline

#### 1.4 Controller (`backend/src/controllers/business-rules.controller.js`)

Seguir o padrão de `replayController.js` (funções exportadas individualmente):

- `getStateController(req, res)` — retorna `BusinessRulesState` ou `{ state: null }`
- `runPipelineController(req, res)` — valida body contra `PipelineInput`, executa `pipelineRunner.run()`, persiste via repositório, retorna estado
- `getGapsController(req, res)` — lista gaps com query params `?status=&severity=`
- `updateGapController(req, res)` — atualiza status de um gap (`PATCH` com body `{ status, notes? }`)

#### 1.5 Rotas (`backend/src/routes/business-rules.routes.js`)

Seguir o padrão de `wavesRoutes.js` (Router do Express):

| Método | Rota | Handler |
|---|---|---|
| GET | `/api/business/rules` | `getStateController` |
| POST | `/api/business/rules/pipeline` | `runPipelineController` |
| GET | `/api/business/gaps` | `getGapsController` |
| PATCH | `/api/business/gaps/:gapId` | `updateGapController` |

#### 1.6 Registrar rotas no `server.js`

Adicionar após as rotas de replay:

```js
import businessRulesRoutes from './routes/business-rules.routes.js';
// ...
app.use('/api/business', businessRulesRoutes);
```

---

### Fase 2 — Frontend (React + Vite, JavaScript JSX)

#### 2.1 Adicionar 3ª aba "Engenharia" (`App.jsx`)

Modificar `App.jsx` para incluir a nova tab:

```jsx
import { Radar, Repeat2, Workflow } from 'lucide-react';
import BusinessRulesPage from './pages/BusinessRulesPage';
// ...
const [activeTab, setActiveTab] = useState('waves');
// ...
<button className={activeTab === 'business-rules' ? 'tab active' : 'tab'}
        onClick={() => setActiveTab('business-rules')}>
  <Workflow size={16} /> Engenharia
</button>
// ...
{activeTab === 'business-rules' && <BusinessRulesPage />}
```

#### 2.2 Página principal (`frontend/src/pages/BusinessRulesPage.jsx`)

Layout:

```
┌─────────────────────────────────────────────────┐
│  Engenharia de Validação                         │
│  Regras de Negócio — Visão de Processos          │
│  Validação orientada a fluxos: gaps, dependências│
├──────────┬──────────┬──────────┬────────────────┤
│ 12       │ 12       │ 0        │ 0              │
│ Regras   │ Regras   │ Gaps     │ Jornadas       │
│ avaliadas│ OK       │ detect.  │ geradas         │
├──────────┴──────────┴──────────┴────────────────┤
│  ✅ Nenhum gap detectado / ⚠️ X gaps encontrados │
│  Fonte: JSON importado: 15 entidades, 23 relações│
├─────────────────────────────────────────────────┤
│  Fluxos de Negócio                               │
│  ┌─────────────────────────────────────────────┐ │
│  │ PRODUTO → PRECO → ICMS → VENDA → ITEM_VENDA │ │
│  │ Cobertura: 100% (5/5 entidades)             │ │
│  │ [PRODUTO ✓] → [PRECO ✓] → [ICMS ✓] → ...   │ │
│  └─────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────┤
│  Gaps Detectados (se houver)                     │
│  Tabela: severidade | entidade | fluxo | ação   │
└─────────────────────────────────────────────────┘
```

#### 2.3 Componentes (`frontend/src/components/business-rules/`)

Seguir o padrão dos componentes existentes (CSS custom properties, Framer Motion para animações, Lucide React para ícones):

- **`BusinessRulesSummary.jsx`** — 4 cards com ícones:
  - Regras avaliadas (ícone: `Scale`)
  - Regras OK (ícone: `CheckCircle2`, cor `--ok`)
  - Gaps detectados (ícone: `AlertTriangle`, cor `--err` se > 0)
  - Jornadas geradas (ícone: `GitBranch`)

- **`FlowCoverageCard.jsx`** — Card expansível para um fluxo:
  - Header com nome do fluxo, % cobertura, barra de progresso
  - Lista de passos inline com `FlowStepBadge`
  - Descrição do fluxo em texto secundário

- **`FlowStepBadge.jsx`** — Badge individual:
  - Verde (`--ok`) com check quando coberto
  - Vermelho (`--err`) com x quando ausente (gap)
  - Tooltip com "why" (ex: "Exige PRECO cadastrado para vincular ICMS")

- **`GapTable.jsx`** — Tabela de gaps:
  - Colunas: Severidade (badge), Entidade, Fluxo afetado, Impacto, Ações
  - Ações: botão "Investigar" → status `investigating`, "Resolver" → `resolved`, "Ignorar" → `dismissed`
  - Severidade usa cores: critical=`--err`, high=#ff8a65, medium=`--warn`, low=`--muted`

- **`PipelineTrigger.jsx`** — Área de input do pipeline:
  - Textarea para colar JSON (`PipelineInput`)
  - Botão "Executar Pipeline" com loading state
  - Feedback de sucesso/erro
  - Link para exemplo de payload (mock)

- **`index.js`** — barrel export

#### 2.4 Hooks e serviços

- **`frontend/src/hooks/useBusinessRules.js`** — hook que faz fetch de `GET /api/business/rules` e expõe `{ state, loading, error, refresh }`

- **`frontend/src/services/businessRulesService.js`** — funções:
  - `fetchState()` — `GET /api/business/rules`
  - `runPipeline(input)` — `POST /api/business/rules/pipeline`
  - `fetchGaps(filters)` — `GET /api/business/gaps?status=&severity=`
  - `updateGap(gapId, updates)` — `PATCH /api/business/gaps/:gapId`

---

### Fase 3 — Mock data para demonstração

Incluir em `backend/src/data/mockData.js` um `baseBusinessRulesState` pré-calculado para que a página renderize imediatamente sem necessidade de executar o pipeline.

Exemplo de pipeline input para teste:

```json
{
  "sourceLabel": "MIG24 /dakota11/prg/: 15 entidades, 23 relações",
  "entities": [
    { "name": "PRODUTO", "fields": ["codigo", "descricao", "preco_custo"] },
    { "name": "PRECO", "fields": ["produto_id", "valor_venda", "vigencia"] },
    { "name": "ICMS", "fields": ["produto_id", "aliquota", "uf"] },
    { "name": "VENDA", "fields": ["cliente_id", "data", "total"] },
    { "name": "ITEM_VENDA", "fields": ["venda_id", "produto_id", "quantidade", "preco"] },
    { "name": "CLIENTE", "fields": ["codigo", "nome", "cpf"] },
    { "name": "CONVENIO", "fields": ["cliente_id", "plano_id", "vigencia"] },
    { "name": "GUIA", "fields": ["convenio_id", "procedimento", "data"] }
  ],
  "relationships": [
    { "from": "PRECO", "to": "PRODUTO" },
    { "from": "ICMS", "to": "PRODUTO" },
    { "from": "VENDA", "to": "CLIENTE" },
    { "from": "ITEM_VENDA", "to": "VENDA" },
    { "from": "ITEM_VENDA", "to": "PRODUTO" },
    { "from": "CONVENIO", "to": "CLIENTE" },
    { "from": "GUIA", "to": "CONVENIO" }
  ],
  "sourceFiles": {
    "PRODUTO": ["prg/produto_cadastro.prg", "prg/produto_consulta.prg"],
    "PRECO": ["prg/preco_atualiza.prg"],
    "ICMS": ["prg/icms_calculo.prg"],
    "VENDA": ["prg/venda_lancamento.prg", "prg/venda_consulta.prg"],
    "ITEM_VENDA": [],
    "CLIENTE": ["prg/cliente_cadastro.prg"],
    "CONVENIO": ["prg/convenio_adesao.prg"],
    "GUIA": []
  }
}
```

Resultado esperado: 2 gaps — `ITEM_VENDA` (sem programas) e `GUIA` (sem programas).

---

## Observações técnicas

- **Linguagem**: JavaScript ES modules (`"type": "module"`). Nada de TypeScript.
- **Persistência**: Em memória (mock), seguindo `stateRepository.js`. Contrato em JSON Schema para futura migração.
- **Estilo visual**: CSS custom properties do `styles.css` (`--bg`, `--surface`, `--ok`, `--err`, `--warn`, `--muted`, `--text`, `--line`, `--accent`). Animações com Framer Motion. Ícones com Lucide React.
- **Navegação**: Tab-based (`useState`), seguindo o padrão de `App.jsx`. NÃO usar React Router.
- **Port do FlowInferencer**: Lógica puramente algorítmica (BFS, Kahn, componentes conectados). Port 1:1 de Python para JavaScript, zero dependências externas.
- **Mock data**: `PipelineTrigger` aceita JSON colado. Mock inicial (`baseBusinessRulesState`) permite demonstração sem execução.
- **Dependências novas**: Nenhuma. Apenas `lucide-react` (já existe) para ícones novos (`Workflow`, `Scale`, `CheckCircle2`, `AlertTriangle`, `GitBranch`).

---

## Arquivos a criar/modificar

```
dev/qa-waves-ui/
├── shared/
│   └── contracts/
│       └── business-rules.contract.json       (NOVO)
├── backend/src/
│   ├── services/
│   │   └── business-rules/
│   │       ├── flow-inferencer.js             (NOVO)
│   │       ├── coverage-evaluator.js          (NOVO)
│   │       └── pipeline-runner.js             (NOVO)
│   ├── repositories/
│   │   └── business-rules.repository.js       (NOVO)
│   ├── controllers/
│   │   └── business-rules.controller.js       (NOVO)
│   ├── routes/
│   │   └── business-rules.routes.js           (NOVO)
│   ├── data/
│   │   └── mockData.js                        (MODIFICAR - adicionar mock state)
│   └── server.js                              (MODIFICAR - registrar nova rota)
├── frontend/src/
│   ├── pages/
│   │   └── BusinessRulesPage.jsx              (NOVO)
│   ├── components/
│   │   └── business-rules/
│   │       ├── BusinessRulesSummary.jsx       (NOVO)
│   │       ├── FlowCoverageCard.jsx           (NOVO)
│   │       ├── FlowStepBadge.jsx              (NOVO)
│   │       ├── GapTable.jsx                   (NOVO)
│   │       ├── PipelineTrigger.jsx            (NOVO)
│   │       └── index.js                       (NOVO)
│   ├── hooks/
│   │   └── useBusinessRules.js                (NOVO)
│   ├── services/
│   │   └── businessRulesService.js            (NOVO)
│   └── App.jsx                                (MODIFICAR - adicionar 3ª tab)
```
