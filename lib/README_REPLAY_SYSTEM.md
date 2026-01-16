# 🎬 Sistema de Replay - Módulo Reutilizável

## 📋 Visão Geral

O **Sistema de Replay** é um módulo reutilizável que permite gravar, armazenar e analisar execuções de qualquer tipo de processo automatizado. Ele pode ser usado em diferentes contextos do projeto.

## 🎯 Casos de Uso

### 1. **Testes RPA** (Playwright)
Grava ações de navegação, cliques, preenchimentos e captura screenshots.

### 2. **Testes de API**
Registra chamadas HTTP, respostas, status codes e tempos de resposta.

### 3. **Processos de Geração**
Rastreia geração de fluxos, RPAs, seeds, tenants, etc.

### 4. **Workflows/Orquestração**
Registra execução de workflows complexos passo a passo.

### 5. **Qualquer Processo Automatizado**
Pode ser usado para rastrear qualquer processo que precise ser reproduzido ou analisado.

## 📦 Instalação

O módulo está localizado em `lib/replaySystem.js` e pode ser importado em qualquer parte do projeto:

```javascript
const { ReplaySystem } = require('../lib/replaySystem');
// ou
const { ReplaySystem } = require('./lib/replaySystem');
```

## 🚀 Uso Básico

### Inicialização

```javascript
const replay = new ReplaySystem({
  storagePath: './replays',        // Onde salvar replays
  context: 'rpa',                  // Contexto (rpa, api, generation, etc.)
  enableScreenshots: true,          // Habilitar screenshots (se aplicável)
  enableActions: true,              // Habilitar registro de ações
  enableTimings: true,              // Habilitar registro de timings
});
```

### Gravação

```javascript
// Inicia gravação
replay.start('meu-processo-id', {
  // Metadados opcionais
  userId: 'user-123',
  processType: 'custom',
});

// Registra ações
replay.recordAction(
  { type: 'navigate', url: 'http://example.com' },
  { success: true }
);

// Registra telas/estados
await replay.recordScreen(page, 'step-1');

// Registra eventos
replay.recordEvent('milestone_reached', { data: 'value' });

// Registra erros
replay.recordError(error, 'step-name');

// Para e salva
replay.stop();
const filepath = replay.save('meu-processo');
```

## 📚 Exemplos por Contexto

### Testes RPA

```javascript
const replay = new ReplaySystem({
  storagePath: './tests/rpa/replay',
  context: 'rpa',
  enableScreenshots: true,
});

replay.start('test-login');
await page.goto('http://localhost:5173/login');
replay.recordAction(
  { type: 'navigate', url: 'http://localhost:5173/login' },
  { success: true }
);
await replay.recordScreen(page, 'after-navigation');
replay.stop();
replay.save('test-login');
```

### Testes de API

```javascript
const replay = new ReplaySystem({
  storagePath: './tests/api/replays',
  context: 'api',
  enableScreenshots: false,
});

replay.start('api-user-creation');
const startTime = new Date().toISOString();
const response = await fetch('/api/users', { method: 'POST', body: data });
const endTime = new Date().toISOString();

replay.recordAction(
  { type: 'api_call', endpoint: 'POST /api/users' },
  {
    success: response.ok,
    startTime,
    endTime,
    actual: { status: response.status },
  }
);
replay.stop();
replay.save('api-user-creation');
```

### Processos de Geração

```javascript
const replay = new ReplaySystem({
  storagePath: './replays/generation',
  context: 'generation',
});

replay.start('generate-tenant-xyz', {
  tenantName: 'XYZ Corp',
  requestedArtifacts: ['flow', 'rpa'],
});

replay.recordEvent('validation_started');
replay.recordAction(
  { type: 'validation', step: 'validate-input' },
  { success: true }
);
replay.recordEvent('generation_completed');
replay.stop();
replay.save('generate-tenant-xyz');
```

## 🔧 API Completa

### ReplaySystem

#### `constructor(options)`
Cria uma nova instância do sistema de replay.

