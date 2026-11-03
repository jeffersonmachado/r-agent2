# Clean checkout — run `clean-checkout-20261022033303272-e0bbfe`

- **commit medido:** `2f8b5aa297f1904c9b227ee3ae73279e284a6b34`
- **comando:** `node scripts/ci/clean-checkout-verify.js --scenario clean --gate-phases A,B,C,D --with-integration`
- **ambiente:** `local-jmachado-Precision-5530` · node 22.12.0 · npm 10.9.0 · psql 16.15 · redis 7.0.15 · docker 27.3.1 · jest 29.7.0
- **provisionado pelo run (não herdado da máquina):** Postgres `pgvector/pgvector:pg16`, Redis `redis:7`,
  serviço RAG (imagem oficial, porta livre), Engineering Runner (porta livre), containers da API e
  do frontend prod-like.

## Resultado autoritativo (evidência do próprio gate)

`gate/dev-branch-ci-evidence.json` (cópia do `reports/dev-branch-ci-evidence.json` produzido DENTRO
do clone) e os logs por passo em `gate/`:

| passo | exit | duração |
|---|---|---|
| `B1-phaseStepContract.test.js` | 0 | 6 s |
| `B2-devBranchGatePhaseContract.test.js` | 0 | 5 s |
| `B3-devBranchGateStepEvidence.test.js` | 0 | 3 s |
| **`L0-suite-oficial`** (`npm test`) | **0** | **437 s** |
| **`L0b-integracao-engenheiro`** | **0** | **983 s** (40 suítes / 219 testes) |
| `L1-cadeia-criptografica` | 1 | 0 s |

Contadores do L0 (de `gate/L0-suite-oficial.log`): `tests/unit` 1095 suítes aprovadas + 1 skip
(1095 de 1096); `tests/flow` + `engine/__tests__` 30 suítes; RPA 3 suítes. Nenhuma falha.

Inventário do L1 executado passo a passo (mesma definição `PASSOS.D` do gate):

- verdes: `L1-release-dag`, `L1-fila-oficial`, `L1-ai-memory`, `L1-aderencia-agente`;
- vermelhos: `L1-cadeia-criptografica`, `L1-self-proving`, `L1-decisao-canonica` — família de
  certificação de release (pacote selado não versionado; `release:seal` exige `main`).

## Nota de honestidade sobre este diretório

O passo final `--with-integration` deste run repetia a MESMA bateria que o gate já havia executado
como `L0b` (exit 0, 983 s). Ele foi interrompido depois de ~22 min sem progresso observável, então o
harness não chegou a emitir o próprio `RESULT.md`/`reports/ci-clean-checkout-report.json` para este
run. A duplicação foi removida em `047a0cd64` (`--with-integration` não repete a fase C).

A prova deste run são os artefatos do GATE (acima), que são os mesmos que decidem o veredito — não
um resumo escrito por quem executou.
