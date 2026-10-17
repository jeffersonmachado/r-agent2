# DEF-FLAKY-MISSIONFULLE2E-SOB-CARGA — causa raiz medida e corrigida

Item da fila: `DEF-FLAKY-MISSIONFULLE2E-SOB-CARGA` (P1). Registrado originalmente como
`BLOCKED_EXTERNAL` com o diagnóstico "flaky sob carga; causa provável: contenção no git".

## O que estava escrito (e por que estava errado)

O relatório do L2 mostrava `engineeringMissionFullE2E` com `state=FAIL` e **sem mensagem**
(`"1 teste(s) falharam"`). A ausência da mensagem levou à hipótese de intermitência, e a
classificação virou `BLOCKED_EXTERNAL`.

## Medição (2026-10-17)

1. **Reprodução dirigida sob contenção real de git** — `tools/audit/git-worktree-stress.sh`
   cria/remove worktrees continuamente no MESMO repositório enquanto a suíte roda:

```
$ npx jest tests/integration/engineeringMissionFullE2E.test.js --no-coverage
  ✕ 6. o loop real do Router chega a GREEN e a missão reflete GREEN (24352 ms)
  Expected: "GREEN"   Received: "RED"
Tests: 2 failed, 6 passed
```

2. **Instrumentação do resultado do Router** (cópia descartável da suíte, removida depois):

```
DIAG_RUN_RESULT {"taskId":"...","status":"RED","reasonCode":"GOVERNANCE_FAILED"}
DIAG_ATTEMPTS   [{"n":1,"status":"DONE","coder":"anthropic"}]
```

`GOVERNANCE_FAILED` = o gate `scripts/governance/validate-engineering-router-v1.js` reprovou.
Rodando esse gate **isolado, sem nenhuma carga**:

```
$ node scripts/governance/validate-engineering-router-v1.js
[engineering-router-v1] status=FAIL (STRUCTURAL_FAIL) checks=183 falhas=1
 - MANDATORY_RUNTIME_GATE_IN_OFFICIAL_PIPELINE: validate:governance-enforcement precisa
   chamar validate:engineering-router-v1:runtime
```

**Determinístico, não intermitente.** Nenhuma carga envolvida.

## Causa raiz

O agregado passou a persistir veredito próprio: `validate:governance-enforcement` virou um
WRAPPER (`node scripts/governance/run-governance-enforcement.js`) e a cadeia `&&` canônica foi
para `validate:governance-enforcement:chain`. O guard `MANDATORY_RUNTIME_GATE_IN_OFFICIAL_PIPELINE`
lia `pkg.scripts['validate:governance-enforcement']` — agora a string do wrapper — e concluía
que o passo de runtime não existia, embora a cadeia efetiva o contivesse.

O sintoma se disfarçou de flakiness porque:
- o gate é executado dentro da fase GOVERNANCE de TODA task do Router (por isso a missão ia a
  RED), e
- o relatório do L2 descartou a mensagem da falha.

## Correção

- `scripts/governance/lib/effective-aggregate-chain.js` (novo): resolve a cadeia **efetiva**
  (forma DIRETA ou WRAPPER) e, na forma wrapper, exige que o runner realmente execute `:chain`
  — um wrapper que não roda nada não pode ser atestado.
- `scripts/governance/validate-engineering-router-v1.js`: o guard usa o resolvedor.
- `tests/integration/engineeringRouterMandatoryRuntimeGate.test.js` e
  `tests/integration/evoOfficialContractEvidence.test.js`: passam a asserir sobre a cadeia
  efetiva (antes só passariam na forma DIRETA).
- `tests/unit/governance/effectiveAggregateChain.test.js` (novo): 8 testes provando os dois
  formatos e as RECUSAS (wrapper sem cadeia, wrapper cujo runner não executa a cadeia,
  agregado ausente, forma structural-only detectável) + a cadeia real do repositório.

## Prova após a correção

```
$ node scripts/governance/validate-engineering-router-v1.js
[engineering-router-v1] status=PASS (STRUCTURAL_PASS/RUNTIME_NOT_REQUESTED) checks=183 falhas=0

$ npx jest tests/integration/engineeringMissionFullE2E.test.js --no-coverage      # isolado
Tests: 8 passed, 8 total

$ bash tools/audit/git-worktree-stress.sh <root> 300 &   # contenção real de git
  npx jest tests/integration/engineeringMissionFullE2E.test.js --no-coverage  (3 execuções)
RUN1 EXIT=0  Tests: 8 passed, 8 total
RUN2 EXIT=0  Tests: 8 passed, 8 total
RUN3 EXIT=0  Tests: 8 passed, 8 total

$ npx jest tests/integration/engineeringRouterMandatoryRuntimeGate.test.js \
         tests/integration/evoOfficialContractEvidence.test.js --bail=0
Tests: 38 passed, 38 total
```

## Consequência para a governança

Não é bloqueio externo: era defeito de código no guard, introduzido junto com a mudança do
agregado. Com a correção, `validate:required-tests` deixa de reprovar V2-01 por esta causa.
