# Flow Editor and Automation

## Papel do editor de flows

O `Flow Editor` é uma das principais interfaces para construir orquestração operacional.

Ele não substitui a camada de decisão. Ele atua principalmente na camada de execução.

## Leitura arquitetural correta

`Operational Brain decide`
`↓`
`Flow / automação / playbook orquestram`
`↓`
`Serviços executam`

## Componentes relacionados

- editor visual de flows
- triggers por evento
- playbooks
- quick actions
- integrações
- runtime conversacional e de voz

## O que esse documento quer evitar

Evitar interpretar o projeto como apenas um builder de fluxos.

O builder é importante, mas a plataforma completa inclui:

- observação operacional
- projeção de estado
- decisão
- execução
- aprendizagem

## Como o editor se encaixa no sistema

- recebe entradas do runtime e de eventos
- orquestra chamadas de serviços
- conecta automação, canais e integrações
- pode executar a decisão, mas não deve substituir a camada que decide
