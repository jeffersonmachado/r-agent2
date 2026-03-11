# Architecture Map

## Mapa principal

```text
Event Backbone
       ↓
Operational State
       ↓
Operational Brain
       ↓
Automation Runtime
       ↓
Outcome + Memory
```

## Leitura complementar

```text
Observe
→ Project State
→ Decide
→ Execute
→ Learn
```

## Tradução para o ciclo operacional canônico

```text
Evento
→ Sinal
→ Recomendação
→ Decisão
→ Ação / Ação Rápida / Playbook
→ Resultado
→ Memória Operacional
```

## Papel de cada camada

- `Event Backbone`: observa e normaliza eventos operacionais
- `Operational State`: projeta estado consultável para decisão
- `Operational Brain`: define a próxima melhor ação operacional
- `Automation Runtime`: executa ações via flows, playbooks, quick actions e integrações
- `Outcome + Memory`: registra resultados e feedback para ciclos futuros

## Núcleos conceituais

- categoria do produto: `Autonomous Operations Platform`
- arquitetura interna: `Operational Operating System`
- núcleo mínimo comum: `Service Operations Kernel`
