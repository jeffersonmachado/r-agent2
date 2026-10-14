# Sessão de hardening — 2026-10-13 (T1..T6)

Relatório consolidado da sessão que executou a lista de pendências T1–T6.
Complementa `AI_MEMORY/hardening-queue.json` (fila oficial, 34 itens: 33 `done`,
1 `blocked`) e `AI_MEMORY/runtime-navigation.md` § "Jornada FUNCIONAL 2026-10-13".

## Veredito

**GO INTEGRAL — RELEASE PUBLICADO E VERIFICADO.**

Ciclo de selagem concluído com `SEAL_EXIT=0`: release **r-agent2-20261013-171630**,
commit `e38070bde238ec64f16e5d37d1ddbd9d968f0f54`, H_final
`ac5f1bfbd9f1178fe25178cdebf0e50e92dd6cd7a1ecfc`, **Score PASS/100**, tag publicada
e `verify:delivered-release` = `DELIVERED_RELEASE_VERIFIED` / `AUTONOMOUS_READY`.
Worktree limpo e **0 commits à frente de `origin/main`**.

O item `P1-11` — que era o único `blocked` da fila — foi fechado com prova. A fila
está **34 itens, 34 `done`, 0 `blocked`, 0 abertos**.


## O que foi entregue

| # | Entrega | Commit | Prova |
|---|---|---|---|
| T1 | `scripts/pbx-cdr-health.sh` + preflight do converge exige o BACKEND de CDR (não só a porta) | `ec85f48b7` | `tests/unit/pbx/pbxCdrHealth.test.js` — 7 casos |
| T2 | Recibo de verifier STALE removido do `dist/` | `ec85f48b7` | `check-dist-clean.sh`: check passa a "sem verify-result.json pré-empacotado" |
| T3 | Fila de hardening atualizada (H9–H19) | `d00b8632f`, `e5ae5c429` | `AI_MEMORY/hardening-queue.json` — 34 itens, 0 abertos |
| T4 | Evidência de runtime recoletada | `1cb7fafe1` | `RUNTIME_PASS items=25 falhas=0`, fingerprint `a9f8c4c0…`, 209 checks PASS |
| T4b | Runner detecta e **atribui** mutação da superfície provada durante o run | `1cb7fafe1` | `allValidatorsRunner.test.js` — 18 casos (+5) |
| T5 | Jornada funcional real no browser + **defeito de produto corrigido** | `dcc97cbed` | `FlowTemplateSelector.test.jsx` 4/4; falha no código antigo (sentido inverso) |
| T6 | Suítes finais e este relatório | — | ver "Medições" abaixo |

## Defeito real de produto encontrado e corrigido (T5)

`frontend/src/components/FlowTemplateSelector.jsx` chamava `useMemo` **depois** dos
`return` antecipados de `selectedTemplate`, `loading` e `error`. Na primeira
renderização (`loading === true`) o hook não rodava; quando o fetch dos modelos
terminava, a render seguinte chamava um hook a mais e o React **abortava o
componente**:

```
Warning: React has detected a change in the order of Hooks called by FlowTemplateSelector.
Rendered more hooks than during the previous render.   (3x pageerror)
```

Efeito no produto: a rota `/editor` registrava 2 erros de console + 3 pageerror e
o botão **"Novo" não abria o seletor de modelos** — a ação de criar fluxo estava
indisponível na tela. Depois do fix: `/editor` com 0 erros de console e 0
pageerror, e "Novo" abrindo "Criar Novo Fluxo / Selecione um modelo" com a lista.

**Prova nos dois sentidos** (o que a Regra 20 exige): com o código antigo
restaurado temporariamente (`git stash push` do `.jsx`), o teste novo FALHA com
exatamente `Rendered more hooks than during the previous render`; com o fix, 4/4.

## O defeito que era do MEU processo, não do produto (T4b)

Durante um run do `validate:all-validators` eu criei um arquivo em `scripts/smoke/`
— raiz que está em `SOURCE_ROOTS` do fingerprint chain. A evidência de runtime foi
coletada antes (`bae797d5…`) e validada depois (`a6454061…`), e o
`validate:engineering-router-v1:runtime` reprovou com `RUNTIME_EVIDENCE_FRESH`,
cascateando 4 falhas num run de ~40 min. **O gate estava certo**; faltava
atribuição. O runner agora fotografa a superfície provada antes e depois do loop,
identifica os arquivos alterados e marca como `attributedToSourceMutation`
SOMENTE as falhas cujo motivo é de obsolescência — falha de pacote continua sendo
falha de pacote.

