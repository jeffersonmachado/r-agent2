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
