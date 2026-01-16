# 🎯 Sistema de Replay - Referência Rápida

## 📍 Locais Identificados para Aplicação

### ✅ **Já Implementado**
1. **Testes RPA** (`tests/rpa/`)
   - ✅ `login.test.js`
   - ✅ `rpaTestRunner.js`
   - ✅ `player/rpaPlayer.js`

---

### 🔴 **Alta Prioridade** (Implementar Primeiro)

#### 2. **Processos de Geração**
**Arquivo:** `api/services/generationOrchestrator.js`
- Validação de payload
- Resolução de contexto (RAG/Scraping)
- Chamadas de IA
- Geração de fluxos/RPA/seeds
- Validação de artefatos

**Storage:** `./replays/generation/`

#### 3. **Engine de Fluxo**
**Arquivos:** `engine/runner.js`, `engine/executeStep.js`
- Execução de cada nó
- Transições entre nós
- Chamadas de IA/API
- Erros e fallbacks
- Estado da conversa

**Storage:** `./replays/engine/`

---

### 🟡 **Média Prioridade**

#### 4. **Pipeline Orchestrator**
**Arquivo:** `api/services/pipelineOrchestrator.js`
- Execução de pipelines
- Etapas do pipeline
- Dependências resolvidas

**Storage:** `./replays/pipeline/`

#### 5. **RPA Flow Pipeline**
**Arquivo:** `api/services/rpaFlowPipelineService.js`
- Conversão fluxo → RPA
- Resolução de dependências
- Execução de seeds

**Storage:** `./replays/rpa-pipeline/`

#### 6. **QA Service**
**Arquivo:** `api/services/qaService.js`
- Execução de testes QA
- Validações realizadas
- Métricas coletadas

**Storage:** `./replays/qa/`

#### 7. **Testes de API**
**Localização:** `tests/endpoints/`, `tests/integration/`
- Chamadas HTTP
- Requisições/respostas
- Status codes
- Tempos de resposta

**Storage:** `./tests/api/replays/`

#### 8. **Flow Simulation**
**Arquivo:** `engine/flowSimulation.js`
- Simulações de fluxo
- Cenários testados
- Resultados esperados vs reais

**Storage:** `./replays/simulation/`

---

### 🟢 **Baixa Prioridade**

#### 9. **RAG Service**
**Arquivo:** `api/services/ragService.js`
- Consultas RAG
- Documentos recuperados
- Scores de relevância

**Storage:** `./replays/rag/`

#### 10. **Web Scraping Service**
**Arquivo:** `api/services/webScrapingService.js`
- URLs acessadas
- Dados extraídos
- Erros de scraping

**Storage:** `./replays/scraping/`

#### 11. **Message Processor**
**Arquivo:** `api/services/messageProcessor.js`
- Processamento de mensagens
- Fluxos acionados
- Respostas geradas

**Storage:** `./replays/messages/`

#### 12. **Chaos Testing**
**Arquivo:** `engine/chaosTesting.js`
- Testes de caos
- Falhas injetadas
- Comportamento do sistema

**Storage:** `./replays/chaos/`

---

## 🚀 Template de Implementação Rápida

```javascript
const { ReplaySystem } = require('../../lib/replaySystem');

async function meuProcesso() {
  const replay = new ReplaySystem({
    storagePath: './replays/meu-contexto',
    context: 'meu-contexto',
  });

  replay.start('processo-id', { /* metadados */ });

  try {
    // Seu código aqui
    replay.recordAction(
      { type: 'step1', step: 'inicializacao' },
      { success: true }
    );
  } catch (error) {
    replay.recordError(error, 'step-name');
  } finally {
    replay.stop();
    replay.save('processo-id');
  }
}
```

---

## 📊 Resumo por Prioridade

| Prioridade | Locais | Total |
|------------|--------|-------|
| ✅ Implementado | 1 | 1 |
| 🔴 Alta | 2 | 2 |
| 🟡 Média | 5 | 5 |
| 🟢 Baixa | 4 | 4 |
| **TOTAL** | **12** | **12** |

---

## 📚 Documentação Completa

- [Análise Detalhada](./REPLAY_APPLICATION_ANALYSIS.md)
- [Módulo Principal](./replaySystem.js)
- [Exemplos de Uso](./replaySystem.examples.js)
- [Guia de Uso](./REPLAY_SYSTEM_USAGE.md)