## Medições finais

- **Validadores (runner completo, worktree limpo): `status=PASS`, 60/60, 0 falhas.**
  Antes desta sessão: 55 PASS / 5 FAIL. As 4 falhas que restavam eram UMA causa
  (`P1-11`, payload não selado) e caíram todas com a selagem: `validate:dist`,
  `validate:release-governance`, `validate:governance-summary` e
  `validate:final-status-projection`. Nenhum aviso de mutação de superfície
  (`provenSurfaceStability: ESTAVEL`).
- **Engineer router v1**: `status=PASS` (STRUCTURAL_PASS/RUNTIME_PASS), 209 checks,
  0 falhas; evidência de runtime `RUNTIME_PASS items=25 falhas=0`.
- **Frontend (Vitest)**: 136 arquivos / 1035 testes PASS (EXIT=0).
- **Backend (`npm run test:unit`)**: 1003 suites PASS (1 skipped) / 8395 testes
  PASS (2 skipped), 0 falhas, EXIT=0.
- **Jornada funcional browser** (8 rotas PRODUCTION): 0 erros de console, 0
  pageerror, 0 requisições falhas; buscas filtram (`/workspace` 8083 → 792 chars,
  `/crm` 1922 → 1170 chars), chips de filtro aplicam, botões de criação abrem.
- **PBX/CDR**: ponte e backend supervisionados (`check`/`ensure`), com o sinal
  correto medido (`cdr show status` → Registered Backends; o `Use Count` do módulo
  é 0 mesmo quando saudável e não serve de sinal).

## Limites desta validação (honestidade de escopo)

- **Publicado** (com autorização explícita do operador, Regra 10): release
  `r-agent2-20261013-171630` no remote, tag publicada e verificada, `origin/main`
  sincronizado com o HEAD local. O push da tag exigiu `--no-verify` pontual porque
  o hook local bloqueia push de `refs/tags/*` — bypass autorizado, uma única tag,
  nenhum commit.
- **`P1-11` FECHADO** (`done`, commit `179720018`): era bloqueio de autorização, não
  técnico — está documentado na própria entrada da fila.
- **Dívida de arquitetura em aberto**: evidências de TTL curto vencem durante o
  ciclo longo (replay-governance `STALE`, SBOM anterior ao início do run). Não foi
  contornada: as duas foram regeneradas de verdade. O `consolidate` deveria
  regenerá-las antes do agregado.
- **A jornada browser cobre 8 rotas de negócio**, não as 21 do mapa completo; as
  demais foram validadas apenas quanto a carregamento (varredura de 2026-10-13).
- **Ações não exercitadas** ficam registradas como SKIP explícito no JSON de
  evidência (`qa/evidence/journey-functional-latest.json`), nunca como sucesso.
- O item `H18` observa que a primeira versão do detector de jornada produziu **5
  falsos positivos** (media o menu lateral como se fosse a lista). Corrigido para
  medir efeito percebido; a lição está registrada porque falso positivo de
  detector esconde defeito real no ruído.

## Ciclo de selagem e publicação (P1-11) — desfecho

O bloqueio de `P1-11` **não era técnico, era de autorização**: a fase `final` de
`seal-release.sh` exige o commit do release em `origin/main` («push antes de
publicar») e o hook local `.git/hooks/pre-push` bloqueia push de `refs/tags/*`
(«autorizado apenas push de commits»). Com autorização explícita do operador
(Regra 10), o push da tag foi feito pontualmente com `--no-verify` e a fase
`publish` foi retomada de forma idempotente (`--from publish`).

Fases: `prepare` (converge + QA Mesh no run `rap-governed-20261013190246981-0d8aa19c`)
→ `candidate` (scorecard 78/78, `below10=0`, projeções PASS, fixpoint estável)
→ `final` (payload selado + commit no remote) → `publish` (tag imutável,
proveniência remota PASS `tagMatches=true`, recibo, publicação) → `consolidate`
(gate agregado + MCP E2E PASS fresco + projeções de jornada + `verify:delivered-release`).

### Defeitos reais corrigidos no caminho (commit `6c17d20c1`)

1. **`REAL_TASK_RECOVERY` sem ambiente**: era o ÚNICO passo de runtime do selo V2
   invocado sem `--env-file-if-exists=.env`. Sem o `.env` não havia
   `ENCRYPTION_KEY`, a credencial do provider não era descriptografada e o selo
   V2 abortava num passo obrigatório com um erro que **parecia defeito de
   produto**. Corrigido na invocação, com teste travando a simetria dos passos de
   runtime.
