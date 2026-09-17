# Propostas de mudança da pesquisa de benchmarks (change proposals)

> **Regra de ouro:** a pesquisa competitiva de benchmarks **nunca escreve a amostra
> diretamente**. Ela gera uma **proposta persistida** com avaliação documentada
> (o que muda, prós, contras, riscos, avaliação prática), que só vira mudança em
> `config/benchmarks/<vertical>.json` depois de **aprovação humana** — com
> ressalvas registradas.

## Fluxo

```
pesquisa (runs/execute) → PROPOSTA (patch + avaliação)
                        → REVISÃO (token HMAC, TTL 30 min)
                        → APROVAÇÃO humana (com ressalvas) ou REJEIÇÃO (com razão)
                        → APLICAÇÃO (somente proposta approved, patch íntegro)
```

1. **Proposta** (`POST /api/benchmark-research/runs/:vertical/proposals`): o
   patch é derivado dos fatos persistidos do run (`buildSamplePatch`) e a
   avaliação é computada por merge **em memória** — nada é escrito no sample.
   Proposta sem trabalho real (nenhum benchmark analisado) é recusada na origem
   (`sample_patch_without_analysis`).
2. **Revisão** (`POST /proposals/:id/review`): emite um `reviewToken` HMAC-SHA256
   com TTL de 30 minutos (mesmo padrão do `journeyReviewService`). Apenas o
   **hash** do token é persistido — nunca o token em claro.
3. **Aprovação** (`POST /proposals/:id/approve`): exige token íntegro, não
   expirado, emitido para o **mesmo revisor** e para o **mesmo hash de patch**.
   Quem propôs não pode aprovar (`self_approval_denied`). As ressalvas
   (`caveats`) e a razão da decisão ficam registradas na proposta.
4. **Aplicação** (`POST /proposals/:id/apply`): exige status `approved` e
   recomputa o sha256 do patch persistido — adulteração entre aprovação e
   aplicação aborta com `patch_tampered`. A escrita no sample continua
   transacional (tmp + rename, validação pós-merge com o engine de suficiência,
   rollback em falha) via `benchmarkSampleRegistry.applySamplePatch`.

A `recommendation` da avaliação (`recommended` | `caution` | `not_recommended`)
é **advisory**: a decisão é humana, sempre.

## Tabela `benchmark_research_change_proposals`

Migration `api/db/migrations/20260917120000-create-benchmark-research-change-proposals.js`
(idempotente), model `api/db/models/BenchmarkResearchChangeProposal.js`.

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | string PK | determinístico: `brcp-` + sha256(`vertical\|runId\|patchSha256`)[0..48]; após estado terminal, nova proposta do mesmo patch inclui contador no hash (versão determinística) |
| `vertical` | string | vertical do sample |
| `run_id` | string null | FK lógica a `benchmark_research_runs.id` (o agregado não usa constraint física) |
| `patch` | jsonb | o patch proposto (somente campos de pesquisa) |
| `patch_sha256` | string(64) | binding de integridade; recomputado na aplicação |
| `evaluation` | jsonb | documento de avaliação (contexto, diff, suficiência antes/depois, prós/contras/riscos, avaliação prática, recomendação advisory, non-goals) |
| `status` | string | `proposed` → `approved` \| `rejected` → `applied` |
| `caveats` | jsonb | ressalvas registradas na aprovação |
| `decision_reason` | text null | razão da decisão (obrigatória na rejeição) |
| `proposed_by` / `reviewed_by` / `applied_by` | string | atores humanos autenticados (server-side) |
| `review_token_sha256` | string(64) null | hash do token de revisão; nunca o token |
| `review_token_expires_at` | timestamp null | expiração do token (30 min) |
| `proposed_at` / `reviewed_at` / `applied_at` | timestamp | linha do tempo da decisão |
| `created_at` / `updated_at` | timestamp | padrão |

Índices: `(vertical, status)` e `(run_id)`.

## Endpoints

Superfície de **engenharia**: todos exigem autenticação + classificação
**DEVELOPMENT** + tenant **system** (fail-closed). O ator é resolvido
server-side (nunca do corpo da requisição).

| Método | Rota | Ação |
|---|---|---|
| GET | `/api/benchmark-research/proposals?vertical=&status=` | lista propostas (filtros opcionais) |
| GET | `/api/benchmark-research/proposals/:id` | detalhe (patch + avaliação + decisão) |
| POST | `/api/benchmark-research/runs/:vertical/proposals` | cria a proposta do patch atual do run (idempotente: mesma proposta aberta é devolvida, nunca duplicada) |
| POST | `/api/benchmark-research/proposals/:id/review` | emite `{ reviewToken, expiresAt }` |
| POST | `/api/benchmark-research/proposals/:id/approve` | body `{ reviewToken, caveats?, reason? }` |
| POST | `/api/benchmark-research/proposals/:id/reject` | body `{ reason }` (obrigatório) |
| POST | `/api/benchmark-research/proposals/:id/apply` | aplica a proposta aprovada ao sample |
| POST | `/api/benchmark-research/runs/:vertical/sample-patch` | **contrato novo**: sem `proposalId` → 400 `approval_required`; com `proposalId` → delega à aplicação da proposta (exige `approved`). Aplicação direta sem proposta não existe mais. |

## Códigos de erro

| Código | HTTP | Significado |
|---|---|---|
| `approval_required` | 400 | tentativa de aplicação direta sem proposta |
| `proposal_not_found` | 404 | proposta inexistente |
| `proposal_invalid_status` | 409 | transição fora da máquina de estados |
| `review_token_required` / `review_token_invalid` / `review_token_expired` / `review_token_reviewer_mismatch` | 401 | binding do token de revisão falhou |
| `self_approval_denied` | 403 | quem propôs não pode aprovar |
| `patch_tampered` | 409 | patch persistido diverge do hash aprovado |
| `reason_required` | 400 | rejeição sem razão documentada |
| `proposal_run_mismatch` | 400 | `runId` informado não é o run atual da vertical |
| `sample_not_found` | 404 | sample da vertical ausente |

## Segregação e auditoria

- Classificação **DEVELOPMENT-only** (`checkClassification`), tenant **system**
  obrigatório — pesquisa de benchmark é material SYSTEM/INTERNAL, nunca
  superfície PRODUCTION do cliente.
- Cada transição (criação, revisão, aprovação, rejeição, aplicação) emite evento
  de auditoria via `logAction` do módulo (`benchmark_research.proposal_*`).
- A avaliação da proposta declara explicitamente os *non-goals*: a proposta
  altera apenas a amostra de benchmarks — não implementa capabilities e não
  altera código de produto.

## Testes

`tests/unit/benchmarks/benchmarkChangeProposal.test.js` (DB-backed, Postgres
real): fluxo completo create→review→approve→apply com sample real escrito e
restaurado, todas as recusas fail-closed, adulteração de patch (`patch_tampered`),
idempotência do id determinístico e versionamento após estado terminal — com
prova por SQL cru, independente do código sob teste.
