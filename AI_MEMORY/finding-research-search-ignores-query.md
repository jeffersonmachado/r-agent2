# Achado crítico — a busca do MCP research não honra a query

**Data:** 2026-09-19 · **Severidade:** bloqueia toda a descoberta de mercado

## O que foi medido

Chamadas diretas ao `research_search` do `mcp-research`
(`backend: bing`, `mode: ONLINE`), com `snippet: null` em todos os itens:

| Query enviada | O que voltou |
|---|---|
| `bakery management software` | `login.authorize.net`, `www.authorize.net` — **gateway de pagamento** |
| `veterinary clinic management software` | `forums.commentcamarche.net` (fórum francês sobre código de verificação do Facebook/WhatsApp), `tinhte.vn` (páginas vietnamitas sobre **Canva AI**) |

Os resultados **não têm relação com a query** — nem entre si. Não é "resultado
ruim para uma query difícil": é conteúdo arbitrário.

## Por que isto importa mais que os sintomas

O ciclo da vertical `bakery` falhou assim:

```
discovery: universo=23 independentes=0 foraDeMercado=23
handoff:   http=400 market_discovery_handoff_unavailable
sample:    market_run_not_completed: run ... sem discovery set persistido
```

Os 23 candidatos eram dicionários (`dicio.com.br`, `significados.com.br`),
rede social (`facebook.com`, `reddit.com`) e blogs — **nenhum software de
padaria**. O motivo gravado, em 23 de 23:

```
reason: category_signals_below_minimum
minSignals: 1 · signalCount: 0 · matchedTerms: [] · homepageChecked: true
```

**O filtro de relevância funcionou corretamente.** Ele recebeu lixo e rejeitou
o lixo. Todo o encadeamento a jusante — relevância, arquétipos, handoff,
pré-registro de holdout — está correto e operando sobre entrada inválida.

## O que foi DESCARTADO por medição (não repetir)

| Hipótese | Status |
|---|---|
| Diferença de idioma (termos em inglês, candidatos pt-BR) | **errada** — os termos incluem pt-BR (`software para padaria gestão de produção`, …) |
| `marketContext` ausente → fallback com queries genéricas | **errada** — `buildMarketQueries` produz os 7 termos de categoria corretos, sem fallback |
| Filtro de relevância com critério errado | **errada** — o critério é `minSignals: 1`, e nenhuma página tinha um único termo |
| Construção da query | **correta** — 7 termos legítimos para bakery; 25 para beauty (7 + padrões de concorrente, porque beauty tem benchmarks) |

## Consequência

Toda vertical depende de `marketDiscovery`, que depende do `research_search`.
Enquanto o provedor devolver conteúdo arbitrário:

- nenhuma vertical sai de `NOT_STARTED`;
- o `holdout` não é pré-registrado (falta o discovery set);
- `validate:benchmark-phase-model` mantém 5 bloqueios.

Não é um defeito de configuração de vertical. É do **backend de busca**.

## Próximos passos

1. Investigar o adaptador `bing` dentro de `services/mcp-research` — o que
   efetivamente é consultado e o que é parseado.
2. Comparar com o histórico: o run de `beauty` das 06:01 produziu 21
   independentes de 35; o das 14:55 falhou com
   `mcp_call_failed: research_inspect_documentation: fetch failed`. O backend
   parece instável — verificar se houve mudança entre as execuções.
3. Só depois reprocessar as verticais.

## Medição decisiva (2026-09-19) — causa raiz confirmada, hipóteses encerradas

Três medições independentes, cada uma isolando uma camada:

| Medição | Resultado | Conclusão |
|---|---|---|
| `searchRaw` DDG isolado (código real, Bing apontado p/ endpoint morto) | `n=0`, `reason: duckduckgo: research_fetch_failed` | DDG **inalcançável** desta rede (falha de transporte, não de parsing) |
| `searchRaw` Bing isolado (DDG apontado p/ endpoint morto) | `n=10` de conteúdo alheio | Bing responde 200 com página **sem relação com a query** |
| **fetch cru** do mesmo URL, sem nossa camada | HTTP 200, 122699 bytes, `<h2>` = `Gmail - Email from Google`, `Sign in - Google Accounts`, `Connexion : comptes Google` | **não é nosso parser nem nossa URL** — o HTML cru já não tem resultados |

Não-determinismo provado: a MESMA query `bakery management software` retornou
`eletricistas de Summerville/SC` numa chamada e `When I Work` (software de
escalas) em outra. Nenhuma das duas tem relação com padaria.

### Correção aplicada

`assessSearchResultRelevance(query, candidates)` (pura, em
`api/services/research/nativeResearchProvider.js`, exportada): recusa o conjunto
de um backend quando NENHUM candidato compartilha radical com NENHUM termo
significativo da query. `searchRunner` passa a cair para o próximo backend com o
motivo nominal `<backend>: search_results_unrelated_to_query (0/N casam ...)` em
vez de aceitar lixo.