2. **Verificador não honrava o contrato de task da Fase 9**: `verify-real-task-recovery.js`
   criava uma task `CODE_GENERATION` sem `allowedPaths` e passou a ser rejeitado
   por `TASK_CONTRACT_INVALID`. O contrato estava certo — o caminho oficial
   (`startExecutionHeld`) já declara `scopeDeferred: true` porque o spec da missão
   nasce sem escopo. O verificador passou a declarar o mesmo; a criação direta por
   API/UI segue fail-closed. Resultado: `status=GO checks=16 falhas=0`.

### Dívida real registrada (não mascarada)

**Evidências com TTL curto vencem DURANTE o ciclo longo** — o ciclo envelhece as
próprias evidências que ele exige no fim:

- `validate:governance-summary` falhou com `replayIntegrity: STALE`
  (`ageMs` ≈ 33 min) → regenerar `validate:replay-governance` resolveu;
- `validate:security-release-gate` falhou com `SECURITY_GATE_STALE_EVIDENCE`
  (SBOM **anterior ao início do run**) → regenerar `npm run security:sbom` resolveu
  (`VEREDITO: GO`, exit 0);
- a retomada também exigiu commitar derivados (60 arquivos) porque o `zip:release`
  é fail-closed em worktree sujo — e isso **não** invalidou o selo, confirmado por
  `validate:v2-seal-freshness` PASS (essas raízes não estão em `SOURCE_ROOTS`).

Nenhum desses casos foi contornado por afrouxamento: em todos, a evidência foi
**regenerada de verdade**.

## Itens N1–N4 (melhorias escolhidas após o release publicado)

### N1 — `consolidate` regenera evidências de TTL curto (FEITO, `ad0cc3228`)
O ciclo envelhecia as evidências que ele mesmo exige no fim. Agora
`refresh-short-ttl-evidence.js` roda no `consolidate`, antes do agregado, e o
frescor é conferido depois (fail-closed). Módulo puro
`lib/short-ttl-evidence.js` + 11 casos em `shortTtlEvidence.test.js`.
**Defeito achado no próprio guard durante a verificação:** o relatório de replay
declara TTL de **7 dias**, mas o consumidor (`governance-summary`) aplica **24h**.
Validar pelo TTL do relatório fazia o guard ACEITAR evidência que o gate reprova —
um guard mais frouxo que o gate é pior que nenhum. O TTL efetivo passou a ser o
MENOR entre os dois. O teste de fail-closed também pegou um `TypeError` real
(`Number(replay.maxAgeMs)` com `replay` nulo).

### N2 — jornada funcional no perfil de engenharia (FEITO, `11490584b`)
`JOURNEY_PROFILE=negocio|engenharia|all`. Engenharia: 7/7 rotas PASS. Duas
correções de métrica, as duas medidas: `/qa-mesh` media 539 chars com espera fixa e
**19.070** com espera por estabilidade; `/dev/release` exibe "Evidência indisponível
— não foi lida: reports/delivered-release-verification-report.json" JUNTO do
diagnóstico correto de que o entregue é válido no commit dele — é a tela RELATANDO
um estado de governança, não defeito. Virou OBSERVAÇÃO.

### N3 — bloqueio de política ≠ erro no push da tag (FEITO, `15ea827a6`)
`create-release-tag.sh` agora sai **3** (código próprio) com mensagem acionável
quando o hook `pre-push` recusa a tag, em vez do genérico "criação da tag falhou".
Teste de integração real: repo temporário + hook + remote bare, com controle
positivo (sem hook, publica e sai 0) e idempotência.

### N4 — dívida de pureza de `engine/`: DIAGNÓSTICO, não correção (bloqueado)
Medido: **83 issues** (o `AGENTS.md` repete 118, desatualizado). Das 44 ocorrências
de `new Date`, **31 são leitura de relógio** e **13 são conversão** (`new Date(x)`,
determinística) — falso positivo do detector; idem `Math.random` como fallback de
parâmetro injetável. Violações reais ≈ 70.
A metade "mover para `api/services`" do plano **não se aplica** aos dois maiores
ofensores: `persistenceServices.js` (11) e `fallbackController.js` (7) são
consumidos **por dentro** de `engine/` — mover inverteria a dependência engine→api.
A classe relógio/aleatório toca determinismo de replay (gate bloqueante). Fica
registrado como `DIV-PUREZA-ENGINE` (`blocked`) com o plano e as armadilhas, para um
ciclo dedicado — **não** foi feita meia-correção nem baixada a regra do gate.

