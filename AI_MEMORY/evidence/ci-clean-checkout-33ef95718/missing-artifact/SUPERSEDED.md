# SUPERSEDED — desenho inválido do cenário

Este run testou o par errado: `reports/coverage-completeness-report.json` x
`tests/unit/governance/coverageCompletenessCanonicalDomains.test.js`. Esse teste **roda o próprio
produtor** no `beforeAll`, então apagar/corromper o relatório não o reprova — o "cenário de artefato
ausente" só provava que o produtor funciona.

A execução deste cenário é justamente a MEDIÇÃO que revelou o erro. O par foi trocado para o artefato
prod-like x `modelDrivenE2e` (que apenas lê o arquivo) no commit `1e6a64b58`; a prova válida está em
`AI_MEMORY/evidence/ci-clean-checkout-1e6a64b58/missing-artifact/RESULT.md`.
