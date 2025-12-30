# Análise Comparativa: Log vs Template "Assistente com IA"

## Problema Identificado

O log de execução mostra que o fluxo falha ao processar o nó tipo `ai`:

```
#9 [Erro] 13:16:41
  Nó: 4 (ai)
  Ação: unsupported_node_type
  Erro: Tipo de nó não suportado: ai
```

## Comparação: Template vs Implementação

### Template `ai-assistant.json`

O template define um fluxo com os seguintes nós:

1. **start** (id: "start") → **welcome** (message)
2. **welcome** (id: "welcome", type: "message") → **collect-question** (user_input)
3. **collect-question** (id: "collect-question", type: "user_input") → **ai-process** (ai)
4. **ai-process** (id: "ai-process", type: "ai") → **show-response** (message)
5. **show-response** (id: "show-response", type: "message") → **end**
6. **end** (id: "end", type: "end")

**Configuração do nó `ai-process`:**
```json
{
  "id": "ai-process",
  "type": "ai",
  "config": {
    "promptTemplate": "O usuário perguntou: {{user_question}}. Responda de forma útil e amigável.",
    "outputVariable": "ai_response"
  },
  "next": "show-response"
}
```

### Implementação Anterior do `useFlowRunner`

O hook `useFlowRunner` **não suportava** o nó tipo `ai`, apenas:
- `start`
- `message`
- `user_input`
- `router`
- `ai_task` (diferente de `ai`)
- `end`

### Diferença entre `ai` e `ai_task`

- **`ai`**: Nó genérico de IA que usa `promptTemplate` e `outputVariable`
  - Config: `{ promptTemplate: "...", outputVariable: "..." }`
  - Usado no template `ai-assistant.json`

- **`ai_task`**: Nó especializado para tarefas específicas (intent_classification, entity_extraction, etc.)
  - Config: `{ task: "intent_classification", ... }`
  - Usado em outros fluxos

## Análise do Log

### Fluxo Executado (até o erro):

1. ✅ **Nó 1 (start)**: Fluxo iniciado corretamente
2. ✅ **Nó 2 (message)**: Mensagem enviada: "Olá! Sou um assistente virtual. Como posso ajudá-lo?"
3. ✅ **Nó 3 (user_input)**: Input recebido: "sei la", armazenado em variável
4. ❌ **Nó 4 (ai)**: **ERRO** - Tipo de nó não suportado
5. ⚠️ **Nó 5 (message)**: Tentou executar, mas mensagem mostra template não processado: "{{ai_response}}"

### Problemas Identificados:

1. **Nó `ai` não suportado**: O `useFlowRunner` não tinha implementação para o tipo `ai`
2. **Templates não processados**: As mensagens com `{{ai_response}}` não estavam sendo processadas (substituição de variáveis)
3. **Fluxo interrompido**: Após o erro, o fluxo continuou mas com dados incorretos

## Solução Implementada

### 1. Adicionado suporte ao nó tipo `ai`

Implementado no `useFlowRunner.js`:
- Processa `promptTemplate` substituindo variáveis `{{variavel}}`
- Gera resposta simulada (em modo de teste, sem chamada real à IA)
- Armazena resultado em `outputVariable`
- Registra eventos de log apropriados

### 2. Adicionada função `renderTemplate`

Função para processar templates de variáveis:
```javascript
renderTemplate("Olá {{nome}}!", { nome: "João" })
// Retorna: "Olá João!"
```

### 3. Processamento de templates em mensagens

Agora as mensagens também processam templates:
- `{{ai_response}}` será substituído pelo valor da variável `ai_response`
- Funciona em nós `message` e `end`

### 4. Logs melhorados

Adicionados eventos de log para:
- `IA_TASK_REQUEST`: Quando o nó `ai` é executado
- `IA_TASK_RESPONSE`: Quando a resposta é gerada (simulada)

## Resultado Esperado Após Correção

Com as correções, o fluxo deve executar assim:

1. ✅ **start** → Fluxo iniciado
2. ✅ **welcome** → Mensagem: "Olá! Sou um assistente virtual. Como posso ajudá-lo?"
3. ✅ **collect-question** → Input: "sei la" → armazenado em `user_question`
4. ✅ **ai-process** → Prompt renderizado: "O usuário perguntou: sei la. Responda de forma útil e amigável."
   - Resposta simulada gerada
   - Armazenada em `ai_response`
5. ✅ **show-response** → Mensagem: "[resposta da IA simulada]" (template `{{ai_response}}` processado)
6. ✅ **end** → Fluxo encerrado

## Notas Importantes

- **Modo de Teste**: O nó `ai` gera respostas simuladas no modo de teste
- **Produção**: Em produção, o nó `ai` deve fazer chamadas reais à API de IA
- **Templates**: Todos os templates `{{variavel}}` são processados automaticamente
- **Compatibilidade**: A implementação é compatível com o template `ai-assistant.json`

