# Autonomous Operations Loop

## Loop central da plataforma

O loop central do `r-agent2` é:

`Observe -> Project State -> Decide -> Execute -> Learn`

Esse loop descreve o comportamento esperado da plataforma como sistema operacional de ciclo fechado.

## Observe

A plataforma observa:

- eventos de negócio
- eventos de runtime
- eventos de canal
- mudanças de estado operacional
- fatos relevantes de atendimento, agenda, filas, pedidos e CRM

Exemplos:

- `conversation.received`
- `ticket.created`
- `booking.cancelled`
- `booking.gap_detected`
- `contact.inactive`
- `sla.risk_detected`

## Project State

Os eventos observados são transformados em projeções utilizáveis pelo sistema.

Exemplos de estado projetado:

- estado do contato
- estado do ticket
- estado da conversa
- estado da agenda
- estado da fila
- estado da oportunidade
- estado operacional por profissional e unidade

## Decide

A plataforma determina a **Next Best Operational Action** a partir do estado projetado.

As saídas dessa camada podem ser:

- recommendation
- assistive action
- playbook
- automation
- campaign
- no-op

## Execute

A decisão é executada pelo runtime operacional:

- quick actions
- playbooks
- flows
- integrações
- serviços de domínio

## Learn

O ciclo se fecha quando a execução gera:

- outcome
- feedback
- memória operacional
- estatísticas e evidências de aprendizado

## Relação com o ciclo canônico

O loop acima convive com o fluxo canônico do projeto:

`evento -> sinal -> recomendação -> decisão -> ação/ação rápida/playbook -> resultado -> memória operacional`

Essa é a tradução operacional direta do modelo autônomo.
