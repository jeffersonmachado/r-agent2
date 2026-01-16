# 📹 Sistema de Gravação - Módulo Reutilizável

## 📋 Visão Geral

O **Sistema de Gravação** (`lib/recordingSystem.js`) é um módulo genérico e reutilizável para gravar ações/operações em qualquer tipo de processo automatizado.

**Diferença do ReplaySystem:**
- **RecordingSystem**: Grava **O QUE foi feito** (ações, passos, operações)
- **ReplaySystem**: Grava **COMO foi executado** (timing, screenshots, erros, eventos)

Ambos são complementares e podem ser usados juntos!

---

## 🎯 Casos de Uso

### 1. **Testes RPA**
Grava ações do usuário (navegar, clicar, preencher) para reprodução posterior.

### 2. **Testes de API**
Grava chamadas de API (método, endpoint, body) para validação e reprodução.

### 3. **Processos de Geração**
Grava passos de geração (fluxo, RPA, seed) para auditoria e reprodução.

### 4. **Workflows**
Grava etapas de workflows para análise e debug.

### 5. **Qualquer Processo Automatizado**
Grava qualquer sequência de ações para análise posterior.

---

## 🚀 Uso Básico

### Importação

```javascript
const { RecordingSystem } = require('./lib/recordingSystem');
```

### Exemplo Simples

```javascript
const recording = new RecordingSystem({
  storagePath: './recordings/rpa',
  context: 'rpa',
});

// Inicia gravação
recording.start('meu-teste', {
  name: 'Teste de Login',
  description: 'Gravação do fluxo de login',
});

// Registra ações
recording.recordNavigate('http://localhost:5173/login');
recording.recordFill('input[name="username"]', 'user');
recording.recordClick('button[type="submit"]');

// Para e salva
recording.stop();
recording.save('meu-teste');
```

---

## 📚 API Completa

### Constructor

```javascript
const recording = new RecordingSystem({
  storagePath: './recordings',  // Caminho para salvar (default: ./recordings)
  context: 'rpa',                // Contexto (default: 'generic')
  enableTimestamps: false,       // Incluir timestamps (default: false)
});
```

### Métodos Principais

#### `start(recordingId, metadata)`
Inicia uma nova gravação.

```javascript
recording.start('test-123', {
  name: 'Teste Completo',
  description: 'Descrição do teste',
  version: '1.0.0',
  source: 'manual', // ou 'automatic'
});
```

#### `stop()`
Para a gravação.

```javascript
recording.stop();
```

#### `save(filename)`
Salva gravação em arquivo JSON.

```javascript
const filePath = recording.save('test-123');
// Retorna: ./recordings/test-123.json
```

---

### Métodos de Gravação

#### `recordAction(action)`
Registra uma ação genérica.

```javascript
recording.recordAction({
  type: 'custom',
  step: 'step-1',
  selector: 'button.submit',
  value: 'Submit',
  options: { timeout: 5000 },
});
```

#### `recordNavigate(url, options)`
Registra navegação.

```javascript
recording.recordNavigate('http://example.com', {
  step: 'go-to-home',
  waitFor: 'networkidle',
  timeout: 30000,
});
```

#### `recordClick(selector, options)`
Registra clique.

```javascript
recording.recordClick('button.submit', {
  step: 'submit-form',
  waitFor: 'visible',
  timeout: 30000,
});
```

#### `recordFill(selector, value, options)`
Registra preenchimento.

```javascript
recording.recordFill('input[name="email"]', 'user@example.com', {
  step: 'fill-email',
  clear: true,
  timeout: 30000,
});
```

#### `recordSelect(selector, value, options)`
Registra seleção.

```javascript
recording.recordSelect('select[name="country"]', 'BR', {
  step: 'select-country',
  timeout: 30000,
});
```

#### `recordWait(condition, options)`
Registra espera.

```javascript
recording.recordWait('text=/Success/', {
  step: 'wait-success',
  state: 'visible',
  timeout: 30000,
});
```

#### `recordApiCall(method, endpoint, options)`
Registra chamada de API.

```javascript
recording.recordApiCall('POST', '/api/login', {
  step: 'api-login',
  body: { username: 'user', password: 'pass' },
  headers: { 'Content-Type': 'application/json' },
  timeout: 5000,
});
```

#### `recordGeneration(generatorType, input, options)`
Registra ação de geração.

```javascript
recording.recordGeneration('flow', {
  description: 'Fluxo de atendimento',
  useRag: true,
}, {
  step: 'generate-flow',
});
```

#### `recordCustom(type, data)`
Registra ação customizada.

