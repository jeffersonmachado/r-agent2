# Autoridade única de certificação de benchmarks

> Fonte única do conjunto de "verticais certificadas":
> `scripts/governance/lib/benchmarkCertificationAuthority.js`.
> Este documento descreve o comportamento **vigente** (verificado no código em
> 2026-09-19), não uma intenção de design.

## Por que existe

Três gates de benchmark (`validate:benchmark-semantic-version`,
`validate:benchmark-persisted-corpus`, `validate:benchmark-phase-model`)
definiam "vertical certificada" pelo campo **declarado** `sample.claim` do
JSON da amostra — um campo que **nenhum produtor grava** e cujo design proíbe
gravar (suficiência é derivação do engine, nunca declaração; trava em
`tests/unit/benchmarks/benchmarkResearchHonesty.test.js`). Medido em
2026-09-19: o engine certificava fitness enquanto os gates reportavam PASS com
`certifiedSamples=0` e `persistedFindingsChecked=0` — um PASS vacuoso, pior que
um FAIL, porque finge uma auditoria que nunca rodou.

## Regra canônica

Uma vertical está certificada quando o relatório canônico do engine de
suficiência — `reports/benchmark-sufficiency-report.json`, produzido por
`npm run validate:benchmark-sufficiency` — registra, para ela, as **três
marcas juntas** (marca parcial não certifica):

| Marca | Valor exigido |
|---|---|
| `status` | `SAMPLE_SUFFICIENT` |
| `certifiable` | `true` |
| `coverageStatement.marketCertification` | `MARKET_SAMPLE_CERTIFIED` |

O campo `sample.claim` é **inerte**: pode existir no JSON da amostra, mas
nenhum gate o consome como fonte de certificação.

## Fail-closed em tudo

A autoridade **nunca devolve um conjunto vazio silencioso**. Qualquer um destes
casos é erro explícito (`BenchmarkCertificationAuthorityError` com código
tipado):

| Código | Condição |
|---|---|
| `BENCHMARK_CERTIFICATION_AUTHORITY_REPORT_MISSING` | relatório ausente — rode `validate:benchmark-sufficiency` antes |
| `BENCHMARK_CERTIFICATION_AUTHORITY_REPORT_MALFORMED` | JSON inválido, sem lista `verticals` ou sem `generatedAt` válido |
| `BENCHMARK_CERTIFICATION_AUTHORITY_REPORT_STALE` | relatório mais velho que o teto de frescor (default **7 dias**, mesma política dos relatórios das waves; override via `BENCHMARK_CERTIFICATION_AUTHORITY_MAX_AGE_MS`) |
| `BENCHMARK_CERTIFICATION_AUTHORITY_REPORT_INCONSISTENT` | os agregados top-level publicados (`sufficientVerticals`, `sampleSufficientVerticals`) contradizem a derivação por vertical — uma autoridade que discorda de si mesma não certifica nada |

A derivação em si é uma função **pura** (`deriveCertifiedVerticals(report)`),
testável sem disco; o carregamento fail-closed é
`loadCertificationAuthority()`.

## Consumidores

Os três gates chamam `loadCertificationAuthority()` e publicam, nos seus
relatórios, o **mesmo** conjunto `certifiedVerticals`:

- `scripts/governance/validate-benchmark-semantic-version.js` →
  `reports/benchmark-semantic-version-report.json`
- `scripts/governance/validate-benchmark-persisted-corpus.js` →
  `reports/benchmark-persisted-corpus-report.json`
- `scripts/governance/validate-benchmark-phase-model.js` →
  `reports/benchmark-phase-model-report.json`

## Gate de consistência (2026-09-19)

`npm run validate:benchmark-certification-consistency`
(`scripts/governance/validate-benchmark-certification-consistency.js`, gate
`BENCHMARK_CERTIFICATION_CONSISTENCY`, **bloqueante** no agregado
`validate:governance-enforcement`) fecha as duas formas de PASS vacuoso:

- **`BENCHMARK_CERTIFICATION_CROSS_CONSISTENCY`** — o conjunto certificado pela
  autoridade tem de ser **idêntico** ao auditado pelo semantic-version e pelo
  persisted-corpus; e o phase model é coerente (vertical certificada tem fase
  >= `SAMPLE_SUFFICIENT`; fase >= `SAMPLE_SUFFICIENT` sem a autoridade
  certificar é "certificação por omissão" — violação).
- **`BENCHMARK_CERTIFICATION_NON_VACUOUS`** — `certifiedVerticals > 0` exige
  auditoria real: o conjunto de verticais efetivamente auditadas pelo
  semantic-version é igual ao certificado e `persistedFindingsChecked > 0`.
  "Certificado" sem um único achado auditado é FAIL.
- **`BENCHMARK_CERTIFICATION_INPUT_UNAVAILABLE`** — qualquer relatório de
  insumo ausente, malformado ou stale é violação explícita; o gate nunca infere
  nada por conta própria.

Relatório: `reports/benchmark-certification-consistency-report.json`.
