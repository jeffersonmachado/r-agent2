# RPA Reliability Handbook - 01 Architecture

## Objetivo
Definir a arquitetura do motor de resolucao autonoma de bugs no subsistema de RPA sem quebrar contratos publicos existentes.

## Principios
- Extensao aditiva: manter `ActionExecutor`, `RpaTestRunner`, `ReplaySystem` e API publica compativeis.
- Decisao auditavel: cada falha ou recuperacao precisa gerar explicacao rastreavel.
- Governanca de retry: sem loops infinitos e com limites por passo.
- Correcao temporaria: aplicar reparos em runtime, sem alterar seed de forma permanente.

## Blocos Principais
- Orquestracao: `tests/rpa/actionExecutor.js`
- Deteccao e classificacao: `tests/rpa/bugResolution/bugDetectionEngine.js`
- Diagnostico de pagina: `tests/rpa/bugResolution/pageStateInspector.js`
- Planejamento de recovery: `tests/rpa/bugResolution/recoveryPlanner.js`
- Execucao de strategies: `tests/rpa/bugResolution/recoveryExecutor.js`
- Controle de tentativas: `tests/rpa/bugResolution/retryGovernor.js`
- Evidencia e recomendacoes: `tests/rpa/bugResolution/bugEvidenceGenerator.js`, `tests/rpa/bugResolution/patchSuggestionEngine.js`
- Memoria de recorrencia/flaky: `tests/rpa/bugResolution/bugMemoryStore.js`

## Fluxo Resumido
1. Executa step.
2. Se falhou, classifica bug e ownership.
3. Coleta snapshot profundo da pagina.
4. Planeja estrategias de recuperacao.
5. Executa estrategias sob limites do governor.
6. Decide `PASS_WITH_RECOVERY` ou falha final tipada.
7. Gera evidencia JSON/Markdown e patch suggestions.
8. Atualiza memoria de fingerprints.

## Status Finais
- Sucesso: `PASS`, `PASS_WITH_RETRY`, `PASS_WITH_RECOVERY`
- Falha: `FAIL_APPLICATION_BUG`, `FAIL_AUTOMATION_BUG`, `FAIL_INFRASTRUCTURE`, `FAIL_UNKNOWN`

## Limitacoes
- Correcao permanente nao e aplicada automaticamente.
- Diagnostico depende do estado observavel no momento da falha.
- Heuristicas de repair podem nao cobrir UIs altamente dinamicas sem atributos estaveis.

## Boas Praticas
- Preferir seletores com `data-testid` ou semantica estavel.
- Manter seeds pequenos e com asserts focados.
- Revisar periodicamente fingerprints recorrentes e patch suggestions.
