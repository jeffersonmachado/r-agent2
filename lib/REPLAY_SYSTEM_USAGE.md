# 🎬 Sistema de Replay - Guia de Uso

## 📍 Localização

O módulo centralizado está em: **`lib/replaySystem.js`**

## 🚀 Como Usar em Diferentes Partes do Projeto

### 1. Testes RPA

```javascript
const { ReplaySystem } = require('../lib/replaySystem');
// ou manter compatibilidade:
const { ReplaySystem } = require('./replaySystem'); // tests/rpa/replaySystem.js

const replay = new ReplaySystem({
  storagePath: './tests/rpa/replay',
  context: 'rpa',
  enableScreenshots: true,
});
```

### 2. Testes de API

```javascript
// Em tests/api/*.test.js
const { ReplaySystem } = require('../../lib/replaySystem');

const replay = new ReplaySystem({
  storagePath: './tests/api/replays',
  context: 'api',
  enableScreenshots: false,
});
```

### 3. Processos de Geração

```javascript
// Em api/services/generationOrchestrator.js
const { ReplaySystem } = require('../../lib/replaySystem');

const replay = new ReplaySystem({
  storagePath: './replays/generation',
  context: 'generation',
});
```

### 4. Engine/Workflows

```javascript
// Em engine/runner.js
const { ReplaySystem } = require('../lib/replaySystem');

const replay = new ReplaySystem({
  storagePath: './replays/engine',
  context: 'engine',
});
```

### 5. Qualquer Serviço

```javascript
// Em api/services/*Service.js
const { ReplaySystem } = require('../../lib/replaySystem');

const replay = new ReplaySystem({
  storagePath: './replays/services',
  context: 'service',
});
```

## 📝 Exemplo Completo

```javascript
const { ReplaySystem } = require('../lib/replaySystem');

async function meuProcesso() {
  const replay = new ReplaySystem({
    storagePath: './replays/meu-processo',
    context: 'custom',
  });

  replay.start('processo-123', {
    userId: 'user-456',
    processType: 'custom',
  });

  try {
    // Registra ações
    replay.recordAction(
      { type: 'step1', step: 'inicializacao' },
      { success: true }
    );

    // Registra eventos
    replay.recordEvent('milestone_reached', { data: 'value' });

    // Registra erros se houver
    // replay.recordError(error, 'step-name');

  } catch (error) {
    replay.recordError(error, 'processo-123');
  } finally {
    replay.stop();
    const filepath = replay.save('processo-123');
    console.log('Replay salvo:', filepath);
  }
}
```

## 🔄 Migração

### Código Antigo
```javascript
const { ReplaySystem } = require('./replaySystem'); // tests/rpa/replaySystem.js
```

### Código Novo (Recomendado)
```javascript
const { ReplaySystem } = require('../lib/replaySystem');
```

O código antigo continua funcionando por compatibilidade, mas novos desenvolvimentos devem usar o módulo centralizado.

## ✅ Vantagens do Módulo Centralizado

1. **Reutilizável**: Um único módulo para todo o projeto
2. **Configurável**: Adapta-se a diferentes contextos
3. **Genérico**: Não depende de tecnologias específicas
4. **Consistente**: Mesma API em todo o projeto
5. **Extensível**: Fácil de adicionar funcionalidades
