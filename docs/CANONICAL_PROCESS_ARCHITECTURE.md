# Canonical Process Architecture

## Motivo

O projeto já possui um caminho estável entre editor visual, `FlowDefinition` da engine e runtime. A nova camada canônica foi introduzida para complementar essa arquitetura, sem reescrever o que já funciona.

Objetivos imediatos:

- normalizar fluxos antes da compilação
- validar semântica com granularidade maior
- preparar adapters para BPMN
- preparar geração/autoria por IA em um formato mais estável

## Arquitetura

Fluxo principal atual com a nova camada:

`Rete JSON -> CanonicalProcessDefinition -> Compiler -> EngineFlowDefinition -> runtime`

Fluxo de leitura/inspeção:

`EngineFlowDefinition -> CanonicalProcessDefinition`

Fluxo de round-trip do editor:

`Rete JSON -> CanonicalProcessDefinition -> Rete JSON`

## Componentes

### `frontend/src/process-canonical/`

- `canonicalTypes.js`
  Define os tipos canônicos mínimos e o mapeamento base entre tipos do editor/engine e tipos canônicos.
- `canonicalDefaults.js`
  Centraliza defaults de políticas, observabilidade e configuração operacional.
- `canonicalNormalizer.js`
  Garante shape consistente do processo, dos nós e das arestas.
- `canonicalValidator.js`
  Executa validações semânticas adicionais, retornando `errors`, `warnings` e `suggestions`.
- `canonicalCompiler.js`
  Produz uma representação compilada determinística com `adjacency`, `nodeMap` e `edgeMap`.

### `frontend/src/process-adapters/`

- `reteToCanonical.js`
  Converte o JSON do editor em `CanonicalProcessDefinition`, preservando IDs estáveis e mapeando conexões.
- `canonicalToRete.js`
  Converte o modelo canônico de volta para o formato do editor.
- `engineFlowToCanonical.js`
  Normaliza `FlowDefinition` da engine para o modelo canônico.
- `canonicalToEngineFlow.js`
  Compila o modelo canônico de volta para `FlowDefinition`.

## Relação com o editor

O editor atual não foi substituído.

- a UI continua baseada em Rete
- `nodeSchemas` continuam sendo a fonte da verdade para o editor
- a validação anterior continua existindo
- a validação canônica entra como camada complementar

Na prática:

- ao validar no editor, os avisos canônicos são mesclados ao estado de validação atual
- ao salvar, o fluxo passa por `Rete -> Canonical -> Engine`

## Relação com o runtime

O runtime continua executando `FlowDefinition`.

A camada canônica atua antes disso:

- normaliza
- valida
- compila

Isso permite evoluir o runtime sem acoplar novas regras diretamente ao formato do editor.

## Preparação para BPMN

O modelo canônico foi desenhado para servir de ponto comum entre:

- editor visual atual
- import/export BPMN
- validação semântica
- compilação para runtime

Isso reduz o custo de múltiplos conversores diretos entre formatos.

## Preparação para IA de autoria

Com um modelo intermediário explícito, a IA pode:

- gerar processo canônico em vez de gerar diretamente JSON do editor
- receber feedback semântico mais forte
- operar com menor acoplamento ao layout e aos detalhes internos do Rete

## Limitações atuais

- a taxonomia canônica ainda mapeia vários nós avançados para tipos mais genéricos
- parte da semântica específica do editor permanece em `config`
- a UI ainda exibe tudo no mesmo painel de validação, sem seção separada para “canônico”
- o runtime ainda consome `FlowDefinition`, não o modelo canônico diretamente

## Próximos passos

1. enriquecer mapeamentos canônicos para voice, RAG e utilitários avançados
2. adicionar adapter BPMN -> Canonical
3. adicionar adapter Canonical -> BPMN
4. separar no editor os warnings do backend, preflight e canônicos
5. permitir geração assistida por IA diretamente em `CanonicalProcessDefinition`
