# 🚀 Próximos Passos - Sistema de Replay

## ✅ Status Atual

**Implementado:** 6/12 locais (50%)
- ✅ Testes RPA
- ✅ Processos de Geração
- ✅ Engine de Fluxo
- ✅ Pipeline Orchestrator
- ✅ RPA Flow Pipeline
- ✅ QA Service
- ✅ Testes de API (parcial - auth.test.js)

**Pendente:** 6/12 locais (50%)
- 🔄 Flow Simulation
- 🔄 RAG Service (iniciado, precisa completar)
- 🔄 Web Scraping Service (iniciado, precisa completar)
- 🔄 Message Processor
- 🔄 Chaos Testing
- 🔄 Outros testes de API

---

## 🎯 Próximos Passos Imediatos

### 1. Completar RAG Service (5 minutos)
**Arquivo:** `api/services/ragService.js`
**Função:** `queryRag()`

**O que fazer:**
- ✅ Replay já iniciado
- 🔄 Adicionar registro de ações durante a query
- 🔄 Salvar replay no retorno e catch

**Código a adicionar:**
```javascript
// Após obter resultado
if (replay) {
  replay.recordAction(
    { type: 'rag_query', step: 'query-rag' },
    { success: result.success, actual: { chunksFound, sourcesCount } }
  );
  replay.stop();
  replay.save(replayId);
}
```

---

### 2. Completar Web Scraping Service (5 minutos)
**Arquivo:** `api/services/webScrapingService.js`
**Função:** `scrapeUrl()`

**O que fazer:**
- ✅ Replay já iniciado
- 🔄 Adicionar registro de ações (fetch, extração, indexação)
- 🔄 Salvar replay no retorno e catch

---

### 3. Flow Simulation (10 minutos)
**Arquivo:** `engine/flowSimulation.js`
**Função:** `simulateFlow()`

**O que fazer:**
```javascript
const { ReplaySystem } = require('../lib/replaySystem');

async function simulateFlow(flow, options) {
  const replay = new ReplaySystem({
    storagePath: path.join(process.cwd(), 'replays', 'simulation'),
    context: 'simulation',
  });

  replay.start(`simulate-${flow.id}-${Date.now()}`, {
    flowId: flow.id,
    maxSteps: options.maxSteps,
  });

  // ... código existente ...

  // Registra cada passo da simulação
  replay.recordAction(
    { type: 'simulation_step', step: `step-${index}` },
    { success: true, actual: { nextNode } }
  );

  replay.stop();
  replay.save(`simulate-${flow.id}`);
}
```

---

### 4. Message Processor (10 minutos)
**Arquivo:** `api/services/messageProcessor.js`
**Função:** `processMessage()`

**O que fazer:**
- Adicionar replay no início de `processMessage()`
- Registrar processamento de mensagem
- Registrar execução de fluxo
- Salvar replay ao finalizar

---

### 5. Chaos Testing (10 minutos)
**Arquivo:** `engine/chaosTesting.js`
**Função:** `wrapHandlerWithChaos()`

**O que fazer:**
- Adicionar replay em testes de caos
- Registrar falhas injetadas
- Registrar comportamento de recuperação

---

### 6. Outros Testes de API (15 minutos)
**Arquivos:** `tests/endpoints/*.test.js`

**O que fazer:**
- Criar helper genérico para replay em testes de API
- Aplicar em todos os testes de endpoints

**Helper sugerido:**
```javascript
// tests/helpers/apiReplayHelper.js
const { ReplaySystem } = require('../../lib/replaySystem');

function createApiTestReplay(testName) {
  const replay = new ReplaySystem({
    storagePath: path.join(__dirname, '../../tests/api/replays'),
    context: 'api',
  });
  
  replay.start(`api-${testName}-${Date.now()}`);
  return replay;
}

function recordApiCall(replay, method, endpoint, response) {
  replay.recordAction(
    { type: 'api_call', endpoint: `${method} ${endpoint}` },
    {
      success: response.status >= 200 && response.status < 300,
      actual: { status: response.status },
    }
  );
}
```

---

## 📋 Checklist de Implementação

Para cada local pendente:

- [ ] Adicionar import do ReplaySystem
- [ ] Inicializar replay no início da função
- [ ] Registrar ações principais
- [ ] Registrar eventos importantes
- [ ] Registrar erros
- [ ] Salvar replay no retorno
- [ ] Salvar replay no catch
- [ ] Testar gravação e visualização

---

## 🎯 Priorização

### Alta (Completar Primeiro)
1. ✅ Processos de Geração - COMPLETO
2. ✅ Engine de Fluxo - COMPLETO
3. ✅ Pipeline Orchestrator - COMPLETO

### Média (Próximos)
4. ✅ RPA Flow Pipeline - COMPLETO
5. ✅ QA Service - COMPLETO
6. 🔄 Flow Simulation - **PRÓXIMO**
7. 🔄 Testes de API - **PRÓXIMO**

### Baixa (Depois)
8. 🔄 RAG Service - **PRÓXIMO** (já iniciado)
9. 🔄 Web Scraping - **PRÓXIMO** (já iniciado)
10. 🔄 Message Processor
11. 🔄 Chaos Testing

---

## 📊 Tempo Estimado

- Completar RAG Service: 5 min
- Completar Web Scraping: 5 min
- Flow Simulation: 10 min
- Message Processor: 10 min
- Chaos Testing: 10 min
- Outros Testes de API: 15 min

**Total:** ~55 minutos para completar todos os locais

---

## ✅ Benefícios Esperados

Após completar todos os locais:

1. ✅ **100% de cobertura** de processos críticos
2. ✅ **Debug instantâneo** de qualquer problema
3. ✅ **Análise completa** de regressões
4. ✅ **Documentação automática** de todas as execuções
5. ✅ **Auditoria completa** do sistema

---

## 🔧 Configuração Recomendada

```bash
# Habilitar replay em todos os contextos
ENABLE_ENGINE_REPLAY=true
ENABLE_PIPELINE_REPLAY=true
ENABLE_RAG_REPLAY=false          # Pode ser pesado, desabilitar se necessário
ENABLE_SCRAPING_REPLAY=false      # Pode ser pesado, desabilitar se necessário
```

---

## 📚 Referências

- [Módulo Principal](./replaySystem.js)
- [Análise de Aplicação](./REPLAY_APPLICATION_ANALYSIS.md)
- [Status de Implementação](./REPLAY_IMPLEMENTATION_STATUS.md)
- [Resumo de Implementação](./REPLAY_IMPLEMENTATION_SUMMARY.md)