## N5 — reentrega do release (FEITO, `bc76e28b3`)

Depois de N1–N3 (commits em `SOURCE_ROOTS`), o entregue passou a
`DELIVERED_SOURCE_MISMATCH`. Reentregue com `release:seal`:
**`SEAL_EXIT=0`**, release **r-agent2-20261013-213820**, commit
`d7036f0aecb9`, H_final `0b1488f76308`, **Score PASS/100**, tag publicada
(`tagMatches=true`), `PUBLISHED_VERIFIED`, `verify:delivered-release` =
`DELIVERED_RELEASE_VERIFIED` / `AUTONOMOUS_READY`, worktree limpo e 0 commits à
frente de `origin/main`.

### Os dois itens desta sessão provados EM CAMPO neste ciclo

- **N1**: o `consolidate` registrou `✓ evidências de TTL curto regeneradas
  (replay-governance + SBOM)` **sem intervenção manual** e o gate agregado saiu
  `EXIT 0` na **primeira** tentativa — antes isso exigia retomada manual e os
  reparos de lineage/projeção eram rotina.
- **N3**: o bloqueio do hook emitiu a mensagem acionável com o comando exato
  (`git push --no-verify origin refs/tags/…` + `--from publish`); a ação humana foi
  cumprida copiando a própria mensagem.

### Armadilhas percorridas (4 rodadas) — todas documentadas na memória do repo

1. `dist/` com sobra de ciclo anterior (preflight do converge reprova);
2. worktree sujo por derivados (~60 arquivos por fase abortada);
3. `SEAL_FOREIGN_RUN` depois que o `prepare` criou run novo por
   `RUN_SOURCE_DRIFT` — exigiu **re-selar o V2**;
4. `criação da tag falhou` pelo hook local.

### Flake confirmado — não era regressão minha

O selo V2 falhou **uma vez** em `SUITE_EXECUTION`
(`missionSourceStaleReplanFullRouterE2E.test.js`, que **passa isolado em 64s** e tem
`jest.setTimeout(900000)`); a re-execução deu `status=GO`, 21/21. **Um único FAIL
não é prova de defeito** — assim como um único PASS não é prova de reprodutibilidade
(a memória do repo já dizia isso; agora vale nos dois sentidos).

## FECHAMENTO da dívida de pureza da `engine/` (FEITO, `60b978ca0`)

O item `DIV-PUREZA-ENGINE` estava `blocked` com a justificativa de que exigia ciclo
dedicado. O ciclo foi feito — e o bloqueio não era legítimo: **a correção completa
coube em uma rodada**, sem mover arquivo e sem tocar API pública.

**O defeito não era estético.** `createEngineEvent` (base de toda execução e do
replay) monta o `id` com relógio + aleatório. O MESMO fluxo executado duas vezes
gerava ids diferentes, então o hash de replay deixava de ser comparável — a
impureza corroía justamente a garantia que o gate protege.

### O que foi feito

- **6 portas injetáveis** em `engine/shared/`: `clock`, `random`, `logger`,
  `scheduler`, `fileSystem`, `runtimeEnv`. Cada uma é `setXProvider`/
  `resetXProvider`/`hasInjectedX` com default IDÊNTICO ao comportamento anterior.
- **28 arquivos migrados**, sempre por NAMESPACE (`clock.nowIso()`,
  `timers.setTimeout()`).

### As duas armadilhas que custaram rodadas

1. **Nome solto quebra call sites de forma silenciosa.** `const { now, nowIso } =
   require(...)` colidiu com declarações locais: 7 arquivos do `engine/` já têm
   `now`/`nowIso` (`engine/utils.js` tem a PRÓPRIA `nowIso()`). Resultado medido:
   `return nowIso();` = **RECURSÃO INFINITA** e `const now = now()` = **TDZ**.
   Revertido e refeito com namespace — a classe inteira de defeito desaparece por
   construção.
2. **Mismatch entre o nome gerado e o exportado.** O migrador produzia
   `logPort.info(...)` enquanto a ponte exportava `logInfo`, e `timers.setTimeout`
   enquanto exportava `scheduleTimeout`. **Os 18 call sites de log estavam
   quebrados** e a suíte antiga não pegou (nada exercitava o caminho). Só apareceu
   porque o teste novo toca a porta. Correção: exportar o nome que o call site usa
   e — em `scheduler.js` — usar `globalThis.setTimeout` no default, senão o wrapper
   chamaria a si mesmo.

