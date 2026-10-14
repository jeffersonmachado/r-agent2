# Validação de engenharia por níveis (L1/L2/L3)

Camada de validação incremental da plataforma. Substitui a política de "rodar tudo
sempre" e a de "adivinhar o que rodar" por uma decisão **estruturada, medida e
fail-closed**.

## Por que existe (medido em 2026-10-14, antes de qualquer código)

O RAP não tinha o elo entre *arquivo alterado* e *teste a reexecutar*. Os quatro
mecanismos existentes, medidos nesta árvore:

| Mecanismo | Cobertura medida | Usado no fluxo? |
|---|---|---|
| `qa/impact-map.json` (consumido por `qa:mesh:impact`) | **28/2488 = 1,13%** | sim, e é inoperante |
| inventário por `source` exato | 367/2479 = 14,80% | não |
| caminho → `module` → itens | 301/2465 = 12,21% | não |
| módulo → jornada → cenário do mesh | 222/2465 = **9,0%** | não |
| **nenhuma seleção possível** | **2243/2465 = 91,0%** | — |

Os vocabulários também não conversam: o `impact-map` produz 7 escopos; os 144
cenários do mesh declaram 26 (interseção de 4). Como 133/144 declaram
`ci`/`telemetry`, o filtro "por impacto" ou seleciona ~92% do mesh ou 1-3% — nunca
o alvo. O módulo `queue` **não existe** no inventário, então o commit que corrigiu
o defeito das filas (`9f0f6fda8`) era invisível para todos eles.

**O que faltava não era um orquestrador: eram os dados de ligação.**

## L1 — direcionado por impacto

Implementação: `qa/coverage/impactGraph.js` (puro), `qa/coverage/impactSelection.js`
(puro), `scripts/governance/build-impact-graph.js`,
`scripts/governance/run-impact-validation.js`.

O elo é derivado dos próprios `require`/`import` que os arquivos já declaram —
determinístico, sem heurística de nome. Medido no grafo real: 4126 nós, 9370
arestas, **77,3%** dos arquivos de produção têm dependentes; 73,6% alcançam ≥1
teste.

Camadas, aplicadas em união:

1. **Transitiva** — fecho reverso do grafo de imports (quem depende do alterado,
   direta ou indiretamente). Também executa o próprio arquivo de teste alterado.
2. **Jornada** — itens de inventário ligados à jornada → cenários do mesh (o único
   elo com vocabulário compartilhado: 88/95).
3. **Vizinhança** — regras declaradas por prefixo em `config/impact-neighborhood.json`,
   sempre com `reason` justificando a evidência.

**Fail-closed**: arquivo de produção que nenhuma camada classifica **ESCALA** o
nível. O runner nunca devolve "nenhum teste afetado" como sucesso. Exit codes:
`0` verde, `1` vermelho, `2` ESCALATE, `3` infra.

**Runners separados**: `jest.config.cjs` não tem `frontend/` nos `roots`, então
testes de frontend vão para o Vitest (`separarPorRunner`). Passar um teste Vitest
ao Jest produzia **falso vermelho** ("1 teste falhou" para um teste que passa).

**Nenhuma suíte executada = INFRA**, nunca verde: a seleção precisa produzir
evidência.

## L2 — suíte autoritativa do manifesto canônico

`npm run test:release-authoritative` (`scripts/governance/run-release-suites.js`),
executada em lotes, cobrindo **todas** as suítes de
`config/canonical-release-suites.json` (incluindo `NOT_EXECUTED`).

## L3 — validação de governança completa

`npm run validate:all-validators` — os 61 validadores do agregado, com o resultado
individual preservado. A **selagem não acontece aqui**: o orquestrador valida, não
publica.

## Orquestrador

`scripts/governance/engineering-validation-orchestrator.js` — cascata com decisão
auditável em `reports/validation-orchestrator-report.json`:

```
L1 verde  e sem escalação  -> encerra em L1
L1 ESCALATE               -> sobe para L2
L1 VERMELHO               -> para e reporta
L2 verde                  -> encerra em L2 (ou L3 com --level=l3 / --escalate-to-l3)
```

**Nenhum nível não-executado pode ser verde**: `--dry-run` produz
`INCONCLUSIVE_DRY_RUN` (exit 2), nunca `GREEN_AT_Ln`. Foi um defeito real
introduzido e corrigido nesta mesma sessão (o `else` da cascata reportava
`GREEN_AT_L2` sem executar nada).

## Comandos

```bash
npm run impact:build        # gera reports/impact-graph.json (determinístico, ~2s)
npm run impact:check        # falha se o artefato estiver desatualizado
npm run impact:validate     # executa o L1 (aceita --files=a,b e --base=<ref>)
node scripts/governance/engineering-validation-orchestrator.js [--level=auto|l1|l2|l3] [--files=a,b]
```

`reports/` está fora de `SOURCE_ROOTS`: regenerar os artefatos **não** invalida o
release entregue.

## Limitação conhecida

Hubs de importação (`api/db/models/index.js`, `api/__tests__/*`) inflam o alcance:
alterar `api/modules/queue/service.js` seleciona 219 testes. É conservador por
desenho (na dúvida, validar mais), mas a priorização por hub é melhoria pendente.

## Pré-requisito do L2: evidência vinculada ao `sourceFingerprint`

Medido em 2026-10-14. O L2 pode terminar **RED sem nenhum teste falhar**:

```
blockingFindings: [{ code: 'MANIFEST_SUITE_NOT_PASS:INFRA_ERROR',
  suite: 'tests/integration/engineeringRouterAuditEnvelopeGeneration.test.js',
  detail: 'infraestrutura obrigatória ausente (RELEASE_AUTHORITATIVE exige falha explícita)' }]
coverage: { covered: 88, total: 89 }   totals: { testsExecuted: 1022, failedSuites: 0 }
```

`tests/helpers/infraGate.js` (`skipOrFail`): em dev, falta de evidência vira
`NOT_EXECUTED` com motivo e a suíte passa; em `RELEASE_AUTHORITATIVE=1` **lança
INFRA_ERROR** — o gate não pode passar sem sinal real. O teste exige evidência
casada com o `sourceFingerprint` **atual**; alterar código em `SOURCE_ROOTS`
**invalida** a evidência.

Remédio antes de rodar o L2/L3 (ou selar):

```bash
export PBX_CALL_EVENTS_RUNTIME_INSERT_MODE=direct
npm run validate:engineering-router-v1:runtime      # regenera RUNTIME_PASS
```

**Leitura obrigatória do resultado**: `INFRA_ERROR` com `failedSuites: 0` e
cobertura `< total` significa **suíte não executada por pré-requisito**, não
regressão. Um teste que passa isolado pode falhar no modo autoritativo — o modo faz
parte do contrato.

## Defeitos encontrados por esta camada

- `DEF-TIMEBOMB-EVOSYNC-JANELA30D` — na primeira execução real do L1 (1 de 219
  testes): `tests/integration/evoSyncIntegration.test.js` fixava
  `frequency30d === 2` sobre entradas de 01-03/09/2026; a janela é móvel
  (`agora - 30d`) e venceu em 03/10/2026. Quebrado há ~11 dias sem que nenhum gate
  o executasse. Prevenção: `validate:no-date-bombs` (bloqueante no agregado).
