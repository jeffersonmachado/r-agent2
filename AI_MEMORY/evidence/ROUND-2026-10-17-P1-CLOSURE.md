# Rodada 2026-10-17 — fechamento de 1 P0? não: 4 P1/P2/P3 com prova

Estado ao fim da rodada: **4 itens abertos** na fila (de 9), **1 bloqueador de certificação**
(o P0 externo de proteção de branch). `P1 = 0`.

## Fechados nesta rodada

| Item | Sev | O que era | Prova |
|---|---|---|---|
| `DEF-FLAKY-MISSIONFULLE2E-SOB-CARGA` | P1 | Classificado como "flaky sob carga / bloqueio externo". **Não era**: o guard `MANDATORY_RUNTIME_GATE_IN_OFFICIAL_PIPELINE` lia o script de topo (wrapper) em vez da cadeia efetiva e reprovava de forma determinística o gate de governança; o Router roda esse gate na fase GOVERNANCE, então a missão ia a RED | gate 183 checks / 0 falhas; suíte 8/8 isolada e 3×8/8 sob contenção real de `git worktree`; `tests/unit/governance/effectiveAggregateChain.test.js` (8) |
| `DEF-TEARDOWN-DRAIN-WORKER` | P1 | "Excede o orçamento dirigido (INCONCLUSIVO em 240s)". **Estava obsoleto**: o E2E conclui em 65,3s | reconcile PASS exit=0 65,3s `tests/integration/governanceApprovalFullWorkerE2E.test.js` |
| `H12-RAG-REPARO` | P2 | Saúde do índice RAG decidida por regra inline em `main()` (sem prova executável) | `validate:rag-index-health` HEALTHY (3400 indexados, 0 violações); política extraída + 10 testes |
| `H18-JORNADA-FUNCIONAL-BROWSER` | P3 | O detector acusava 3 defeitos **que não existiam** (`/editor` "vazio" por medir `Carregando...`, `/tasks` usando botão de AÇÃO como chip, `/crm` acusando cancelamento de fetch da própria navegação) | jornada real 8/8 PASS, 0 erros de console; `tests/unit/governance/journeyDetectors.test.js` (10) |
| `P1-13` | P1 | Regenerar `qa/smoke-evidence.json` exigia ciclo destrutivo de stack (prova envelhecia → gate reprovava) | `npm run smoke:evidence:regen` contra a stack viva: l01..l06 **pass**, `generatedAt` FRESH (15,7 s); shape provado em `tests/unit/governance/smokeEvidenceSummary.test.js` (6) |

## Regra que a rodada fixou

**"Bloqueio externo" é uma conclusão medida, não uma suposição.** Três dos cinco itens acima
estavam parados por diagnóstico errado — um deles repetido por dias ("flaky"). Antes de
classificar como externo: reproduzir com o sintoma real (não a hipótese), rodar o gate isolado
sem carga, e verificar se o leitor do artefato está lendo a forma atual do artefato.

## Aberto (4)

| Item | Sev | Estado | Por que continua aberto |
|---|---|---|---|
| `HARDENING-ENG-GOV-RELEASE-P0-7` | P0 | BLOCKED_EXTERNAL | API do GitHub recusa proteção de branch em repo privado no plano Free (HTTP 403). Exige decisão do dono: plano pago **ou** repositório público |
| `H15-DIST-RECIBO-STALE` | P2 | BLOCKED_EXTERNAL | Exige ciclo de release (`validate:dist` compara com o payload entregue) |
| `H19-DIST-CAUSA-UNICA` | P2 | BLOCKED_EXTERNAL | Mesmo ciclo |
| `N5-REENTREGA` | P2 | FIXED_PENDING_VERIFICATION | Exige reentrega (selagem) — negada enquanto o P0 acima existir |

Consequência: `SELO_FINAL`, `QA_WAVES_COMPLETA`, `CONVERGENCIA_COMPLETA` e `PUBLICACAO_RELEASE`
seguem **DENIED** por `evaluateExecutionEligibility` (`P0_ABERTO`). Estado correto: **NO_GO**.
