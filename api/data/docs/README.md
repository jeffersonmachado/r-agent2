# Estrutura RAG do Projeto

Este diretório contém as estruturas RAG (Retrieval-Augmented Generation) para geração controlada por IA.

## Estrutura

```
rag/
├── chatbot/              # RAG para geração de fluxos de chatbot
│   ├── schema/
│   │   └── flow.schema.json
│   ├── nodes/
│   │   └── node.types.json
│   ├── rules/
│   │   └── connection.rules.json
│   └── known_errors/
│       └── flow.errors.json
│
└── rpa/                  # RAG para geração de testes RPA (ISOLADO)
    ├── rpa.schema.json
    ├── rpa.actions.json
    ├── rpa.restrictions.json
    ├── frontend.pages.json
    ├── frontend.selectors.json
    ├── project.rules.json
    └── known_errors.json
```

## RAG_CHATBOT

**Objetivo:** Impedir geração de fluxo inválido por IA.

**Arquivos:**
- `schema/flow.schema.json` - Schema JSON para validação estrutural de fluxos
- `nodes/node.types.json` - Tipos de nós disponíveis e suas configurações
- `rules/connection.rules.json` - Regras de conexão entre nós
- `known_errors/flow.errors.json` - Erros conhecidos (inicialmente vazio)

**Validador:** `api/utils/validateFlowPlan.js`

## RAG_RPA_TESTS

**Objetivo:** Geração segura de testes RPA (test-only, determinístico).

**Estrutura:** Todos os arquivos estão em `rag/rpa/` (estrutura isolada e plana)

**Arquivos:**
- `rpa.schema.json` - Schema JSON para planos RPA
- `rpa.actions.json` - Whitelist de ações permitidas
- `rpa.restrictions.json` - Restrições técnicas
- `frontend.pages.json` - Páginas válidas do frontend
- `frontend.selectors.json` - Seletores CSS/XPath disponíveis
- `project.rules.json` - Regras fundamentais do projeto
- `known_errors.json` - Erros conhecidos

**Validador:** `api/utils/validateRpaPlan.js`

**Regras ABSOLUTAS:**
- RPA é EXCLUSIVAMENTE test-only
- Nenhum acesso a produção
- Nenhuma ação fora da whitelist
- Nenhum seletor inventado
- Nenhuma execução sem validação

## Pipeline de Validação

**Arquivo:** `api/utils/ragValidationPipeline.js`

**Uso:**
```javascript
const { validateWithPipeline } = require('./api/utils/ragValidationPipeline');

// Para fluxos de chatbot
const result = validateWithPipeline(flow, 'chatbot');

// Para testes RPA
const result = validateWithPipeline(plan, 'rpa');
```

**Fluxo:**
1. IA gera PLANO (JSON)
2. Validador valida com RAG correspondente
3. Se inválido: retorna erro estruturado
4. Se válido: segue para execução / replay

## Princípios

- **NÃO invente:** A IA só pode gerar o que já existe no sistema
- **Validação obrigatória:** Toda geração passa por validação estrutural
- **Erros estruturados:** Erros são retornados de forma clara e acionável
- **Separação:** RAG_CHATBOT e RAG_RPA_TESTS são completamente isolados

## Manutenção

- **Erros conhecidos:** Quando um erro é detectado, adicione em `known_errors/`
- **Novos tipos de nós:** Adicione em `nodes/node.types.json` (chatbot) ou `actions/rpa.actions.json` (rpa)
- **Novas regras:** Adicione em `rules/connection.rules.json` (chatbot) ou `rules/project.rules.json` (rpa)

