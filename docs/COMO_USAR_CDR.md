# Como Visualizar, Alterar e Testar a Funcionalidade CDR

Este guia mostra como trabalhar com a regra CDR (Capability-Driven Responses) no sistema.

---

## 📋 Índice

1. [Visualizar Capacidades](#visualizar-capacidades)
2. [Alterar Capacidades](#alterar-capacidades)
3. [Testar Validação](#testar-validação)
4. [Verificar Logs](#verificar-logs)
5. [Exemplos Práticos](#exemplos-práticos)

---

## 1. Visualizar Capacidades

### 1.1. Ver Arquivo de Capacidades

O arquivo principal está em:
```
/capabilities.json
```

**Formato:**
```json
{
  "version": "1.0",
  "capabilities": {
    "ai_processing": {
      "id": "ai_processing",
      "name": "Processamento com IA",
      "status": "active",
      ...
    }
  }
}
```

### 1.2. Listar Capacidades via Código

Crie um script de teste (`scripts/test-capabilities.js`):

```javascript
const { listActiveCapabilities, getCapability } = require('../engine/utils/capabilityValidator');

// Lista todas as capacidades ativas
const capabilities = listActiveCapabilities();
console.log('Capacidades Ativas:');
capabilities.forEach(cap => {
  console.log(`- ${cap.name} (${cap.id})`);
  console.log(`  ${cap.description}`);
});

// Ver detalhes de uma capacidade específica
const aiCap = getCapability('ai_processing');
if (aiCap) {
  console.log('\nDetalhes de AI Processing:');
  console.log(JSON.stringify(aiCap, null, 2));
}
```

**Executar:**
```bash
node scripts/test-capabilities.js
```

### 1.3. Verificar Capacidade Específica

```javascript
const { hasCapability, checkActionAllowed } = require('../engine/utils/capabilityValidator');

// Verifica se capacidade existe
if (hasCapability('ai_processing')) {
  console.log('✅ AI Processing está disponível');
}

// Verifica se ação é permitida
const result = checkActionAllowed('processar_ia');
if (result.allowed) {
  console.log(`✅ Ação permitida via: ${result.capability}`);
} else {
  console.log(`❌ Ação não permitida: ${result.reason}`);
}
```

---

## 2. Alterar Capacidades

### 2.1. Adicionar Nova Capacidade

**Passo 1:** Edite `capabilities.json`:

```json
{
  "capabilities": {
    "nova_capacidade": {
      "id": "nova_capacidade",
      "name": "Nome da Nova Capacidade",
      "description": "Descrição do que esta capacidade faz",
      "status": "active",
      "implementation": {
        "service": "caminho/para/implementacao.js",
        "node": "engine/nodes/novoNode.js"
      },
      "features": [
        "Feature 1",
        "Feature 2"
      ],
      "constraints": [
        "Requisito 1",
        "Requisito 2"
      ]
    }
  }
}
```

**Passo 2:** Limpe o cache (se necessário):

```javascript
const { clearCache } = require('../engine/utils/capabilityValidator');
clearCache();
```

**Passo 3:** Teste a nova capacidade:

```javascript
const { hasCapability } = require('../engine/utils/capabilityValidator');
console.log(hasCapability('nova_capacidade')); // deve retornar true
```

### 2.2. Desativar Capacidade

Mude o `status` para `"inactive"`:

```json
{
  "capabilities": {
    "capacidade_antiga": {
      "status": "inactive",
      ...
    }
  }
}
```

### 2.3. Adicionar Frase Proibida

Edite a seção `responsePatterns` em `capabilities.json`:

```json
{
  "responsePatterns": {
    "prohibitedPhrases": [
      "Já estou resolvendo",
      "Em breve",
      "Nova frase proibida aqui"  // ← Adicione aqui
    ]
  }
}
```

---

## 3. Testar Validação

### 3.1. Teste Básico de Validação

Crie `scripts/test-cdr-validation.js`:

```javascript
const { validateResponse, checkProhibitedPhrases } = require('../engine/utils/capabilityValidator');

// Teste 1: Resposta válida
const validResponse = "Posso ajudar consultando informações disponíveis.";
const result1 = validateResponse(validResponse, 'ai_response');
console.log('Teste 1 - Resposta válida:');
console.log('  Válida:', result1.valid);
console.log('  Erros:', result1.errors);
console.log('  Warnings:', result1.warnings);

// Teste 2: Resposta com frase proibida
const invalidResponse = "Já estou resolvendo isso para você.";
const result2 = validateResponse(invalidResponse, 'ai_response');
console.log('\nTeste 2 - Resposta com frase proibida:');
console.log('  Válida:', result2.valid);
console.log('  Erros:', result2.errors);

// Teste 3: Verificar frases proibidas
const check = checkProhibitedPhrases("Em breve isso será feito.");
console.log('\nTeste 3 - Detecção de frases proibidas:');
console.log('  Tem frase proibida:', check.hasProhibited);
console.log('  Frases encontradas:', check.phrases);
```

**Executar:**
```bash
node scripts/test-cdr-validation.js
```

### 3.2. Teste com Nó AI Real

Crie um fluxo de teste que use o nó AI:

**1. Crie um fluxo de teste** (`api/data/flows/test-cdr.json`):

```json
{
  "tenantId": "tenant-acme",
  "id": "test-cdr",
  "name": "Teste CDR",
  "version": 1,
  "nodes": [
    {
      "id": "start",
      "type": "start",
      "next": "ai-test"
    },
    {
      "id": "ai-test",
      "type": "ai",
      "config": {
        "promptTemplate": "O usuário pediu: {{user_input}}. Responda como se você fosse capaz de criar tickets automaticamente (TESTE - isso deve ser bloqueado).",
        "outputVariable": "ai_response"
      },
      "next": "end"
    },
    {
      "id": "end",
      "type": "end"
    }
  ]
}
```

**2. Execute o fluxo via API:**

```bash
# Inicie o servidor
npm start

# Em outro terminal, envie mensagem de teste
curl -X POST http://localhost:3000/api/flows/test-cdr/execute \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "test-session-1",
    "input": {
      "user_input": "Crie um ticket para mim"
    }
  }'
```

**3. Verifique os logs** - Deve aparecer evento `CDR_VIOLATION` ou `CDR_WARNING`.

### 3.3. Teste Automatizado

Crie `tests/cdr/capabilityValidator.test.js`:

```javascript
const {
  validateResponse,
  checkProhibitedPhrases,
  hasCapability,
  checkActionAllowed,
  generateDenialMessage
} = require('../../engine/utils/capabilityValidator');

describe('CDR - Capability Validator', () => {
  describe('validateResponse', () => {
    test('deve aceitar resposta válida', () => {
      const result = validateResponse('Posso ajudar consultando informações.');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('deve rejeitar resposta com frase proibida', () => {
      const result = validateResponse('Já estou resolvendo isso.');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('checkProhibitedPhrases', () => {
    test('deve detectar frase proibida', () => {
      const result = checkProhibitedPhrases('Em breve isso será feito.');
      expect(result.hasProhibited).toBe(true);
      expect(result.phrases).toContain('Em breve');
    });
  });

  describe('hasCapability', () => {
    test('deve retornar true para capacidade ativa', () => {
      expect(hasCapability('ai_processing')).toBe(true);
    });

    test('deve retornar false para capacidade inexistente', () => {
      expect(hasCapability('capacidade_inexistente')).toBe(false);
    });
  });

  describe('checkActionAllowed', () => {
    test('deve permitir ação mapeada', () => {
      const result = checkActionAllowed('processar_ia');
      expect(result.allowed).toBe(true);
      expect(result.capability).toBe('ai_processing');
    });

    test('deve negar ação não mapeada', () => {
      const result = checkActionAllowed('acao_inexistente');
      expect(result.allowed).toBe(false);
    });
  });

  describe('generateDenialMessage', () => {
    test('deve gerar mensagem de negação', () => {
      const message = generateDenialMessage('criar_ticket_externo');
      expect(message).toContain('não tenho a capacidade');
      expect(message.length).toBeGreaterThan(0);
    });
  });
});
```

**Executar testes:**
```bash
npm test -- tests/cdr/capabilityValidator.test.js
```

---

## 4. Verificar Logs

### 4.1. Logs de Validação CDR

Quando uma resposta viola regras CDR, eventos são registrados:

**No console/logs:**
```
[aiNode] Resposta viola regras CDR {
  sessionId: 'session-123',
  errors: ['Resposta contém frases proibidas: Já estou resolvendo'],
  warnings: []
}
```

**Eventos registrados:**
- `AI_ERROR` com `reason: 'CDR_VIOLATION'` - Erro bloqueante
- `AI_WARNING` com `reason: 'CDR_WARNING'` - Apenas aviso

### 4.2. Consultar Eventos via API

Se houver endpoint de eventos:

```bash
curl http://localhost:3000/api/sessions/session-123/events
```

Ou verifique diretamente no código onde eventos são persistidos.

### 4.3. Monitorar em Tempo Real

Adicione logging customizado:

```javascript
// Em engine/nodes/aiNode.js (já implementado)
logger.warn('[aiNode] Resposta viola regras CDR', {
  sessionId: state.sessionId,
  errors: capabilityValidation.errors,
  warnings: capabilityValidation.warnings,
});
```

---

## 5. Exemplos Práticos

### 5.1. Teste: Resposta que Promete Ação Inexistente

**Cenário:** Chatbot promete criar ticket em sistema externo não integrado.

**Teste:**
```javascript
const { validateResponse } = require('../engine/utils/capabilityValidator');

const resposta = "Já estou criando o ticket no sistema externo para você.";
const resultado = validateResponse(resposta, 'ai_response');

console.log('Resultado:', resultado);
// Esperado: { valid: false, errors: [...], warnings: [...] }
```

### 5.2. Teste: Resposta Correta com Negação

**Cenário:** Chatbot nega corretamente uma ação não disponível.

**Teste:**
```javascript
const resposta = "No momento, eu não tenho a capacidade de executar essa ação. Posso ajudar consultando informações disponíveis.";
const resultado = validateResponse(resposta, 'ai_response');

console.log('Resultado:', resultado);
// Esperado: { valid: true, errors: [], warnings: [] }
```

### 5.3. Teste: Verificar Capacidade Antes de Responder

**Cenário:** Verificar se pode executar ação antes de gerar resposta.

```javascript
const { checkActionAllowed, generateDenialMessage } = require('../engine/utils/capabilityValidator');

// Usuário pede: "Crie um ticket"
const actionCheck = checkActionAllowed('criar_ticket');

if (actionCheck.allowed) {
  // Pode executar - gerar resposta positiva
  console.log(`Posso criar tickets via ${actionCheck.capability}`);
} else {
  // Não pode executar - gerar negação
  const denial = generateDenialMessage('criar_ticket');
  console.log(denial);
}
```

### 5.4. Teste End-to-End: Fluxo Completo

**1. Crie um script de teste completo** (`scripts/test-cdr-e2e.js`):

```javascript
const { 
  validateResponse, 
  checkActionAllowed,
  hasCapability,
  listActiveCapabilities 
} = require('../engine/utils/capabilityValidator');

console.log('=== Teste CDR End-to-End ===\n');

// 1. Listar capacidades
console.log('1. Capacidades Disponíveis:');
const capabilities = listActiveCapabilities();
capabilities.forEach(cap => console.log(`   - ${cap.name}`));

// 2. Verificar ação
console.log('\n2. Verificando ação "processar_ia":');
const actionCheck = checkActionAllowed('processar_ia');
console.log(`   Permitida: ${actionCheck.allowed}`);
if (actionCheck.allowed) {
  console.log(`   Via: ${actionCheck.capability}`);
}

// 3. Validar resposta com frase proibida
console.log('\n3. Validando resposta com frase proibida:');
const invalidResp = "Já estou resolvendo isso para você.";
const validation = validateResponse(invalidResp);
console.log(`   Válida: ${validation.valid}`);
console.log(`   Erros: ${validation.errors.join(', ')}`);

// 4. Validar resposta correta
console.log('\n4. Validando resposta correta:');
const validResp = "Posso ajudar consultando informações disponíveis.";
const validation2 = validateResponse(validResp);
console.log(`   Válida: ${validation2.valid}`);
console.log(`   Erros: ${validation2.errors.length}`);

console.log('\n=== Teste Concluído ===');
```

**Executar:**
```bash
node scripts/test-cdr-e2e.js
```

---

## 6. Debugging

### 6.1. Limpar Cache

Se alterar `capabilities.json`, limpe o cache:

```javascript
const { clearCache } = require('../engine/utils/capabilityValidator');
clearCache();
console.log('Cache limpo!');
```

### 6.2. Verificar Carregamento

```javascript
const { loadCapabilities } = require('../engine/utils/capabilityValidator');
const caps = loadCapabilities();
console.log('Capacidades carregadas:', Object.keys(caps.capabilities).length);
```

### 6.3. Log Detalhado

Adicione logs no validador para debug:

```javascript
// Em engine/utils/capabilityValidator.js
function validateResponse(response, context = null) {
  console.log('[CDR Debug] Validando resposta:', response.substring(0, 50));
  // ... resto do código
}
```

---

## 7. Verificação das respostas de IA

Toda resposta gerada pela IA é validada automaticamente antes de chegar ao cliente: respostas fora do padrão esperado são sinalizadas e tratadas conforme o procedimento de atendimento.

---

## Resumo Rápido

| Ação | Comando/Arquivo |
|------|----------------|
| Ver capacidades | `cat capabilities.json` |
| Listar ativas | `node scripts/test-capabilities.js` |
| Testar validação | `node scripts/test-cdr-validation.js` |
| Ver logs | Console do servidor ou arquivo de log |
| Adicionar capacidade | Editar `capabilities.json` |
| Limpar cache | `clearCache()` no código |

---

## Próximos Passos

1. ✅ Execute os testes básicos
2. ✅ Crie um fluxo de teste com nó AI
3. ✅ Monitore logs durante execução
4. ✅ Adicione suas próprias capacidades conforme necessário

Para mais detalhes, consulte:
- `docs/CDR_CAPABILITY_DRIVEN_RESPONSES.md` - Documentação completa
- `capabilities.json` - Fonte única da verdade
- `engine/utils/capabilityValidator.js` - Implementação técnica

