# RPA Reliability Handbook - 12 API and Replay Contract

## Objetivo
Documentar como os novos campos de confiabilidade sao propagados sem quebrar consumidores atuais.

## Superficie Atualizada
- `tests/rpa/rpaTestRunner.js`: inclui `finalDecision`, `bugResolution`, `reliabilityMetrics`.
- `lib/replaySystem.js`: persiste classificacao, owner, plano, estrategias e evidencias por acao.
- `api/services/rpaService.js`: inclui campos novos no resultado de execucao e por step.

## Campos Novos (Additive)
- run-level: `finalDecision`, `reliabilityMetrics`
- step-level: `finalDecision`, `bugResolution`
- replay action: `classification`, `owner`, `recoveryPlan`, `strategiesAttempted`, `selectorRepairCandidates`, `severity`, `evidenceArtifacts`

## Compatibilidade
- Campos antigos permanecem.
- Consumidor antigo continua funcional ignorando campos extras.

## Exemplo
```json
{
  "success": true,
  "finalDecision": "PASS_WITH_RECOVERY",
  "reliabilityMetrics": {
    "recoverySuccessRate": 0.67,
    "retryRate": 0.33
  }
}
```

## Boas Praticas
- Tratar campos novos como opcionais em clientes externos.
- Validar serializacao de replay em smoke tests.
