# PB-1 — Protocolo de Benchmark Controlado do Pool (CODER)

Status: **PROPOSTO — NÃO EXECUTADO**. Exige decisão do dono da plataforma antes de rodar.

## 1. Objetivo

Substituir inferência por medição: obter `P(runtime_response)`, `P(patch_válido|resposta)`,
`P(aplicado|válido)`, `P(teste_ok|aplicado)`, `E[tempo/GREEN]` e `E[custo/GREEN]` **por modelo
CODER, com desenho controlado** (mesmos casos, mesmo contexto, mesma avaliação), em vez de derivar
de telemetria histórica de produção.

## 2. O que este protocolo NÃO faz

- não cadastra, valida nem solicita credenciais;
- não altera allowlists, catálogo, `timeout-policy.json` nem o roteador;
- não repara patch automaticamente;
- não reduz gates, cobertura ou critérios de aceitação;
- **não grava no `engineering_tasks`/`engineering_attempts`** (ver §7 — gravar lá reintroduziria o
  defeito `EVIDENCE_POISONING` medido).

## 3. Autorizações necessárias

| Cenário | Exige |
|---|---|
| Somente com os **9 modelos `runtime_available`** (deepseek-flash, deepseek-v4-pro, qwen3-coder-flash, qwen3-coder-plus, qwen3-max, gpt-4o, gpt-5.4-mini, kimi-k2.7-code, kimi-k2.7-code-highspeed) | Nada além do **orçamento de quota** (§8). Nenhuma credencial nova. |
| Incluir **qualquer modelo sem credencial** (`anthropic:claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5`, `mistral:mistral-large-latest`, `groq:llama-3.3-70b-versatile`) | **Cadastro de credencial pelo dono** (tabela `tenant_ai_credentials`, via Configuração → IA). Sem isso o modelo permanece `UNMEASURED_EXTERNAL_CANDIDATE` e **não recebe taxa estimada**. |

## 4. Desenho

- **Unidade experimental** = caso de código real já existente, replayável:
  `(source_commit, objetivo, allowedPaths, acceptanceCriteria, testCommands)`.
  Candidatos prontos: as tasks da missão `ca56cbdc-…` (INC-1..INC-3), que têm critérios
  verificáveis, `source_commit` resolvível e `testCommands` determinísticos.
- **Tratamento**: cada modelo recebe **o mesmo prompt**, montado pelo caminho real
  (`coderService.buildCoderPrompt(context)` + `contextBuilderService` sobre o `source_commit`) —
  evita prompt sintético divergente do pipeline.
- **Chamada**: `engineeringAiInvoker.invokeModel({ providerId, modelId, prompt, tenantId })`
  — **modelo explícito, sem roteador**. É o que torna as células comparáveis.
- **Sem retry**: mede-se a **primeira** tentativa (retry mascara a taxa real).
- **Avaliação por tentativa** (ordem fixa, cada etapa registrada):
  1. extração do patch pelo caminho real do coder;
  2. validação estrutural (`parseUnifiedDiff`/`validatePatch`) — registra o código de rejeição;
  3. `git apply --check` em **worktree limpo** do `source_commit`;
  4. se aplicou: `testCommands` no worktree, com exit code e stderr;
  5. medição de wall time e tokens (`usage` do provider).
- **Repetições**: `N = 10` por célula (modelo × caso). Para p≈0,45 isso dá ±31% no IC95 de Wald,
  por isso **o IC de Wilson por célula é obrigatório no relatório** (§6). Com `N = 10` só se
  conclui diferença grande; para separar 45% de 60% seriam necessárias ~35 repetições por célula.
- **Casos por rodada**: começar com **2 casos** (um `CODE_GENERATION` que feche com patch novo, um
  `BUG_FIX` que edite arquivo existente). Total por rodada: `9 modelos × 2 casos × 10 = 180`
  chamadas de coder.
- **Determinismo**: fixar `temperature`/`top_p`/seed quando o provider permitir e **registrar os
  parâmetros usados** (sem isso a célula não é comparável).

## 5. Métricas por (modelo, caso)

- dispatches, respostas com texto utilizável, 429/quota, timeout, empty/reasoning exhaustion;
- patch emitido; patch estruturalmente inválido (por código: header ausente, contagem de hunk, prefixo);
- `git apply --check` PASS; patch aplicado; TEST_FAIL ou TEST_TIMEOUT; GREEN;
- latência p50/p95; tokens in/out; custo quando o provider devolver;
- `E[tempo/GREEN] = Σ wall_ms / GREENs`; `E[custo/GREEN]` idem, quando houver custo.

## 6. Regras de conclusão

- Toda taxa vem com **IC95 de Wilson** e `n`. Sem IC, não há conclusão.
- `P(aplicado|resposta) ≥ 0,80` **e** `P(teste_ok|aplicado) ≥ 0,50` com `n ≥ 10` ⇒ candidato a
  priorização no ranking.
- Modelo com `n = 0` executado permanece **`UNMEASURED_EXTERNAL_CANDIDATE`**; nunca recebe taxa
  estimada nem `expected_cost_per_GREEN` inferido.
- Diferença entre modelos só é declarada quando os **intervalos de confiança não se sobrepõem**.

## 7. Isolamento da evidência (obrigatório)

O benchmark **não pode** criar `engineering_tasks` reais: `loadModelDecisionEvidence` agrega as 200
tasks mais recentes do `task_type` **sem filtrar origem**, e a auditoria de 2026-10-07 mediu que o
histórico já está contaminado por execuções de teste (`jest-review` 423 attempts, `TEST` 176,
`verify-real-task-recovery` 143) — a ponto de `anthropic:claude-sonnet-5`, **sem credencial e sem
execução real**, aparecer como `tier=0 PROVEN, P(applied)=97%, ECG=3.08` e ser a **primeira escolha**
do ranking, enquanto `deepseek:deepseek-flash` (melhor coder real: 43% GREEN/dispatch) aparece com
`P(applied)=12%`.

Portanto: resultados do PB-1 ficam em **artefato próprio** (`AI_MEMORY/evidence/<data>-pb1/…`),
com marcador `BENCHMARK:PB1`. Se algum dia forem persistidos no banco, **antes** é preciso um campo
de origem (`origin = PRODUCTION | BENCHMARK | TEST`) e o filtro correspondente na montagem da
evidência do ranking.

## 8. Orçamento e segurança

- Teto de chamadas definido **antes** de rodar; a rodada para ao atingi-lo.
- Servidor de trabalho: worktrees temporários em `/tmp`, removidos ao final; nada é aplicado no
  workspace real.
- Nenhum segredo transita pelo log: registrar apenas provider/model.
- Rodar com a API viva é aceitável, mas o harness é **externo ao Worker** (não usa lease de task).

## 9. Saída esperada

1. `pb1-results.json` — célula por célula, com IC95.
2. `pb1-summary.md` — tabela por modelo + veredito (`PRIORIZÁVEL` / `INSUFICIENTE` / `UNMEASURED`).
3. Recomendação de ranking **por evidência medida**, sem favorecer modelo por nome.
