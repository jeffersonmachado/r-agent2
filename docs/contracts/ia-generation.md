# Contratos de Geração por IA

## Fonte de Verdade

**IMPORTANTE**: Este documento é DERIVADO e EXPLICATIVO. A fonte de verdade são os arquivos JSON:

- `contracts/ia/ia-generation-result.schema.json` - Contrato canônico do retorno
- `contracts/ia/ia-public-interface.json` - Contrato canônico da interface pública

Este documento MD serve apenas para explicar e contextualizar os contratos. Em caso de divergência, os arquivos JSON têm precedência.

## Visão Geral

O sistema de geração por IA possui dois contratos canônicos que formalizam:

1. **Estrutura de retorno** dos wrappers de IA (`IaGenerationResult`)
2. **Interface pública** declarando os únicos entry-points permitidos

## Contrato de Retorno (IaGenerationResult)

O contrato `ia-generation-result.schema.json` define a estrutura obrigatória de retorno de todos os wrappers de geração por IA.

### Campos Obrigatórios

- `success` (boolean): Indica se a geração foi bem-sucedida
- `domain` ("chatbot" | "rpa"): Domínio da geração
- `meta` (object): Metadados da geração
  - `prompt` (string): Identificador ou conteúdo do prompt utilizado
  - `ragVersion` (string): Versão do RAG utilizado (ou null)
  - `timestamp` (date-time): Timestamp ISO 8601 da geração

### Campos Condicionais

- `data` (object): **Obrigatório quando `success === true`**
  - Estrutura varia conforme o `domain`
  - Para `domain: "chatbot"`: contém o fluxo gerado
  - Para `domain: "rpa"`: contém o plano RPA gerado

- `errors` (array): **Obrigatório quando `success === false`**
  - Cada erro contém:
    - `code` (string): Código de erro estável
    - `message` (string): Mensagem descritiva
    - `source` ("schema" | "rag" | "gate" | "validator"): Origem do erro

### Regras de Validação

O schema garante que:
- Nunca permite `success=true` com `errors` presente
- Nunca permite `success=false` com `data` presente

## Interface Pública

O contrato `ia-public-interface.json` declara explicitamente os **únicos** entry-points públicos:

### Entry-Points Públicos

1. **`generateRpaTest`**
   - Domínio: `rpa`
   - Gera teste RPA a partir de input do usuário
   - Restrições:
     - `test-only`: planos devem ter `context.mode = 'test-only'`
     - `no-side-effects`: não persiste automaticamente
     - `gate-required`: deve passar pelo gate de validação

2. **`generateChatbotFlow`**
   - Domínio: `chatbot`
   - Gera fluxo de chatbot a partir de descrição em linguagem natural
   - Restrições:
     - `no-side-effects`: não persiste automaticamente
     - `gate-required`: deve passar pelo gate de validação

### Componentes Não Públicos

Os seguintes componentes são **internos** e não fazem parte da interface pública:

- **gate**: Gate de validação obrigatória (`validateGeneratedPlan`)
- **validators**: Validadores específicos (`validateFlowPlan`, `validateRpaPlan`)
- **ragLoaders**: Loaders e serviços de RAG
- **executors**: Executores de planos RPA e fluxos

## Relação entre Componentes

### Fluxo de Geração

1. **Prompt**: Define o que a IA deve gerar
   - `prompts/chatbot.generator.prompt.md` para chatbot
   - `prompts/rpa.generator.prompt.md` para RPA

2. **RAG**: Fornece contexto e limites (quando utilizado)
   - Define ações permitidas (ex: `rpa.actions.json`)
   - Fornece exemplos e guardrails

3. **Schema**: Valida a FORMA (estrutura JSON)
   - Validação estrutural de tipos e campos obrigatórios
   - Fonte: `schema` nos erros

4. **Gate**: Valida a SEMÂNTICA (regras de negócio)
   - Validação de regras específicas do domínio
   - Fonte: `gate` nos erros
   - Componente: `validateGeneratedPlan`

5. **Validators**: Validadores específicos do domínio
   - `validateFlowPlan` para chatbot
   - `validateRpaPlan` para RPA
   - Fonte: `validator` nos erros

### Ordem de Validação

1. **Schema** valida FORMA primeiro (estrutura JSON)
2. **Gate** valida SEMÂNTICA depois (regras de negócio)
3. Se qualquer validação falhar, retorna `success: false` com `errors` apropriados

## Fontes de Erro

O campo `source` em cada erro indica a origem:

- **`schema`**: Erro de validação estrutural (tipos, campos obrigatórios)
- **`rag`**: Erro relacionado ao RAG (falha na consulta, chunks insuficientes)
- **`gate`**: Rejeição pelo gate de validação (regras semânticas não atendidas)
- **`validator`**: Erro de validador específico do domínio

## Versionamento

Os contratos são versionáveis através dos arquivos JSON. Alterações nos contratos devem ser refletidas nos schemas JSON, não apenas na documentação.

## Notas de Implementação

- Os wrappers atuais (`generateChatbotFlow`, `generateRpaTest`) retornam estruturas que devem ser mapeadas para este contrato canônico
- O campo `meta.ragVersion` pode ser `null` se o RAG não foi utilizado
- O campo `meta.prompt` pode ser um identificador (ex: "chatbot.generator.prompt.md") ou o conteúdo completo