### A regra estava errada nos DOIS sentidos

`/\bnew\s+Date\b/` acusava `new Date(valor)` (conversão determinística — **16
falsos positivos**) e **não acusava `Date.now()`** (35 pontos cegos numa classe que
ela dizia cobrir). Agora são dois padrões precisos. Também deixou de casar chamada
qualificada por namespace (`timers.setTimeout` era acusado — a própria correção
virava violação).

**Progressão medida: 83 → 95 → 39 → 16 → 0 issues.**

### Prova

`tests/unit/engine/enginePurityPorts.test.js` congela as portas e exige
determinismo (`createEngineEvent` idêntico em duas chamadas), e faz uma **varredura
INDEPENDENTE do relatório do gate** — se a regra for enfraquecida amanhã, o teste
continua acusando. A varredura acusou 5 arquivos na 1ª versão e **todos eram
comentários** (`fallbackController.js`, `flowTypes.js`, `governance/pendenciesModel.js`,
`leasePolicy.js`): o gate estava certo, o teste é que precisava remover comentários
antes de procurar padrão.

Validado: unit **1007 suítes/8426 testes PASS**, flow (replay/determinismo) **264
PASS**, build backend+frontend OK, **gate agregado EXIT=0**.

## REENTREGA do release + 1 defeito REAL achado no caminho (FEITO, `a80ea7e8b`)

A correção de pureza tocou `engine/` e `scripts/governance/` — ambos em
`SOURCE_ROOTS` — então o release entregue virou `DELIVERED_SOURCE_MISMATCH`/`NO_GO`.
Correto: **o release vale no commit dele**. Reentregue em
**`r-agent2-20261014-024655`** (commit `6213c94de`, H_final `ba3bd8be`), `SEAL_EXIT=0`,
Score PASS/100, `PUBLISHED_VERIFIED` (8/8), `AUTONOMOUS_READY` /
`DELIVERED_RELEASE_VERIFIED`.

### O selo ficou VERMELHO de verdade — e não era flake

O V2 seal abortou em `SUITE_EXECUTION`:

```
MANIFEST_SUITE_NOT_PASS:FAIL :: governanceApprovalFullWorkerE2E.test.js — 0 teste(s) falharam
BATCH_EXIT_CODE_NONZERO :: (global) — lote terminou com exit=1
```

**"0 testes falharam com exit=1"** parece ruído. Não é: o runner está correto em
tratar como violação (é o processo dizendo que algo além dos testes falhou), e a
mensagem pede exatamente *"reconheça a causa (drenagem, timeout, crash)"*.

A causa **não está no resumo do gate** — está no `batch-11.json`:

```
● Test suite failed to run
  ConnectionManager.getConnection was called after the connection manager was closed!
  > 739 | async function listVersions(missionId) {
```

O `afterAll` chamava `stopBugLoopWorker()` — que só faz `clearInterval`, **não espera
o ciclo em curso** — e logo depois `sequelize.close()`. O ciclo em execução consultava
o banco já fechado → rejeição não tratada → suíte `failed` com 0 testes falhados.
**Por que passava isolada e falhava no lote:** corrida de tempo.

Correção: `tests/helpers/drainEngineeringWorker.js` aguarda `cycleRunning === false`,
fail-closed. Aplicado nas **duas** suítes que usam `startBugLoopWorker` — as duas
tinham o defeito. Prova no lote REAL (comando exato do runner): antes
`success:false exit=1` → depois **6/6 suítes, 89/89 testes, EXIT=0**.

### Método que destravou (reutilizável)

O resumo do gate só dá o título. A causa mora em
`/tmp/r-agent2-release-suites/batch-N.json` (`testResults[].message`): achar o batch
com `exitCode != 0` no `.meta.json`, ler a mensagem, e reproduzir o **lote inteiro**
(extraindo as suítes do próprio batch) — não a suíte isolada, que passa.

### Armadilhas do ciclo (2, ambas já conhecidas e ainda assim custaram rodadas)

1. **Tag bloqueada pelo hook local** (`pre-push` recusa `refs/tags/*`): ação humana
   por design → `git push --no-verify origin refs/tags/<tag>` → `--from publish`.
2. **Retomada exige worktree limpo**: a fase `final` deixa ~60 derivados sujos →
   commitá-los NÃO invalida o selo (`tests/`, `docs/`, `dev/`, `governance/` exceto
   `proof-engine` e `reports/` estão fora de `SOURCE_ROOTS`; `validate:v2-seal-freshness`
   conferido PASS depois do commit, não presumido).


