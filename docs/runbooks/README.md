# QA Waves — Runbooks Operacionais

> Gerado: 2026-07-21 | 6 runbooks

## Índice

| # | Runbook | Descrição |
|---|---|---|
| 1 | [Criar Cenário](01-criar-cenario.md) | Gerar, validar e aprovar um cenário executável |
| 2 | [Executar Wave](02-executar-wave.md) | Executar wave via QA Mesh e coletar evidências |
| 3 | [Ler Governança](03-ler-governanca.md) | Interpretar relatórios e tomar decisão de release |
| 4 | [Tratar NO_GO](04-tratar-no-go.md) | Diagnosticar e resolver NO_GO |
| 5 | [Integridade de Replay](05-integridade-replay.md) | Verificar e garantir integridade de replays |
| 6 | [Bot de Geração](06-bot-geracao.md) | Operar pipeline completo de geração automática |

## Fluxo operacional

```
Criar Cenário → Executar Wave → Ler Governança
                     ↑                ↓
                     └── Tratar NO_GO ←┘

Integridade de Replay (transversal)
Bot de Geração (alimenta Cenários)
```
