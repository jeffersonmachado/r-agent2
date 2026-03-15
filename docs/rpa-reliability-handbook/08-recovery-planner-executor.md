# RPA Reliability Handbook - 08 Recovery Planner and Executor

## Objetivo
Planejar e executar estrategias de recuperacao com ordem deterministica e governanca.

## Planner
Entrada:
- classificacao
- ownership
- governor snapshot
- action original
- page state snapshot

Saida:
- `strategySequence` (ex.: `REPAIR_SELECTOR -> RETRY_STEP -> REFRESH_PAGE`).

## Executor
Executa uma strategy por vez e retorna:
- sucesso/falha,
- evidencias da tentativa,
- notas diagnosticas.

## Fallback
Se estrategias autonomas falharem e houver margem no governor, roda `LEGACY_ERROR_RECOVERY` para compatibilidade.

## Limitacoes
- Sequencia fixa pode nao ser ideal para todos os dominos.

## Boas Praticas
- Priorizar estrategias de baixo risco primeiro.
- Medir taxa de sucesso por strategy para recalibrar ordem.
