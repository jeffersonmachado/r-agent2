# 📹 Guia Rápido - Sistema de Gravação

## 🚀 Uso Rápido

### Importação

```javascript
const { RecordingSystem } = require('./lib/recordingSystem');
```

### Exemplo Mínimo

```javascript
const recording = new RecordingSystem({
  storagePath: './recordings/rpa',
  context: 'rpa',
});

recording.start('test-123');
recording.recordClick('button.submit');
recording.stop();
recording.save('test-123');
```

---

## 📍 Onde Usar

### 1. Testes RPA
```javascript
// tests/rpa/meu-teste.js
const { RecordingSystem } = require('../../lib/recordingSystem');
```

### 2. Testes de API
```javascript
// tests/api/meu-teste.js
const { RecordingSystem } = require('../../lib/recordingSystem');
```

### 3. Processos de Geração
```javascript
// api/services/generationOrchestrator.js
const { RecordingSystem } = require('../../lib/recordingSystem');
```

### 4. Workflows
```javascript
// api/services/pipelineOrchestrator.js
const { RecordingSystem } = require('../../lib/recordingSystem');
```

---

## 🎯 Padrão de Uso

```javascript
// 1. Cria instância
const recording = new RecordingSystem({
  storagePath: './recordings/contexto',
  context: 'contexto',
});

// 2. Inicia
recording.start('id-da-gravacao', {
  name: 'Nome da Gravação',
  description: 'Descrição',
});

// 3. Registra ações
recording.recordAction({ type: 'action', step: 'step-1' });

// 4. Para e salva
recording.stop();
recording.save('id-da-gravacao');
```

---

## 📚 Documentação Completa

Veja `lib/README_RECORDING_SYSTEM.md` para documentação completa.
