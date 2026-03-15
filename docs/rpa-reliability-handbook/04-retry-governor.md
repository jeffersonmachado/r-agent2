# RPA Reliability Handbook - 04 Retry Governor

## Objetivo
Impedir loops infinitos e definir limites explicitos de tentativa por step.

## Limites Padrao
- `MAX_STEP_RETRIES = 3`
- `MAX_RECOVERY_ATTEMPTS = 2`
- `MAX_SELECTOR_REPAIR_ATTEMPTS = 3`
- `MAX_TOTAL_STEP_TIME_MS = max(config.timeout * 4, 120000)`

## Controles
- Contexto por step com contadores de retry/recovery.
- Registro de hash de estado de pagina para detectar repeticao sem progresso.
- Bloqueio de novas tentativas ao estourar tempo total.

## Exemplo de Snapshot
```json
{
  "retryCount": 1,
  "recoveryAttempts": 2,
  "selectorRepairAttempts": 1,
  "canContinue": true,
  "lastPageStateHash": "a7b91e..."
}
```

## Limitacoes
- Um limite global conservador pode reduzir taxa de recuperacao em casos lentos.

## Boas Praticas
- Ajustar limites via env somente com historico real.
- Monitorar taxa de `FAIL_INFRASTRUCTURE` apos mudancas de timeout.
