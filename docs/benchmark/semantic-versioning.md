# Versionamento semântico do pipeline de benchmark e reprocessamento

> Um achado de benchmark ("esta empresa permite check-in antecipado") é uma
> conclusão produzida por um **programa** — o pipeline semântico
> (extrator → classificador → normalizador → clustering). Se o programa muda,
> conclusões antigas foram produzidas por outro programa e não podem continuar
> certificando a vertical. Este documento descreve o comportamento **vigente**
> (verificado no código em 2026-09-19).

## semanticPipelineVersion

Computada por
`api/services/benchmark/semantic/semanticPipelineVersion.js`
(`getSemanticPipelineVersion()`), no formato `sem-v1:<hash>` — SHA-256
canônico do **conteúdo** dos 4 módulos do pipeline, na ordem em que produzem a
conclusão:

1. `api/services/benchmark/semantic/semanticExtractor.js`
2. `api/services/benchmark/semantic/observationClassifier.js`
3. `api/services/benchmark/semantic/normalizationPipeline.js`
4. `api/services/benchmark/semantic/clustering.js`

Regras de derivação (fixadas no código):

- **Nunca** derivar de timestamp (duas execuções do mesmo código têm de produzir
  a mesma versão) nem de commit/branch (o que certifica um achado é o programa,
  não a posição no histórico).
- Qualquer byte alterado nos módulos muda a versão — **inclusive comentário**.
  Stripar comentários antes de hashear seria o erro perigoso (um stripper com
  bug pode remover código e fazer dois programas diferentes colidirem na mesma
  versão). O modo escolhido é fail-closed: mudança cosmética invalida a
  certificação e exige reprocessar. Reprocessar é barato; certificar errado não.
- Adicionar/remover um módulo da lista muda a versão mesmo com conteúdo
  inalterado — o programa passou a ser outro. Mudar a **forma** de derivar a
  versão exige bumpar `SEMANTIC_VERSION_FORMAT` (`semantic-pipeline-v1`), senão
  versões antigas e novas podem colidir.

## Avaliação de versão (fail-closed)

`evaluateSemanticVersion(doc)` compara a versão registrada no documento com a
do pipeline atual:

| Condição | Resultado |
|---|---|
| sem `semanticPipelineVersion` | `SEMANTIC_VERSION_MISSING` (não é "compatível por padrão") |
| formato desconhecido (não começa com `sem-v1:`) | `SEMANTIC_VERSION_FORMAT_UNKNOWN` |
| versão diferente da atual | `STALE_SEMANTICS` |
| versão igual à atual | `current: true` |

## Estados de achado (finding)

Fonte: `api/services/benchmark/benchmarkResearchStore.js`
(`RETIRED_FINDING_STATES`).

- **Ativos:** `VERIFIED` / `VALIDATED` — o corpus vigente; são os achados
  auditados por versão e por política nos gates.
- **Aposentados:** `SUPERSEDED` / `REJECTED` / `STALE_SEMANTICS` — fora da
  auditoria de versão/política, mas **contados e publicados** pelos gates
  (`persistedFindingsRetired`, por vertical). Nada é deletado: a trilha é o
  banco. `retireFinding` recusa re-aposentar — a primeira decisão governada
  fica.

## Certificação exige a versão corrente

O gate `validate:benchmark-semantic-version`
(check `CERTIFIED_SAMPLE_SEMANTIC_VERSION_CURRENT`) exige que a amostra de uma
vertical **certificada** (ver
[`certification-authority.md`](certification-authority.md)) tenha
`semanticPipelineVersion` igual à do pipeline atual: versão ausente, de formato
desconhecido ou antiga → `STALE_SEMANTICS` (FAIL). Amostra de vertical não
certificada é reportada como `NOT_CERTIFIED`, sem auditoria de versão. O gate
`validate:benchmark-persisted-corpus` aplica a mesma regra ao corpus persistido.

## Scripts do ciclo de reprocessamento

### `scripts/benchmark/reprocess-semantic-research.js`

