# Como Usar o Replay

O sistema de replay permite visualizar a execução completa de uma conversa, incluindo todos os eventos, estados intermediários e transições entre nós.

## 📋 Visão Geral

O replay funciona em duas etapas:

1. **Simulação/Execução**: Quando você simula um fluxo ou executa uma conversa real, o sistema gera eventos e armazena com um `sessionId`
2. **Visualização**: Você pode buscar o replay completo usando o `sessionId`

## 🔧 Endpoints

### 1. Simular um Fluxo (gera sessionId)

```bash
POST /flows/simulate
Content-Type: application/json

{
  "flowId": "flow-welcome",
  "maxSteps": 10,
  "startNodeId": "start"  // opcional
}
```

**Resposta:**
```json
{
  "compiledFlowInfo": { ... },
  "replay": {
    "sessionId": "session-1234567890",
    "flowId": "flow-welcome",
    "steps": [ ... ],
    "events": [ ... ]
  },
  "events": [ ... ],
  "finalState": { ... }
}
```

### 2. Buscar Replay por SessionId

```bash
GET /replay/:sessionId
```

**Exemplo:**
```bash
curl -X GET http://localhost:3000/replay/session-1234567890
```

**Resposta:**
```json
{
  "sessionId": "session-1234567890",
  "flowId": "flow-welcome",
  "steps": [
    {
      "step": 1,
      "nodeId": "start",
      "nodeType": "start",
      "timestamp": "2026-01-02T12:00:00.000Z",
      "input": null,
      "output": null,
      "state": { ... }
    },
    {
      "step": 2,
      "nodeId": "welcome_message",
      "nodeType": "message",
      "timestamp": "2026-01-02T12:00:01.000Z",
      "input": null,
      "output": {
        "type": "message",
        "text": "Olá! 👋 Bem-vindo ao nosso atendimento."
      },
      "state": { ... }
    }
  ],
  "events": [ ... ],
  "metadata": { ... }
}
```

## 💻 Exemplos Práticos

### Exemplo 1: Simular e Ver Replay (cURL)

```bash
# 1. Simular fluxo
RESPONSE=$(curl -s -X POST http://localhost:3000/flows/simulate \
  -H "Content-Type: application/json" \
  -d '{
    "flowId": "flow-welcome",
    "maxSteps": 10
  }')

# 2. Extrair sessionId
SESSION_ID=$(echo $RESPONSE | jq -r '.replay.sessionId')

# 3. Buscar replay
curl -X GET http://localhost:3000/replay/$SESSION_ID | jq '.'
```

### Exemplo 2: Usando o Script de Exemplo

```bash
# Tornar executável
chmod +x scripts/exemplo-replay.sh

# Executar
./scripts/exemplo-replay.sh
```

### Exemplo 3: JavaScript/Node.js

```javascript
const fetch = require('node-fetch');

async function verReplay() {
  // 1. Simular fluxo
  const simulateResponse = await fetch('http://localhost:3000/flows/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      flowId: 'flow-welcome',
      maxSteps: 10
    })
  });
  
  const simulateData = await simulateResponse.json();
  const sessionId = simulateData.replay.sessionId;
  
  console.log('SessionId:', sessionId);
  
  // 2. Buscar replay
  const replayResponse = await fetch(`http://localhost:3000/replay/${sessionId}`);
  const replayData = await replayResponse.json();
  
  console.log('Replay completo:', JSON.stringify(replayData, null, 2));
  
  // 3. Mostrar resumo
  console.log(`Total de steps: ${replayData.steps.length}`);
  console.log(`Total de eventos: ${replayData.events.length}`);
}

verReplay();
```

### Exemplo 4: Frontend (React)

```javascript
import { simulateFlow, getReplay } from './api/flows';

async function exemploReplay() {
  // 1. Simular fluxo
  const result = await simulateFlow('flow-welcome', { maxSteps: 10 });
  const sessionId = result.replay.sessionId;
  
  // 2. Buscar replay
  const replay = await getReplay(sessionId);
  
  // 3. Usar os dados
  console.log('Steps:', replay.steps);
  console.log('Events:', replay.events);
  
  // Renderizar na UI
  replay.steps.forEach(step => {
    console.log(`Step ${step.step}: ${step.nodeId} (${step.nodeType})`);
    if (step.output) {
      console.log(`  Output:`, step.output);
    }
  });
}
```

## 📊 Estrutura do Replay

O replay contém:

- **sessionId**: ID único da sessão
- **flowId**: ID do fluxo executado
- **steps**: Array de passos da execução
  - `step`: Número do passo
  - `nodeId`: ID do nó executado
  - `nodeType`: Tipo do nó
  - `timestamp`: Quando foi executado
  - `input`: Input recebido (se houver)
  - `output`: Output gerado (se houver)
  - `state`: Estado da conversa neste ponto
- **events**: Array de eventos da engine
- **metadata**: Metadados adicionais

## 🔍 Casos de Uso

### Debug de Fluxos
Use o replay para entender exatamente o que aconteceu durante a execução:
- Quais nós foram executados
- Em que ordem
- Quais inputs/outputs foram gerados
- Qual era o estado em cada momento

### Auditoria
O replay fornece um registro completo e imutável da conversa, útil para:
- Análise de problemas
- Melhoria de fluxos
- Treinamento de agentes

### Desenvolvimento
Durante o desenvolvimento, use o replay para:
- Validar lógica de fluxos
- Testar diferentes cenários
- Verificar transições entre nós

## ⚠️ Notas Importantes

1. **SessionId é único**: Cada simulação/execução gera um novo sessionId
2. **Eventos são armazenados em memória**: Se o servidor reiniciar, os replays antigos serão perdidos
3. **Limite de steps**: Use `maxSteps` para limitar a simulação (padrão: 100, máximo: 1000)
4. **Performance**: Replays muito grandes podem ser lentos para processar

## 🚀 Próximos Passos

- Execute uma simulação: `POST /flows/simulate`
- Obtenha o sessionId da resposta
- Busque o replay: `GET /replay/:sessionId`
- Analise os steps e events para entender a execução