```javascript
recording.recordCustom('custom-action', {
  step: 'custom-step',
  data: { key: 'value' },
});
```

---

### Métodos Auxiliares

#### `addMetadata(metadata)`
Adiciona metadados à gravação.

```javascript
recording.addMetadata({
  userId: 'user-123',
  flowId: 'flow-456',
});
```

#### `addData(data)`
Adiciona dados à gravação.

```javascript
recording.addData({
  testData: { key: 'value' },
  config: { option: true },
});
```

#### `getData()`
Obtém dados da gravação atual.

```javascript
const data = recording.getData();
console.log(data.id, data.steps.length);
```

#### `getSteps()`
Obtém lista de passos.

```javascript
const steps = recording.getSteps();
```

#### `clearSteps()`
Limpa passos da gravação atual.

```javascript
recording.clearSteps();
```

---

### Métodos Estáticos

#### `RecordingSystem.load(filenameOrPath, storagePath)`
Carrega gravação de arquivo.

```javascript
// Por filename
const loaded = RecordingSystem.load('test-123', './recordings/rpa');

// Por caminho completo
const loaded = RecordingSystem.load('/path/to/test-123.json');

if (loaded) {
  console.log(loaded.name, loaded.steps.length);
}
```

#### `RecordingSystem.list(storagePath, context)`
Lista todas as gravações.

```javascript
// Todas as gravações
const all = RecordingSystem.list('./recordings');

// Apenas gravações RPA
const rpa = RecordingSystem.list('./recordings', 'rpa');
```

---

## 🔄 Integração com ReplaySystem

Os dois sistemas são complementares:

```javascript
const { RecordingSystem } = require('./lib/recordingSystem');
const { ReplaySystem } = require('./lib/replaySystem');

// Gravação (O QUE foi feito)
const recording = new RecordingSystem({ context: 'rpa' });

// Replay (COMO foi executado)
const replay = new ReplaySystem({ context: 'rpa' });

recording.start('test');
replay.start('test');

// Durante execução
recording.recordClick('button.submit', { step: 'submit' });
replay.recordAction(
  { type: 'click', step: 'submit', selector: 'button.submit' },
  { success: true, startTime: new Date().toISOString() }
);

recording.stop();
replay.stop();

recording.save('test');
replay.save('test');
```

---

## 📁 Estrutura de Dados

### Formato da Gravação

```json
{
  "id": "recording-123",
  "name": "Teste de Login",
  "version": "1.0.0",
  "context": "rpa",
  "createdAt": "2026-01-10T15:00:00.000Z",
  "steps": [
    {
      "type": "navigate",
      "step": "navigate",
      "url": "http://localhost:5173/login"
    },
    {
      "type": "fill",
      "step": "fill",
      "selector": "input[name='username']",
      "value": "user"
    }
  ],
  "metadata": {
    "description": "Descrição",
    "source": "manual"
  },
  "data": {}
}
```

---

## 🔧 Compatibilidade

### ActionRecorder (RPA)

O `ActionRecorder` em `tests/rpa/actionRecorder.js` agora é um **wrapper de compatibilidade** que usa `RecordingSystem` internamente. Código existente continua funcionando, mas novos desenvolvimentos devem usar `lib/recordingSystem.js` diretamente.

---

## 📝 Exemplos por Contexto

### RPA
```javascript
const recording = new RecordingSystem({
  storagePath: './recordings/rpa',
  context: 'rpa',
  enableTimestamps: false, // Seeds não devem ter timestamps
});
```

### API
```javascript
const recording = new RecordingSystem({
  storagePath: './recordings/api',
  context: 'api',
  enableTimestamps: true,
});
```

### Geração
```javascript
const recording = new RecordingSystem({
  storagePath: './recordings/generation',
  context: 'generation',
});
```

### Workflow
```javascript
const recording = new RecordingSystem({
  storagePath: './recordings/workflow',
  context: 'workflow',
});
```

---

## ✅ Benefícios

1. ✅ **Módulo reutilizável** - Usa em qualquer parte do projeto
2. ✅ **Contexto flexível** - Diferentes contextos (rpa, api, generation, etc.)
3. ✅ **Formato genérico** - Estrutura consistente para todos os tipos
4. ✅ **Compatibilidade** - ActionRecorder mantém compatibilidade
5. ✅ **Integração** - Funciona junto com ReplaySystem

---

## 📚 Referências

- [Módulo Principal](./recordingSystem.js)
- [Exemplos de Uso](./recordingSystem.examples.js)
- [Sistema de Replay](./README_REPLAY_SYSTEM.md)