Reprocessa a pesquisa competitiva já obtida pelo funil semântico **sem refazer
fetch**: as observações brutas persistidas do run de origem (com
locator/fragmentHash/contentHash ligados à evidência real) são a entrada —
nenhuma página é re-obtida, nenhum conteúdo é inventado. Abre um run novo
(`--to-version`), recria fontes/evidências/inspeções com ids determinísticos
(hashes preservados — binding criptográfico intacto), roda o funil por fonte,
refaz estados de eixo e escreve o relatório BEFORE/AFTER com as decisões
**reais** do engine (`evaluateSampleSufficiency`) — nunca patcha veredito. O
sample versionado **não** é reescrito: o merge é calculado em memória e vai
para o relatório; aplicar o patch ao sample é decisão governada à parte (fluxo
de proposta em [`change-proposals.md`](change-proposals.md)). O holdout só é
reprocessado com base auditável (`saturation_marked` ou
`previously_analyzed_in_sample`); holdout nunca aberto continua proibido.

### `scripts/benchmark/apply-semantic-reprocess.js`

Reprocessa **e governa o corpus no mesmo run** (`--to-version`). É o produtor
dos estados de aposento (que antes tinham consumidor nos gates e nenhum
produtor):

- reproduzido pelo pipeline atual → `SUPERSEDED` (`supersededBy` = id do achado
  novo, com `oldSemanticVersion`/`newSemanticVersion`/`reprocessRunId`);
- normalizado mas fonte não verificável → `REJECTED` (`source_not_verifiable`);
- rejeitado pelo classificador atual → `REJECTED` (razão do funil:
  `marketing_claim`, `headline`, `faq_question`, `noise`...);
- candidato não resolvido → `REJECTED` (`unresolved_semantic_candidate`);
- **sweep**: todo achado ainda ativo em runs **anteriores** (histórico de outras
  versões do pipeline) vira `STALE_SEMANTICS`, com as versões antiga/nova
  registradas — ele existiu, foi produzido por outro programa e não sustenta
  mais a certificação.

**Idempotente** (re-rodar com o mesmo `--to-version` não duplica nem
re-aposenta): run/fontes/evidências/inspeções têm ids determinísticos (upsert);
`insertFinding` é idempotente por conteúdo (o retry devolve a mesma linha, logo
o `supersededBy` gravado é estável); `retireFinding` recusa re-aposentar.
**Nada é apagado.** O sample versionado não é reescrito aqui — o patch vai para
o relatório e a aplicação é decisão governada à parte.

### `scripts/benchmark/record-semantic-version.js`

Produtor legítimo do campo exigido pelo gate: grava a
`semanticPipelineVersion` **corrente** no sample de uma vertical, **depois**
do reprocessamento. Não reprocessa nada por conta própria e não inventa versão:
deriva do conteúdo dos módulos agora e é **fail-closed com o run de
governança** — exige `--run <runId>` e falha se o run não existir em
`GovernanceRun` (uma certificação sem run é uma afirmação sem dono). Sem este
script o gate seria um beco sem saída e o único caminho para verde seria editar
o JSON à mão — exatamente o atalho que o gate existe para impedir.

## Exercício real de 2026-09-19 (fitness)

Reprocesso executado no run `fitness-semantic-2026-09-19-r2`
(`--to-version`, a partir da evidência original — `from latest-per-benchmark`):

- **423** achados novos gravados pelo pipeline atual (corpus vigente —
  `persistedFindingsChecked: 423` no relatório do gate);
- **4.449** achados históricos aposentados (`persistedFindingsRetired: 4449`,
  todos fitness — reproduzidos/rejeitados pelo pipeline atual ou varridos como
  `STALE_SEMANTICS`), nenhum deletado;
- veredito do engine **SAMPLE_SUFFICIENT antes e depois**
  (`MARKET_SAMPLE_CERTIFIED`, `certifiable: true`) — o reprocesso mudou a leitura
  do mesmo material, não a evidência;
- `semanticPipelineVersion` resultante registrada no sample:
  `sem-v1:9b0c801eb6ab5ba73344ede66481121b`.

Relatórios: `reports/benchmark-semantic-reprocess-fitness-apply.json` (BEFORE/
AFTER + aposentos), `reports/benchmark-semantic-version-report.json` e
`reports/benchmark-persisted-corpus-report.json` (contagens auditadas).