Antes: `n=10` de eletricistas → 23 candidatos sem um único termo de categoria →
rejeição em massa → 400 genérico no handoff.
Depois: `n=0` com `bing: search_results_unrelated_to_query (0/10 casam bakery)`.

Deliberadamente conservadora (um único acerto aceita o backend; query sem termo
significativo não decide e não recusa) — recusar por ambiguidade seria forçar
verde.

### O que NÃO está resolvido

A busca em si continua inoperante nesta rede: DDG falha no transporte e o Bing
devolve página alheia. A correção torna a falha **honesta e localizada na causa**
(zero candidatos + motivo nominal) em vez de silenciosa (lixo virando candidato).
Restaurar a capacidade exige outro backend (API paga ou scraper alternativo) —
decisão do dono do produto, com custo, e por isso não tomada unilateralmente.

### Correção de documentação

O comentário de `nativeResearchProvider.js` afirmava que "o Bing atende com
resultados reais em blocos `<li class="b_algo">`". Falso no estado medido; o
comentário foi corrigido com a medição.

## Levantamento de backends gratuitos (2026-09-19) — nenhum viável

Medido com a query `bakery management software`, sem nossa camada (fetch cru):

| Backend | Resultado | Veredito |
|---|---|---|
| `html.duckduckgo.com` / `lite.duckduckgo.com` | `fetch failed` | inalcançável (transporte) |
| `www.bing.com` | HTTP 200, conteúdo alheio (eletricistas / login Google / "When I Work") | responde lixo |
| `www.mojeek.com` | HTTP 403 | bloqueado |
| `www.ecosia.org` | HTTP 403 | bloqueado |
| `search.brave.com` | HTTP 429 | rate limited |
| `search.yahoo.com` | HTTP 500 | indisponível |
| `www.startpage.com` | HTTP 200, 0 ocorrências de termo da query | sem resultados |
| `searx.be` | HTTP 200, 11 KB, 0 link externo | sem resultados |
| `search.marginalia.nu` | HTTP 200, título ECOA a query, **2 âncoras externas** (`lite.ip2location.com` = anúncio, `creativecommons.org` = licença) | **zero resultados**, e as mesmas 2 âncoras para `gym management software` |
| `en.wikipedia.org/w/api.php` | HTTP 200, funciona | enciclopédia — não serve para descoberta de fornecedores |

Dois padrões que valem registrar:

1. **Título que ecoa a query não é resultado.** O Marginalia devolve
   `<title>bakery management software - Marginalia Search</title>` com 37 KB de
   HTML e zero resultados. Um checador de relevância que olhasse só o TEXTO da
   página seria enganado pelo eco da própria query — motivo pelo qual
   `assessSearchResultRelevance` julga os **candidatos extraídos**, não a página.
2. **Página idêntica para queries diferentes é o mesmo defeito do Bing**: as 2
   âncoras do Marginalia são as mesmas para padaria e academia.

### Consequência

Não existe backend gratuito por scraping viável nesta rede. A capacidade de busca
depende hoje **exclusivamente** de scraping de dois endpoints, ambos inoperantes,
e **nenhum provedor por API está configurado** (não há variável de ambiente nem
adaptador — `api/services/research/` contém apenas `nativeResearchProvider.js` e
`governedResearchProviders.js`).

Portanto o destravamento das verticais paradas (bakery, clinic, food, market,
services) exige escolha de fornecedor com chave — decisão de custo do dono do
produto. O que **não** falta é adaptador genérico: o `searchRunner` já tem a lista
`backends` e passa a recusar backend que não responde à query, de modo que um
backend por chave pode ser acrescentado sem tocar em nada mais.

## Atualização (2026-09-19) — backends por API implementados

A afirmação acima ("nenhum provedor por API configurado, não há adaptador")
descrevia o estado **anterior** à correção. O adaptador foi criado:
`api/services/research/apiSearchBackend.js` (módulo puro: monta a requisição e
extrai resultados, sem I/O) com dois providers, ativados só quando **todas** as
variáveis existem:

- **Brave Search API** — `BRAVE_SEARCH_API_KEY` (chave no header
  `x-subscription-token`, nunca na URL);
- **Google Custom Search JSON API** — `GOOGLE_CSE_API_KEY` **e**
  `GOOGLE_CSE_ID`.

Ordem determinística `brave` → `google`, **antes** dos backends de scraping no
`searchRunner` (`nativeResearchProvider.js`); o veredito de relevância continua
sendo do `assessSearchResultRelevance` — backend por API que responda página
alheia é recusado exatamente como o de scraping. Sem chaves, o comportamento é o
de antes (scraping) e a pesquisa online falha **honestamente** (`n=0` + motivo
nominal por backend; market discovery degrada a
`provider_returned_no_relevant_candidates`). Estado classificado como
**BLOCKED_EXTERNAL**: credencial externa ausente, não NO_GO do core local.
Doc operacional: `docs/mcp-research/operations.md` ("Provider de busca
indisponível").
