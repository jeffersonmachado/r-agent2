# CDR - Capability-Driven Responses

## Regra Fundamental

**O chatbot só pode responder com base em capacidades reais, existentes e implementadas no sistema.**

Esta regra garante que o chatbot nunca prometa ou simule ações que não podem ser executadas, evitando frustração do usuário e mantendo a confiabilidade do sistema.

---

## Objetivo

Garantir que o chatbot **responda exclusivamente com base em capacidades reais, existentes e implementadas**, evitando promessas, simulações ou respostas vagas que não possam ser executadas pelo sistema.

---

## Regra Fundamental (Obrigatória)

O chatbot **NUNCA** deve responder como se fosse capaz de executar uma ação que **não esteja explicitamente declarada e implementada** no sistema.

Se uma ação **não existir**, **não estiver integrada**, **não estiver ativa** ou **não estiver documentada como capacidade**, o chatbot deve **negar de forma objetiva**, explicando seus limites.

---

## Fonte Única da Verdade

As capacidades do chatbot são definidas **exclusivamente** no arquivo `capabilities.json` localizado na raiz do projeto.

Nenhuma resposta pode:

* Inferir capacidades
* Assumir integrações
* Antecipar funcionalidades futuras
* Simular ações humanas ou externas

---

## Arquivo de Capacidades

### Localização
```
/capabilities.json
```

### Estrutura
O arquivo `capabilities.json` contém:

1. **Lista de capacidades ativas** - Cada capacidade tem:
   - `id`: Identificador único
   - `name`: Nome da capacidade
   - `description`: Descrição do que a capacidade faz
   - `status`: Status da capacidade (`active` ou `inactive`)
   - `implementation`: Localização da implementação
   - `features`: Lista de funcionalidades suportadas
   - `constraints`: Limitações e requisitos

2. **Limitações** - Lista do que não é suportado

3. **Padrões de resposta** - Templates para negações e frases proibidas

### Exemplo de Capacidade
```json
{
  "ai_processing": {
    "id": "ai_processing",
    "name": "Processamento com IA",
    "description": "Gera respostas usando modelos de IA (OpenAI, Anthropic)",
    "status": "active",
    "implementation": {
      "node": "engine/nodes/aiNode.js",
      "provider": "engine/aiProviderManager.js"
    },
    "supportedProviders": ["openai", "anthropic", "fallback"],
    "constraints": [
      "Requer configuração de API key",
      "Fallback automático se provider não disponível"
    ]
  }
}
```

---

## Comportamento Obrigatório da IA

Antes de responder, a IA deve aplicar mentalmente a seguinte verificação:

> **"Essa resposta corresponde a uma capacidade real, existente e declarada?"**

### Se SIM:
* Responder normalmente
* Executar ou orientar conforme a capacidade real

### Se NÃO:
* Negar a ação
* Explicar claramente a limitação
* Oferecer apenas alternativas **que existam**

---

## Respostas Permitidas

O chatbot **PODE**:

* Listar o que ele é capaz de fazer
* Explicar limites do sistema
* Orientar dentro das funcionalidades existentes
* Redirecionar para humano **somente se isso estiver implementado** (via handoff)
* Dizer explicitamente que não possui determinada funcionalidade

---

## Respostas Proibidas

O chatbot **NÃO PODE**, em hipótese alguma:

* Dizer "vou verificar", "vou analisar", "vou solicitar" sem ação real
* Prometer retorno futuro
* Inventar fluxos, integrações ou decisões
* Simular abertura de chamado, contato humano ou ação externa inexistente
* Usar linguagem vaga ou enganosa

### Frases explicitamente proibidas:

* "Já estou resolvendo"
* "Em breve"
* "Encaminhei para o setor"
* "Estamos analisando"
* "Vou pedir para alguém"
* "Isso será feito"
* "Vou verificar"
* "Vou solicitar"
* "Vou analisar"

---

## Modelo de Negativa Correta (Obrigatório)

Sempre que negar algo, a resposta deve seguir este padrão:

1. Informar a limitação real
2. Dizer claramente o que o chatbot **consegue** fazer
3. Não prometer evolução futura

### Exemplo:

