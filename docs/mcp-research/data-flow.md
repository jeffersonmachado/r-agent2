# MCP Research — fluxo de dados da pesquisa

Como um dado flui do Market Discovery até a saturação de benchmark, e onde o
container MCP entra nesse pipeline. Fontes: `services/mcp-research/src/*`,
`api/services/benchmark/benchmarkResearchRunner.js`,
`api/services/benchmark/researchCapabilities.js`,
`api/services/benchmark/benchmarkResearchService.js`,
`api/services/benchmark/benchmarkResearchSupervisor.js`,
`api/services/benchmark/semantic/*`.

## Visão de ponta a ponta

```
Market Discovery / Benchmark Runner
        │  pede a CAPABILITY (nunca o provider)
        ▼
Canonical Tool Registry ── resolveProvider (determinístico, auditável)
        │                    nativo tem precedência; MCP externo é provider
        ▼
conexão system/mcp-research (MCP Client Hub, bearer por credentialRef)
        ▼
container mcp-research ── research_search → research_fetch → research_inspect_*
        │                    → research_capture_evidence
        ▼
runner persiste achado COM fonte verificada + proveniência (§22)
        ▼
funil semântico (api/services/benchmark/semantic/)
  RAW OBSERVATION → SEMANTIC CLASSIFICATION → CANDIDATE FINDING → DEDUP
  → CLUSTER → NORMALIZATION → CANONICAL MAPPING → NOVELTY INPUT
        ▼
novidade canônica → política de suficiência → SATURAÇÃO (aparente, auditável)
```

## Etapa por etapa

1. **Market Discovery / runner** (`benchmarkResearchRunner.js`): o subagente de
   pesquisa **não acessa a web diretamente** — executa capabilities
   `research.*` via `executeResearchCapability`. Sem provider para a
   capability, o estado é `BLOCKED_NO_EXTERNAL_ACCESS` — nunca "zero
   novidade", nunca achado inventado.

2. **Search → fonte**: `research_search` devolve candidatos (título, URL,
   domínio, `retrievedAt`, `providerMetadata`). A seleção da fonte fica na
   política de pesquisa (a resposta da tool é DADO; nunca `VERIFIED_OFFICIAL`
   automático). A proveniência registra **como** a fonte foi escolhida
   (`sourceSelection: 'search' | 'declared-config'`).

3. **Fetch → hash**: `research_fetch` obtém o documento sob política de
   endpoint e devolve conteúdo **sanitizado** + `contentHash` (`sha256:` do
   conteúdo efetivamente devolvido) + status HTTP **real**. `verified` do
   achado vem desse status real — sem obtenção confirmada o achado é registrado
   como não verificado e **não conta como prova**.

4. **Inspeção**: `research_inspect_documentation` / `research_inspect_api_docs`
   extraem estrutura **do conteúdo recebido** (funções puras, determinísticas),
   cada item com `locator` na fonte. `contentHash` informado é verificado —
   divergência é recusa (`research_content_hash_mismatch`): a análise fica
   ligada ao documento obtido, nunca a uma versão posterior da mesma URL.

5. **Raw observation**: cada item extraído (texto + locator + contexto de
   seção) entra no funil como observação bruta. Inspeção por palavra-chave pura
   promovia headlines e slogans a "achados" (garbage-in medido no run real
   fitness 2026-09-15) — é contra isso que as próximas etapas existem.

6. **Classificação semântica** (`semantic/observationClassifier.js`): primeira
   barreira — classifica cada observação em tipo explícito usando sinais
   determinísticos (pontuação terminal, CTA/slogan, contexto de seção do
   locator, cláusulas, verbo+objeto). Só tipos `*_SIGNAL` seguem; rejeições são
   **nominais e contadas** (`marketingClaimsRejected`, `faqQuestionsRejected`,
   `noiseRejected`). `FAQ_ANSWER` pode render sinal via reavaliação estrutural.

7. **Finding candidato** (`semantic/semanticExtractor.js`): transforma sinal em
   forma estruturada (verbo + objeto de negócio + desfecho; regras de negócio
   ganham `{ condition, rule, effect, exceptions }`). O que resiste à
   estruturação vira `UNRESOLVED_SEMANTIC_CANDIDATE` — persistido para
   auditoria, **nunca** contado como novidade canônica.

8. **Normalização** (`semantic/normalizationPipeline.js` + `clustering.js`):
   dedup → cluster de equivalentes semânticos (chave: `canonicalId` da
   política, senão forma `object.verb`, senão assinatura de tokens) com
   anti-over-merge duro (`BENCHMARK_OVER_MERGE_REFUSED` — "freeze" ≠ "cancel"
   ≠ "pause") → normalização longest-match da política → mapeamento canônico.
   Todo candidato normalizado carrega source (url/tier), `contentHash`,
   fragment/locator, origin (`EXTERNAL_OBSERVED` exige locator), confidence e
   `normalizationRationale`.

9. **Evidência**: `research_capture_evidence` registra evidência de fonte com
   hash de conteúdo e referência determinística (`evidenceId`, `capturedAt`,
   `locator`, `fragmentHash`). `evidenceMissingRejected` e
   `hashMismatchRejected` são contadores do funil — achado sem evidência
   ligada não passa.

10. **Novidade** (`benchmarkResearchService.js`): só o que sai NORMALIZED do
    funil é elegível à novidade canônica. A semântica do engine define os
    numeradores (`new*` por dimensão); capacidade/jornada/regra **não mapeada**
    conta como novidade — mapeada é confirmação. `UNRESOLVED_SEMANTIC_CANDIDATE`
    é excluído da novidade pelo serviço.

11. **Saturação** (`benchmarkResearchSupervisor.js`): a política de suficiência
    canônica (`config/benchmark-sufficiency-policy.json`) define os thresholds;
    a saturação **aparente** só é marcada quando a janela analisada passa na
    política — janela insuficiente ou ponto não analisado **nunca** é
    saturação. Proveniência completa (agente, tool, conexão, fonte, evidência)
    via `buildResearchProvenance`.

## O que o container garante nesse fluxo

- **Ligação fetch → inspect → evidence pelo mesmo hash**: o `contentHash`
  devolvido é o do conteúdo sanitizado efetivamente entregue; a inspeção
  verifica o hash recebido; a evidência registra o mesmo hash.
- **DADO, nunca instrução**: conteúdo neutralizado antes de sair do container
  (`treatedAs: 'DATA_ONLY'`), e o registry reforça (`outputTrust: 'DATA_ONLY'`).
- **Nada inventado**: snippet indisponível é `null`; freshness não exeqüível é
  declarado (`freshnessEnforced: false`); sem superfície de API é
  `NOT_APPLICABLE`; `officialOnly` sem lista de domínios é recusa honesta.
- **Falha tipada, nunca silenciosa**: cada etapa devolve `error.code` estável,
  e o runner converte ausência de provider em bloqueio explícito — o pipeline
  de benchmark nunca confunde "não pesquisado" com "nada encontrado".
