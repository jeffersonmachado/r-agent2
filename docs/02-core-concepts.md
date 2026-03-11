# Core Concepts

## Conceitos centrais

O `r-agent2` usa dois modelos complementares de leitura.

## 1. Loop operacional autônomo

`Observe -> Project State -> Decide -> Execute -> Learn`

- `Observe`: captar eventos, fatos e mudanças operacionais
- `Project State`: transformar observação em estado e contexto
- `Decide`: escolher a **Next Best Operational Action**
- `Execute`: executar automações, playbooks, quick actions e serviços
- `Learn`: registrar outcome, feedback e memória operacional

## 2. Ciclo operacional canônico

`evento -> sinal -> recomendação -> decisão -> ação/ação rápida/playbook -> resultado -> memória operacional`

Mapeamento entre os dois modelos:

- `Observe` -> `evento`
- `Project State` -> `sinal + contexto + projeções`
- `Decide` -> `recomendação + decisão`
- `Execute` -> `ação / quick action / playbook / flow`
- `Learn` -> `resultado + memória operacional`

## Termos arquiteturais mais importantes

- `Event Backbone`: backbone de eventos do sistema
- `Operational State`: projeções de estado operacional
- `Operational Brain`: camada que determina a próxima melhor ação
- `Automation Runtime`: camada que executa a decisão
- `AI Layer`: camada de classificação, RAG, recomendação e geração
- `Operational Memory`: memória que aprende com resultado e feedback
- `Operational Core`: CRM, support, conversations, scheduling, queues, orders, tasks e voice
- `Vertical Templates`: presets de comportamento por vertical

## Conceitos de decisão

- `Signal`: interpretação operacional de eventos e contexto
- `Recommendation`: ação recomendada para o contexto atual
- `Decision`: escolha explícita sobre como responder
- `Outcome`: evidência do que aconteceu após a execução

## Conceitos de execução

- `Quick Action`: ação operacional de baixa fricção
- `Playbook`: execução orquestrada de múltiplos passos
- `Flow`: automação visual que conecta eventos, decisões e serviços
- `Integration`: ponte com canais, providers e sistemas externos

## Referências

- termos canônicos: `07-operational-glossary.md`
- loop operacional: `03-autonomous-operations-loop.md`
- brain e decisão: `05-operational-brain.md`, `08-decision-layer.md`