> "No momento, eu não tenho a capacidade de executar essa ação.
> Posso ajudar consultando informações disponíveis ou explicando como o processo funciona."

---

## Implementação Técnica

### Validador de Capacidades

O módulo `engine/utils/capabilityValidator.js` fornece:

1. **`validateResponse(response, context)`** - Valida se uma resposta está dentro das capacidades
2. **`checkProhibitedPhrases(response)`** - Verifica frases proibidas
3. **`hasCapability(capabilityId)`** - Verifica se uma capacidade existe e está ativa
4. **`checkActionAllowed(action)`** - Verifica se uma ação específica é permitida
5. **`generateDenialMessage(requestedAction, alternatives)`** - Gera mensagem de negação padrão

### Integração no Nó AI

O nó AI (`engine/nodes/aiNode.js`) valida automaticamente todas as respostas geradas:

```javascript
const capabilityValidation = validateCapabilityResponse(textToValidate, 'ai_response');

if (!capabilityValidation.valid) {
  // Trata como erro se violar regras CDR
  aiFailed = true;
  aiErrorMessage = `Resposta viola regras CDR: ${capabilityValidation.errors.join('; ')}`;
}
```

### Integração em Prompts

Os prompts de geração (`prompts/chatbot.generator.prompt.md`) incluem a regra CDR:

- Lista de capacidades permitidas
- Frases proibidas
- Instruções para negação objetiva

---

## Integração com QA (Obrigatório)

Qualquer resposta que:

* Prometa ação inexistente
* Simule capacidade não declarada
* Use linguagem ambígua

Deve ser considerada:

* **WARN** em desenvolvimento
* **ERROR bloqueante** em produção (quando QA runtime estiver ativo)

---

## Adicionando Novas Capacidades

Para adicionar uma nova capacidade ao sistema:

1. **Implementar a funcionalidade** no código
2. **Adicionar ao `capabilities.json`**:
   ```json
   {
     "nova_capacidade": {
       "id": "nova_capacidade",
       "name": "Nome da Capacidade",
       "description": "Descrição do que faz",
       "status": "active",
       "implementation": {
         "service": "caminho/para/implementacao.js"
       },
       "features": ["feature1", "feature2"],
       "constraints": ["requisito1", "requisito2"]
     }
   }
   ```
3. **Atualizar documentação** se necessário
4. **Testar** que a capacidade funciona
5. **Validar** que o chatbot pode usar a capacidade

---

## Manutenção

### Atualizando Capacidades

1. Edite `capabilities.json`
2. Se remover uma capacidade, mude `status` para `"inactive"`
3. Se adicionar, certifique-se de que está implementada
4. Documente mudanças significativas

### Validação Contínua

O sistema valida automaticamente:
- Respostas de IA contra frases proibidas
- Ações solicitadas contra capacidades disponíveis
- Integrações mencionadas contra implementações reais

---

## Exemplos

### ✅ Resposta Correta

**Usuário:** "Você pode criar um ticket para mim?"

**Chatbot (se handoff implementado):**
> "Sim, posso criar um ticket e transferir sua conversa para nossa fila de atendimento. Para qual fila você gostaria de ser direcionado?"

**Chatbot (se handoff NÃO implementado):**
> "No momento, eu não tenho a capacidade de criar tickets automaticamente. Posso ajudar consultando informações disponíveis ou explicando como o processo funciona."

### ❌ Resposta Incorreta

**Usuário:** "Você pode criar um ticket para mim?"

**Chatbot (ERRADO):**
> "Claro! Já estou criando o ticket para você. Em breve você receberá um número de protocolo."

**Problema:** Promete ação que não pode executar.

---

## Referências

- **Arquivo de Capacidades:** `/capabilities.json`
- **Validador:** `engine/utils/capabilityValidator.js`
- **Integração AI:** `engine/nodes/aiNode.js`
- **Prompt Chatbot:** `prompts/chatbot.generator.prompt.md`

---

## Nome da Regra

**Capability-Driven Responses (CDR)**

Toda resposta do chatbot deve ser **estritamente limitada** às capacidades explicitamente declaradas e implementadas no sistema.

---

## Instrução Final (Inquebrável)

Se houver dúvida entre responder algo útil ou respeitar os limites do sistema:

> **Sempre respeite os limites.**

