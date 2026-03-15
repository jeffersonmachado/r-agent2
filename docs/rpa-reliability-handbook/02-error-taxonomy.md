# RPA Reliability Handbook - 02 Error Taxonomy

## Objetivo
Padronizar tipos de falha para diagnostico, metricas e decisao final.

## Campos Minimos de Classificacao
- `type`: tipo tecnico principal (ex.: `SELECTOR_NOT_FOUND`, `ASSERTION_FAILED`).
- `severity`: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`.
- `nature`: `APPLICATION`, `AUTOMATION`, `INFRASTRUCTURE`, `INSTABILITY`.
- `probableCause`: causa provavel textual.
- `confidence`: valor entre `0` e `1`.
- `recoverable`: booleano.
- `suggestedRecoveryStrategies`: lista ordenada de estrategias.
- `suggestedPermanentFixes`: lista de correcoes permanentes sugeridas.

## Fontes de Sinal
- Erro do Playwright / runtime.
- Status HTTP >= 400.
- Estado de DOM e visibilidade.
- Contexto do step (acao, seletor, assert).

## Exemplo
```json
{
  "type": "SELECTOR_NOT_FOUND",
  "severity": "HIGH",
  "nature": "AUTOMATION",
  "probableCause": "selector became stale after UI change",
  "confidence": 0.92,
  "recoverable": true,
  "suggestedRecoveryStrategies": ["REPAIR_SELECTOR", "RETRY_STEP"],
  "suggestedPermanentFixes": ["replace brittle css selector with data-testid"]
}
```

## Limitacoes
- Um mesmo erro pode ter causas concorrentes.
- A confidence e heuristica, nao verdade absoluta.

## Boas Praticas
- Usar classificacao para priorizacao, nao apenas para log.
- Revisar periodicamente tipos mais frequentes por tenant/seed.
