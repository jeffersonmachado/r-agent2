# Governança de IA - Prompts Oficiais

## Propósito

Este diretório contém os **prompts oficiais** do projeto. Estes prompts orientam o comportamento da IA em diferentes contextos de geração e execução.

## Estrutura

```
prompts/
├── rag.guardrails.prompt.md      # Guardrails para geração controlada via RAG
├── chatbot.generator.prompt.md    # Geração de fluxos de chatbot
├── rpa.generator.prompt.md        # Geração de testes RPA
├── cursor.execution.prompt.md     # Regras de execução no Cursor
└── README.md                      # Este arquivo
```

## Papel dos Prompts

Os prompts **orientam** a IA, mas **não substituem** validações técnicas.

### Hierarquia de Controle

```
┌─────────────────────────────────────┐
│         PROMPT (Orientação)          │
│  - Define comportamento esperado     │
│  - Estabelece regras de geração      │
│  - Orienta a IA                      │
└──────────────┬──────────────────────┘
               │
               ↓
┌─────────────────────────────────────┐
│         RAG (Contexto)              │
│  - Fornece dados permitidos          │
│  - Define whitelist de ações         │
│  - Limita o espaço de geração        │
└──────────────┬──────────────────────┘
               │
               ↓
┌─────────────────────────────────────┐
│         SCHEMA (Estrutura)          │
│  - Define formato JSON válido        │
│  - Especifica tipos e propriedades   │
│  - Validação estrutural              │
└──────────────┬──────────────────────┘
               │
               ↓
┌─────────────────────────────────────┐
│    GATE DE VALIDAÇÃO (Enforcement)  │
│  - Validação estrutural obrigatória  │
│  - Verifica whitelist de ações       │
│  - Impõe regras do projeto           │
│  - BLOQUEIA saídas inválidas         │
└─────────────────────────────────────┘
```

## Relação entre Componentes

### Prompt → RAG → Schema → Gate

1. **Prompt**: Orienta a IA sobre o que gerar e como gerar
2. **RAG**: Fornece contexto e limitações (whitelist de ações, seletores, páginas)
3. **Schema**: Define a estrutura JSON válida
4. **Gate**: Valida e bloqueia saídas inválidas

### Princípio Fundamental

**O prompt orienta, mas o gate impõe.**

- A IA pode tentar gerar algo inválido (mesmo com prompt claro)
- O gate de validação **sempre** verifica e bloqueia saídas inválidas
- Nenhum prompt substitui a validação técnica

## Prompts Disponíveis

### rag.guardrails.prompt.md

**Uso:** Aplicado a todas as gerações controladas por RAG.

**Conteúdo:**
- Regras de uso exclusivo de RAG
- Proibições de invenção de componentes
- Formato de saída obrigatório
- Pipeline de validação

**Aplicação:** Injetado automaticamente em todas as chamadas de geração que usam RAG.

### chatbot.generator.prompt.md

**Uso:** Geração de fluxos de chatbot a partir de descrições em linguagem natural.

**Conteúdo:**
- Regras de uso do designer de fluxos
- Tipos de nós permitidos
- Formato de resposta JSON
- Validações estruturais

**Aplicação:** Usado por `api/services/flowGeneratorService.js` e `api/services/flowGenerator.js`.

### rpa.generator.prompt.md

**Uso:** Geração de testes RPA para validar fluxos de chatbot.

**Conteúdo:**
- Regras de geração de testes determinísticos
- Estratégia de inferência de caminhos
- Seletores permitidos
- Formato de teste RPA

**Aplicação:** Usado por `api/services/rpaTestGeneratorService.js`.

### cursor.execution.prompt.md

**Uso:** Execução de tarefas no Cursor IDE.

**Conteúdo:**
- Regras de arquitetura do projeto
- Proibições de alteração
- Princípios de centralização
- Checklist de conformidade

**Aplicação:** Referência permanente para execução de tarefas no Cursor.

## Versionamento

Os prompts são versionados através de:
- Controle de versão Git
- Histórico de alterações nos arquivos
- Tags de versão quando necessário

## Manutenção

### Quando Atualizar

- Mudanças nas regras de negócio
- Novos tipos de nós ou componentes
- Alterações no schema de validação
- Novas restrições de segurança

### Processo de Atualização

1. Atualizar o prompt oficial neste diretório
2. Verificar impacto nos serviços que usam o prompt
3. Testar geração com o novo prompt
4. Validar que o gate ainda funciona corretamente
5. Documentar mudanças

## Fonte Única da Verdade

**Este diretório (`prompts/`) é a ÚNICA fonte oficial de prompts.**

- Prompts antigos em outros locais deixam de ser referência
- Serviços devem carregar prompts deste diretório
- Nenhum prompt fora deste diretório é oficial

## Integração com o Sistema

### Carregamento de Prompts

Os serviços carregam prompts deste diretório:

- `api/services/flowGeneratorService.js` → `prompts/chatbot.generator.prompt.md`
- `api/services/rpaTestGeneratorService.js` → `prompts/rpa.generator.prompt.md`
- Guardrails RAG → `prompts/rag.guardrails.prompt.md`

### Validação

Após a geração, o resultado passa pelo gate de validação:

- `api/utils/validateFlowPlan.js` (para fluxos)
- `api/utils/validateRpaPlan.js` (para testes RPA)

O gate **sempre** valida, independentemente do prompt.

## Auditoria

Para auditoria de comportamento da IA:

1. Verificar qual prompt foi usado
2. Verificar qual RAG foi injetado
3. Verificar resultado da validação do gate
4. Comparar saída gerada com schema esperado

## Conclusão

Os prompts são parte essencial da governança de IA, mas são **complementares** às validações técnicas. O sistema é seguro porque:

- Prompt orienta
- RAG limita
- Schema estrutura
- Gate impõe

Nenhum componente sozinho garante segurança. Todos trabalham juntos.

