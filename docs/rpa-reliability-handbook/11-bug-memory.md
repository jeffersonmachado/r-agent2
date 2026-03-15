# RPA Reliability Handbook - 11 Bug Memory and Flakiness

## Objetivo
Detectar recorrencia de falhas e comportamento flaky baseado em fingerprint.

## Storage
- Arquivo: `tests/rpa/reports/bugs/bug-memory.json`

## Sinais Mantidos
- total de ocorrencias por fingerprint,
- taxa de recorrencia,
- taxa de flakiness por step,
- ultimo owner e ultimo desfecho.

## Uso Operacional
- priorizar correcoes em fingerprints recorrentes.
- diferenciar bug de produto vs instabilidade de automacao.

## Limitacoes
- Memoria local por ambiente pode divergir entre maquinas.

## Boas Praticas
- Consolidar memoria em pipeline central quando possivel.
- Resetar historico apenas com criterio (nao apagar para "limpar" indicador).
