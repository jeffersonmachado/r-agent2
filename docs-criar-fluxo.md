# Guia: Criando um Fluxo de Chatbot Completo

Este guia mostra como criar um fluxo de chatbot simples, mas completo, usando a API. O exemplo inclui mensagens, entrada do usuário, roteamento condicional e variáveis.

---

## Estrutura Básica de um Fluxo

Um fluxo (`FlowDefinition`) é composto por:

```json
{
  "tenantId": "string",      // ID do tenant (ex: "tenant-demo")
  "id": "string",            // ID único do fluxo
  "name": "string",          // Nome descritivo
  "version": 1,              // Versão numérica
  "nodes": [                 // Array de nós do fluxo
    {
      "id": "string",        // ID único do nó
      "type": "string",      // Tipo do nó (start, message, router, etc.)
      "config": {},          // Configuração específica do nó (opcional)
      "next": "string|null"  // Próximo nó (opcional)
    }
  ],
  "metadata": {}              // Metadados adicionais (opcional)
}
```

---

## Tipos de Nós Disponíveis

### 1. `start` - Ponto de Entrada
- **Descrição**: Marca o início do fluxo
- **Config**: Nenhuma
- **next**: Obrigatório (próximo nó)

```json
{
  "id": "start-1",
  "type": "start",
  "next": "msg-1"
}
```

### 2. `message` - Mensagem de Saída
- **Descrição**: Envia uma mensagem ao usuário
- **Config**: 
  - `text` (string): Texto da mensagem
- **next**: Opcional

```json
{
  "id": "msg-1",
  "type": "message",
  "config": {
    "text": "Olá! Como posso ajudar?"
  },
  "next": "input-1"
}
```

### 3. `user_input` - Entrada do Usuário
- **Descrição**: Espera uma mensagem do usuário e armazena em uma variável
- **Config**:
  - `variable` (string, opcional): Nome da variável onde o input será salvo (padrão: `"user_input"`)
- **next**: Obrigatório
- **Input esperado**: `{ text: string }` (fornecido externamente ao executar o passo)

```json
{
  "id": "input-1",
  "type": "user_input",
  "config": {
    "variable": "userMessage"
  },
  "next": "router-1"
}
```

### 4. `router` - Roteamento Condicional
- **Descrição**: Direciona o fluxo baseado em condições
- **Config**:
  - `rules` (array): Lista de regras de roteamento
    - `condition` (object): Objeto de condição com:
      - `op` (string): Operador (`"always"`, `"equals"`, `"contains"`)
      - `var` (string): Nome da variável a verificar
      - `value` (any): Valor para comparação (para `equals` e `contains`)
    - `next` (string): Próximo nó se a condição for verdadeira
  - `next` (string, opcional): Próximo nó padrão se nenhuma regra corresponder
- **next**: Opcional (usado como fallback)

**Operadores disponíveis:**
- `"always"`: Sempre verdadeiro (útil para fallback)
- `"equals"`: Verifica se `variables[var] === value`
- `"contains"`: Verifica se `variables[var]` contém `value` (case-insensitive)

```json
{
  "id": "router-1",
  "type": "router",
  "config": {
    "rules": [
      {
        "condition": {
          "op": "equals",
          "var": "userMessage",
          "value": "sim"
        },
        "next": "msg-sim"
      },
      {
        "condition": {
          "op": "equals",
          "var": "userMessage",
          "value": "não"
        },
        "next": "msg-nao"
      },
      {
        "condition": {
          "op": "always"
        },
        "next": "msg-default"
      }
    ]
  }
}
```

### 5. `set_variable` - Definir Variável
- **Descrição**: Armazena valores no contexto da conversa
- **Config**:
  - `assignments` (object): Objeto com pares chave-valor onde cada chave é o nome da variável e o valor é o que será armazenado
- **next**: Obrigatório

```json
{
  "id": "set-var-1",
  "type": "set_variable",
  "config": {
    "assignments": {
      "userName": "João",
      "age": 30
    }
  },
  "next": "msg-2"
}
```

### 6. `handoff` - Transferência para Humano
- **Descrição**: Transfere a conversa para um agente humano
- **Config**:
  - `queue` (string): Nome da fila de atendimento
- **next**: Opcional (geralmente `end`)

```json
{
  "id": "handoff-1",
  "type": "handoff",
  "config": {
    "queue": "suporte"
  },
  "next": "end-1"
}
```

### 7. `ai` - Nó de Inteligência Artificial
- **Descrição**: Processa input usando IA
- **Config**:
  - `promptTemplate` (string): Template do prompt (pode usar `{{variavel}}` para interpolação)
  - `outputVariable` (string, opcional): Variável para armazenar a resposta (padrão: `"ai_output"`)
  - `outputSchema` (object, opcional): Schema JSON para validar resposta estruturada
  - `fallbackText` (string, opcional): Texto de fallback se a IA falhar (padrão: mensagem genérica)
- **next**: Obrigatório