**Opções:**
- `storagePath` (string): Caminho para armazenar replays
- `context` (string): Contexto do replay
- `enableScreenshots` (boolean): Habilitar screenshots
- `enableActions` (boolean): Habilitar ações
- `enableTimings` (boolean): Habilitar timings

#### `start(recordingId, metadata)`
Inicia gravação de replay.

#### `stop()`
Para gravação de replay.

#### `recordAction(action, result)`
Registra uma ação executada.

#### `recordScreen(pageOrData, stepName, additionalData)`
Registra uma tela/estado. Aceita página do Playwright ou dados genéricos.

#### `recordEvent(eventType, eventData)`
Registra um evento genérico.

#### `recordError(error, stepName, context)`
Registra um erro.

#### `addMetadata(metadata)`
Adiciona metadados customizados.

#### `save(filename)`
Salva replay em arquivo.

#### `getData()`
Retorna dados do replay atual.

### Métodos Estáticos

#### `ReplaySystem.load(filename, storagePath)`
Carrega replay de arquivo.

#### `ReplaySystem.list(storagePath, context)`
Lista todos os replays disponíveis.

#### `ReplaySystem.generateDiff(expected, actual)`
Compara dois replays e gera diff.

#### `ReplaySystem.generateReport(replay)`
Gera relatório de replay em texto.

## 📁 Estrutura de Dados

```json
{
  "id": "replay-1234567890-abc",
  "recordingId": "process-id",
  "context": "rpa",
  "startTime": "2026-01-10T15:00:00.000Z",
  "endTime": "2026-01-10T15:00:30.000Z",
  "screens": [...],
  "actions": [...],
  "events": [...],
  "timings": {
    "total": 30000,
    "steps": {}
  },
  "errors": [],
  "metadata": {}
}
```

## 🔄 Migração do Código Existente

Para migrar código que usa o replay antigo:

### Antes (tests/rpa/replaySystem.js)
```javascript
const { ReplaySystem } = require('./replaySystem');
```

### Depois (lib/replaySystem.js)
```javascript
const { ReplaySystem } = require('../lib/replaySystem');
// ou
const { ReplaySystem } = require('../../lib/replaySystem');
```

A API é compatível, então o código existente deve funcionar sem mudanças.

## 📍 Locais de Uso no Projeto

### 1. Testes RPA
- `tests/rpa/login.test.js`
- `tests/rpa/rpaTestRunner.js`
- `tests/rpa/player/rpaPlayer.js`

### 2. Processos de Geração
- `api/services/generationOrchestrator.js`
- `frontend/src/pages/GenerateSystemPage.jsx`

### 3. Testes de API
- `tests/endpoints/*.test.js`
- `tests/integration/*.test.js`

### 4. Workflows
- `engine/runner.js`
- `api/services/*Service.js`

## 🎨 Personalização

Você pode estender o sistema para contextos específicos:

```javascript
class CustomReplaySystem extends ReplaySystem {
  recordCustomAction(data) {
    this.recordAction(
      { type: 'custom', ...data },
      { success: true }
    );
  }
}
```

## 📊 Análise e Relatórios

```javascript
// Carregar replay
const replay = ReplaySystem.load('process-id');

// Gerar relatório
const report = ReplaySystem.generateReport(replay);
console.log(report);

// Listar replays
const replays = ReplaySystem.list('./replays', 'rpa');

// Comparar replays
const diff = ReplaySystem.generateDiff(baseline, current);
```

## ✅ Vantagens

1. **Reutilizável**: Um único módulo para todos os contextos
2. **Flexível**: Configurável para diferentes necessidades
3. **Genérico**: Não depende de tecnologias específicas
4. **Extensível**: Fácil de adicionar funcionalidades
5. **Consistente**: Mesma API em todo o projeto

## 📚 Referências

- [Exemplos de Uso](./replaySystem.examples.js)
- [Documentação Completa](../tests/rpa/SISTEMA_REPLAY.md)