```json
{
  "id": "ai-1",
  "type": "ai",
  "config": {
    "promptTemplate": "Resuma a mensagem do usuário: {{userMessage}}",
    "outputVariable": "summary"
  },
  "next": "msg-2"
}
```

### 8. `end` - Fim do Fluxo
- **Descrição**: Marca o fim da conversa
- **Config**: Nenhuma
- **next**: Não aplicável (null)

```json
{
  "id": "end-1",
  "type": "end"
}
```

---

## Exemplo Completo: Fluxo de Atendimento Simples

Este exemplo cria um fluxo completo que:
1. Dá boas-vindas ao usuário
2. Solicita o nome do usuário
3. Armazena o nome em uma variável
4. Oferece ajuda
5. Roteia baseado na resposta
6. Finaliza a conversa

### Passo 1: Criar o Fluxo

```bash
curl -X POST http://localhost:3000/flows \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "tenant-demo",
    "id": "atendimento-basico",
    "name": "Atendimento Básico",
    "version": 1,
    "nodes": [
      {
        "id": "start-1",
        "type": "start",
        "next": "msg-bemvindo"
      },
      {
        "id": "msg-bemvindo",
        "type": "message",
        "config": {
          "text": "Olá! Bem-vindo ao nosso atendimento. Qual é o seu nome?"
        },
        "next": "input-nome"
      },
      {
        "id": "input-nome",
        "type": "user_input",
        "config": {
          "variable": "userName"
        },
        "next": "msg-ajuda"
      },
      {
        "id": "msg-ajuda",
        "type": "message",
        "config": {
          "text": "Olá, {{userName}}! Como posso ajudar você hoje? (Digite 'sim' para ajuda ou 'não' para encerrar)"
        },
        "next": "input-resposta"
      },
      {
        "id": "input-resposta",
        "type": "user_input",
        "config": {
          "variable": "userMessage"
        },
        "next": "router-1"
      },
      {
        "id": "router-1",
        "type": "router",
        "config": {
          "rules": [
            {
              "condition": {
                "op": "equals",
                "var": "userMessage",
                "value": "sim"
              },
              "next": "msg-ajuda-detalhada"
            },
            {
              "condition": {
                "op": "equals",
                "var": "userMessage",
                "value": "não"
              },
              "next": "msg-despedida"
            },
            {
              "condition": {
                "op": "always"
              },
              "next": "msg-default"
            }
          ]
        }
      },
      {
        "id": "msg-ajuda-detalhada",
        "type": "message",
        "config": {
          "text": "Perfeito! Vou te ajudar. Em que posso ser útil?"
        },
        "next": "handoff-1"
      },
      {
        "id": "msg-despedida",
        "type": "message",
        "config": {
          "text": "Tudo bem, {{userName}}! Foi um prazer ajudar. Até logo!"
        },
        "next": "end-1"
      },
      {
        "id": "msg-default",
        "type": "message",
        "config": {
          "text": "Desculpe, não entendi. Por favor, digite 'sim' ou 'não'."
        },
        "next": "input-resposta"
      },
      {
        "id": "handoff-1",
        "type": "handoff",
        "config": {
          "queue": "suporte"
        },
        "next": "end-1"
      },
      {
        "id": "end-1",
        "type": "end"
      }
    ]
  }'
```

### Passo 2: Validar o Fluxo

Antes de usar o fluxo, valide-o para garantir que não há erros estruturais:

```bash
curl -X POST http://localhost:3000/flows/validate \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "tenant-demo",
    "id": "atendimento-basico",
    "name": "Atendimento Básico",
    "version": 1,
    "nodes": [
      {
        "id": "start-1",
        "type": "start",
        "next": "msg-bemvindo"
      },
      {
        "id": "msg-bemvindo",
        "type": "message",
        "config": {
          "text": "Olá! Bem-vindo ao nosso atendimento. Qual é o seu nome?"
        },
        "next": "input-nome"
      },
      {
        "id": "input-nome",
        "type": "user_input",
        "config": {
          "variable": "userName"
        },
        "next": "msg-ajuda"
      },
      {
        "id": "msg-ajuda",
        "type": "message",
        "config": {
          "text": "Olá, {{userName}}! Como posso ajudar você hoje?"
        },
        "next": "end-1"
      },
      {
        "id": "end-1",
        "type": "end"
      }
    ]
  }'
```

**Resposta esperada:**
```json
{
  "valid": true,
  "errors": []
}
```

Se houver erros, a resposta incluirá detalhes:
```json
{
  "valid": false,
  "errors": [
    {
      "code": "NODE_DISCONNECTED",
      "message": "Existem nós não alcançáveis a partir de qualquer nó de entrada.",
      "nodeIds": ["node-orphan"],
      "details": {
        "entryNodes": ["start-1"]
      }
    }
  ]
}
```

### Passo 3: Simular o Fluxo

Teste o fluxo antes de colocá-lo em produção:

```bash
curl -X POST http://localhost:3000/flows/simulate \
  -H "Content-Type: application/json" \
  -d '{
    "flowId": "atendimento-basico",
    "maxSteps": 20
  }'
```

**Resposta esperada:**
```json
{
  "compiledFlowInfo": {
    "id": "atendimento-basico",
    "version": 1,
    "versionHash": "..."
  },
  "steps": [
    {
      "index": 0,
      "stateBefore": {...},
      "stateAfter": {...},
      "output": {
        "type": "start"
      },
      "events": [...]
    },
    ...
  ],
  "events": [...],
  "replay": {
    "sessionId": "...",
    "flowId": "atendimento-basico",
    "messages": [
      {
        "from": "bot",
        "text": "Olá! Bem-vindo ao nosso atendimento. Qual é o seu nome?",
        "at": "2025-12-17T..."
      }
    ],
    "handoffs": [],
    "nodesVisited": [
      {
        "nodeId": "start-1",
        "at": "2025-12-17T..."
      }
    ],
    "rawEvents": [...]
  }
}
```

### Passo 4: Consultar o Replay

Após simular, você pode consultar o replay usando o `sessionId` retornado:

```bash
curl http://localhost:3000/replay/{sessionId}
```

---

## Regras de Conexão entre Nós

Nem todos os tipos de nós podem ser conectados diretamente. As regras são:

| De | Para |
|----|------|
| `start` | `message`, `user_input`, `router`, `set_variable`, `handoff`, `ai`, `end` |
| `message` | `user_input`, `router`, `set_variable`, `handoff`, `ai`, `end` |
| `user_input` | `router`, `message`, `set_variable`, `handoff`, `ai`, `end` |
| `router` | `message`, `user_input`, `set_variable`, `handoff`, `ai`, `end` |
| `set_variable` | `message`, `user_input`, `router`, `handoff`, `ai`, `end` |
| `ai` | `message`, `user_input`, `router`, `set_variable`, `handoff`, `end` |
| `handoff` | `end` |
| `end` | (nenhum) |

**Exemplos de conexões inválidas:**
- `handoff` → `message` ❌ (handoff só pode ir para `end`)
- `end` → qualquer nó ❌ (end não pode ter conexões de saída)

---

## Variáveis e Templates

Você pode usar variáveis e templates em mensagens e prompts de IA:

### Variáveis Disponíveis

- `{{nomeDaVariavel}}` - Acessa variáveis definidas com `set_variable` ou `user_input`
  - Exemplo: `{{userName}}` acessa `variables.userName`

### Exemplos

**Em mensagens:**
```json
{
  "type": "message",
  "config": {
    "text": "Olá, {{userName}}! Como você está?"
  }
}
```

**Em prompts de IA:**
```json
{
  "type": "ai",
  "config": {
    "promptTemplate": "O usuário disse: {{userMessage}}. Resuma em uma frase.",
    "outputVariable": "summary"
  }
}
```

**Em condições de router:**
```json
{
  "type": "router",
  "config": {
    "rules": [
      {
        "condition": {
          "op": "equals",
          "var": "userMessage",
          "value": "sim"
        },
        "next": "msg-sim"
      }
    ]
  }
}
```

**Nota**: Templates (`{{variavel}}`) funcionam apenas em `message.config.text` e `ai.config.promptTemplate`. Em routers, use o objeto de condição com `var` para acessar variáveis.

---

## Dicas e Boas Práticas

1. **Sempre comece com um nó `start`**
   - O fluxo precisa de um ponto de entrada claro

2. **Termine com um nó `end`**
   - Fluxos devem ter um fim explícito

3. **Valide antes de usar**
   - Use `POST /flows/validate` para verificar erros estruturais

4. **Teste com simulação**
   - Use `POST /flows/simulate` para testar o comportamento

5. **Use variáveis para contexto**
   - Armazene informações do usuário em variáveis para reutilizar

6. **Roteamento com fallback**
   - Sempre defina um `next` padrão em routers para casos não cobertos

7. **Nomes descritivos**
   - Use IDs e nomes claros (ex: `msg-bemvindo` em vez de `msg1`)

---

## Exemplo Mínimo (Hello World)

Fluxo mais simples possível:

```bash
curl -X POST http://localhost:3000/flows \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "tenant-demo",
    "id": "hello-world",
    "name": "Hello World",
    "version": 1,
    "nodes": [
      {
        "id": "start-1",
        "type": "start",
        "next": "msg-1"
      },
      {
        "id": "msg-1",
        "type": "message",
        "config": {
          "text": "Olá, mundo!"
        },
        "next": "end-1"
      },
      {
        "id": "end-1",
        "type": "end"
      }
    ]
  }'
```

---

## Próximos Passos

- Explore o frontend em `http://localhost:8080` para criar fluxos visualmente
- Consulte a documentação da API em `docs-deploy.md`
- Veja exemplos de fluxos mais complexos nos testes em `engine/__tests__/functionalFlows.test.js`

