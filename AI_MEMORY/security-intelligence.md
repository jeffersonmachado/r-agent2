# AI_MEMORY — Security Intelligence (versões e vulnerabilidades)

Módulo canônico: `docs/architecture/SECURITY_INTELLIGENCE.md`. Este arquivo é o resumo
operacional; não duplica o doc.

## O que existe (medido, não aspiracional)

- **Inventário real** de componentes/versões em `security_components` (+ histórico em
  `security_component_versions`), coletado por `npm run security:discover`.
  Classes: `DECLARED` / `RESOLVED` / `BUILT` / `RUNNING` — só `RUNNING` diz o que
  executa. Não existe mais "declarado = instalado": `express` está declarado
  `^4.22.1` e resolvido `5.2.1`.
- **SBOM CycloneDX 1.5** determinístico (`npm run security:sbom`), validado antes de
  ser aceito como snapshot; sha256 do documento identifica o snapshot (idempotente).
- **Vulnerabilidades**: `osvConnector` é o ÚNICO ponto com egress de rede;
  `vulnerabilityScanService` correlaciona OFFLINE contra o banco. Resultados em
  `security_findings` + histórico em `security_finding_events`.
  Medido 2026-10-08 (ESCOPO PARCIAL — só dependências **diretas**): 83 pacotes
  (64 npm + 19 PyPI) → **298 advisories**, 284 com EPSS, 1 KEV; 1653 componentes
  varridos → **81 achados com risco** + 312 avaliações VEX; gate **NO_GO com 21
  bloqueios de runtime**.

  Medido 2026-10-08 (ESCOPO COMPLETO — **1125 pacotes instalados**, incluindo
  transitivos; base de 654 advisories): **248 achados com risco** (3 CRITICAL, 118
  HIGH, 108 MEDIUM, 10 LOW, 9 INFORMATIONAL) + **843 avaliações VEX**; plano de
  correção com **108 candidatos** (39 `DIRECT_BUMP`, 60 `TRANSITIVE_OVERRIDE`, 9
  `NO_PATCH`; 79 Nível B, 29 Nível C); gate **NO_GO com 47 bloqueios de runtime e
  131 avisos** (exit 1). O sweep levou 374 s a 5 req/s, com **0 falhas**.

  **Lição medida (não repetir):** correlação com base só de dependências DIRETAS
  subestimou o risco em ~4x (21 → 47 bloqueios). Cobertura parcial não é
  "menos risco", é **menos conhecimento** — a cobertura precisa ser declarada
  junto do número, nunca omitida.
- **Release Security Gate** (`npm run validate:security-release-gate`): decide
  GO/NO_GO com exit code real (NO_GO ⇒ exit 1; `SECURITY_GATE_MODE=advisory` ⇒ exit 0
  mantendo a decisão real no relatório). Estado medido: **NO_GO** — com a base
  parcial eram 21 bloqueios de runtime (`transformers@4.57.6`, `nodemailer@8.0.7`,
  `torch@2.9.1+cpu`, `uuid`, `ws@8.20.0`, `postcss@8.4.49`,
  `@modelcontextprotocol/sdk@1.30.0`); com a base completa são **47 bloqueios de
  runtime** (`@modelcontextprotocol/sdk`, `brace-expansion`, `braces`,
  `extract-zip` entre os primeiros) e 131 avisos dev-only.
- **Dossiê e fila de triagem** (`node scripts/security-intel.js triage`, `GET /api/security-intel/triage`
  e a seção na UI — todos pelo MESMO `api/services/securityIntel/triageService.js`):
  saída `reports/security-intel-triage.json` + `.md`. Três buckets: missão isolada
  (Nível B), exige aprovação humana (Nível C) e **sem correção publicada**
  (controle compensatório ou waiver com prazo). Não decide nada — e um agrupamento
  sem correção publicada NUNCA cai no bucket automático, por menor que seja a
  severidade. Ordenação por KEV, bucket e **impacto medido no gate**. Medido
  2026-10-09: **28 pacotes na fila** (19 isolados, 4 exigem aprovação, 5 sem
  correção), **16 de 16** pacotes bloqueadores cobertos e as duas medidas
  independentes concordando (47 achados endereçados = 47 bloqueios do gate).
- **Waiver de risco** (`security_waivers` + `api/services/securityIntel/waiverService.js`,
  CLI `waivers|waive|revoke`): aceitação FORMAL e TEMPORÁRIA por humano identificado.
  Regras duras: expiração obrigatória e futura, prazo ≤ `releaseGate.maxWaiverDays`
  (90), motivo com substância, aprovador identificado, e recusa de isenção para
  achado que NÃO é risco aberto (VEX `NOT_AFFECTED`/`FALSE_POSITIVE` ou resolvido).
  Revogar não apaga (histórico). **Nada está isentado hoje**: a tabela nasce vazia.
  O gate consome os waivers VIGENTES (`waiversForGate`) e revalida a expiração.
- **Índice vetorial** (`npm run security:vector-index`): veredito DEGRADED por
  `vector 0.6.0` < mínimo recomendado; índice HNSW VÁLIDO e em uso.
- **Worker contínuo** (`securityIntelWorker`, registrado em `api/runtime/startWorkers.js`):
  ciclo de 6h (`SECURITY_INTEL_WORKER_INTERVAL_MS`, desligável com
  `ENABLE_SECURITY_INTEL_WORKER=false`) que mantém correlação e plano frescos
  SEM tocar a rede — o egress de sincronização é opt-in
  (`SECURITY_INTEL_SYNC_ADVISORIES=1`, só quando a base está vencida). Ciclo real
  medido: 723 ms. Cadeia de `setTimeout`, nunca `setInterval`. Saúde
  UP/DEGRADED/DOWN visível; parado nunca parece saudável.
- **Patch Engine** (`npm run security:patches`): planeja a correção (menor versão
  corrigida acima da instalada; semântica PATCH/MINOR/MAJOR; Nível B automático em
  ambiente isolado, Nível C exige autorização explícita) e consolida por pacote.
  `patch-mission --candidate <key>` submete a missão ao Roteador Engenheiro —
  NUNCA aplica. A identidade de quem autoriza/aceita risco é **derivada**, nunca
  declarada: no CLI é o usuário do SO que executa o comando (ver
  `resolveCliApprover`), na API é o ator autenticado com permissão por ação
  (`security_intel:waiver_approve|waiver_revoke|patch_mission` — ver
  `api/modules/security-intel/approvalAuthority.js`). Estado medido: dos 21 bloqueios, 16 exigem autorização;
  `transformers` (CRITICAL) e `torch` **NÃO são limpáveis por bump** (4 e 1
  advisories sem versão corrigida) ⇒ controle compensatório ou waiver formal com
  expiração.
- Comandos: `security:discover|sbom|inventory|status|vector-index|patches` e
  `node scripts/security-intel.js advisories|scan|patch-mission`.

## Regras que NÃO podem ser relaxadas

1. Versão/faixa não comparável ⇒ `null` (DESCONHECIDO). Nunca "não afetado".
2. Falha de fonte (OSV/KEV/EPSS) ⇒ `failures` + base `DEGRADED`. Falha nunca é
   silenciada como "sem vulnerabilidades". Base vencida é reportada como vencida.
3. Probe ausente ⇒ `unavailable` explícito, nunca componente inventado.
4. Duas cópias físicas do mesmo pacote NÃO são colapsadas; identidade contraditória
   levanta conflito.
5. Estado é Postgres. Nada de JSON como estado (`audit:json-persistence` verde).
6. `MITIGATED` exige waiver vigente; o motor nunca cria waiver.

## Armadilhas medidas (não repetir)

- **CVSS publicado como VETOR** (`CVSS:3.1/AV:N/...`, padrão do GitHub Advisory
  Database) NÃO pode ser ignorado: sem converter para score, todo achado cai na
  severidade assumida (MEDIUM) e um CRITICAL/HIGH **não bloqueia o gate**. Use
  `engine/securityIntel/cvss.js` (`baseScore`, spec FIRST). Vetor inválido devolve
  `null` — nunca score inventado, porque score inventado é decisão de gate inventada.
- **Ecossistema no OSV é case-sensitive**: `PyPI` (não `pypi`). A tradução vive na
  fronteira do conector; ecossistema não mapeado falha ANTES da rede.
- **Número de achados sem o ESCOPO declarado é enganoso** (medido 2026-10-08):
  consultar advisories só das dependências DIRETAS (83 pacotes) deu 81 achados e 21
  bloqueios; consultar os 1125 pacotes INSTALADOS deu **248 achados e 47 bloqueios**.
  Cobertura parcial não é "menos risco", é menos conhecimento. Sempre rode o sweep
  com `--scope installed` e reporte o escopo junto do número.
- **Priorize por exposição real**: dev-only é aviso, não bloqueio
  (`releaseGate.blockOnDevDependencies`). Sem isso o gate vira ruído e o time aprende a
  ignorá-lo.
- O auditor `governance/json-persistence-audit.js` classifica junção de caminho com
  último segmento `.json` como alvo de **escrita** quando não é argumento direto de um
  leitor. Em módulo LEITOR, passe o nome do arquivo como parâmetro — e não escreva o
  literal dentro de comentário (o scanner lê comentário como código: gerou
  `UNKNOWN_JSON_WRITE_TARGET` com o alvo literalmente `algo.json`).
- **Escrita parcial vira isenção sem auditoria** (medido 2026-10-08 numa prova
  end-to-end): a criação de waiver não era transacional e, quando a gravação do
  EVENTO falhou, o waiver e o vínculo no achado permaneceram — ficaram 2 waivers
  vigentes com 1 evento. Hoje `requestWaiver` (registro + evento) e `approveWaiver`
  (transição + mitigação + evento) rodam cada um em transação, tudo ou nada.
  Regra geral: **isenção de risco é um ato com trilha ou não é nada** — nunca grave
  o efeito antes da evidência.
- **Isentar é DECISÃO DUPLA** (endurecido 2026-10-10): `waive` SOLICITA
  (`PENDING_APPROVAL`, nada é mitigado) e `waive-approve` APROVA — por OUTRO
  ator (`waiver_self_approval_forbidden`). A aprovação ainda valida o
  `scope_hash` do escopo pedido, usa CAS `PENDING_APPROVAL → ACTIVE` (concorrência
  e replay perdem a corrida) e exige identidade derivada (nunca declarada) mais a
  permissão `security_intel:waiver_approve`.
- `resetMocks: true` no `jest.config.cjs` apaga implementações: reestabeleça mocks no
  `beforeEach`.
- **Testar o worker exige cuidado com o harness do repo** (`tests/setup.js`):
  - o `Promise.all` é MONKEY-PATCHED com um `.finally()` derivado — rejeição JÁ
    TRATADA vira unhandled rejection e falha o teste com o erro original. Para
    testar o caminho de erro, prefira rota/função com `await` único;
  - o `afterEach` global aguarda um `setTimeout` REAL: com timers falsos ele trava
    até o timeout. Restaure `jest.useRealTimers()` no CORPO do teste (a ordem dos
    `afterEach` não é garantia), antes do hook global;
  - o callback do agendamento do worker é `() => tick(...)` e devolve a promise do
    ciclo: avançar timers falsos AGUARDA essa promise e trava enquanto o ciclo está
    pendente (o cenário exato de "sem sobreposição"). Esse teste usa tempo real com
    espera ativa (`waitFor`), não timers falsos.
- Alterar `package.json` neste worktree exige staging por hunk: há WIP de outro agente
  removendo ~30 scripts no mesmo arquivo.
- `RELEASE_SIGNING_KEY`/probes de serviço: rodar `security:*` carrega `.env` pela CLI;
  sem `.env` os probes de Postgres/Redis retornam indisponibilidade (comportamento
  correto, não bug).

## Pendências (ordem de valor)

1. **Triagem dos achados** (decisão humana). No escopo completo são **248 achados**
   (121 de severidade bloqueante; 47 bloqueios de runtime no gate) e **108 candidatos
   de patch**, consolidados em **28 pacotes**: 19 isolados (Nível B), 4 exigem
   aprovação (Nível C) e 5 sem correção publicada. A fila com motivo e comando por
   pacote está em `reports/security-intel-triage.md` (`node scripts/security-intel.js triage`).
   Waiver **existe** desde 2026-10-08, mas **nada está isentado**: a tabela está
   vazia e só um humano identificado isenta, com prazo.
2. Registrar o Release Security Gate em `validate:governance-enforcement` — só
   DEPOIS de triar (hoje o registro bloquearia o release; decisão do dono).
3. Agendamento do sweep `--scope installed` (hoje é manual; o worker NÃO sincroniza
   base por padrão — egress é opt-in).
4. pgvector: check de integridade já existe; falta planejar 0.6.0 → 0.8.x com
   regressão de ranking híbrido.
5. Regressão de ranking híbrido pós-atualização de extensão (vetorial + lexical +
   RRF + filtros multi-tenant).

**Baseline pré-upgrade do pgvector (2026-10-09):**
`AI_MEMORY/evidence/security-intel/pgvector-upgrade-baseline-2026-10-09.json` —
0.6.0, PostgreSQL 16.15, 384 dimensões medidas, HNSW válido/pronto/vivo com planner
usando o índice, 8460 chunks com 0 nulos e 0 dimensões erradas, e a regressão de
ranking híbrido (com isolamento multi-tenant **contra o banco real**) em
**20 passed / 0 skipped / 0 failed** (26 s). Armadilha medida: os 4 testes de
isolamento são PULADOS sem `DATABASE_URL` no ambiente do pytest — rode com o `.env`
carregado (`set -a && . ../.env && set +a`), senão a "regressão verde" é meia prova.
Critério: qualquer `failed`, `passed` < 20, skip novo por ambiente ou mudança em
qualquer eixo do índice ⇒ upgrade NÃO validado.

**Já entregue:** inventário (Fase 1), SBOM, advisories + correlação (Fase 2), Risk
Engine (Fase 3), Patch Engine + ponte com o Roteador (Fase 4), Release Security Gate
com exit real (Fase 5), worker contínuo (Fase 7), check de índice vetorial (Fase 8),
APIs DEVELOPMENT + UI de engenharia (Fase 6), sweep de cobertura completa (Fase 9a),
testes de falha/resiliência (Fase 9b: ciclos nunca se sobrepõem, erro de ciclo
capturado, DEGRADED com recuperação, restart limpo, sync parcial não memorizado) e
**waivers auditáveis com expiração** (prova end-to-end: vigente ⇒ `MITIGATED`, gate
segue com 47 bloqueios; revogado ⇒ volta a risco aberto).

## Defeito medido na tela (2026-10-08) — corte silencioso escondia decisões

A jornada real no browser (`/dev/security-intel`) mediu o que o código prometia:
com **1091 achados abertos**, o seletor de achado da seção de waivers oferecia 50 e a
API devolvia no máximo 100 → **4 dos 35** achados de decisão humana eram selecionáveis.
Os 31 restantes (nodemailer inteiro, uuid, basic-ftp, pytest, torch, sprintf-js, braces,
extract-zip, maior parte de transformers) só existiam pela CLI: a tela *parecia* completa
porque o corte era silencioso (`slice(0, 50)`).

Correção: a seleção é derivada da **fila** por `frontend/src/shared/securityIntel/waiverOptions.js`
(módulo puro, testado): bucket de decisão **sempre completo** (mesmo se a API cortar),
filtro que **nunca** remove achado de decisão, e limite da API **declarado** na tela
("500 de 1091 carregados"). Corte de exibição (inventário 25, fila 40) passou a ser dito.
Verificado no browser: **35/35** alcançáveis, filtro preserva as decisões, 0 erros de console.

Regra que fica: contagem exibida e contagem real precisam concordar ou o número precisa
estar na tela. Truncamento silencioso em superfície de decisão é defeito, não detalhe de UI.

## Defeito medido no painel (2026-10-08) — KPI, tabela e filtro contavam coisas diferentes

Medido no browser, no MESMO painel: a tabela dizia "1091 achados abertos" e o KPI dizia
"248 achados abertos (risco)". A diferença (843) já estava **descartada por VEX**
(`NOT_AFFECTED`/`FALSE_POSITIVE`) e continuava contada como aberta. Pior no KEV: o filtro
"Somente KEV" devolvia 4 achados (todos `INFORMATIONAL`, todos descartados por VEX) enquanto
o KPI dizia 0 — sem como saber qual número valia.

O gate sempre leu risco (exclui VEX); a listagem não. Correção: `VEX_EXCLUDED_STATUSES` é a
definição ÚNICA, usada pelo resumo (`open`/`kevOpen`) e pelo novo filtro `riskOnly` da
listagem; a tela passa `riskOnly=true` por padrão, declara os dois números e mantém os
descartados auditáveis por toggle ("Incluir descartados por VEX"). Regressão:
`tests/unit/securityIntel/findingsRiskOnly.test.js` (7 casos, inclui "o resumo e o filtro usam
a MESMA instância da lista").

Regra que fica: dois números sobre o mesmo assunto no mesmo painel precisam de UMA definição
compartilhada ou de rótulos que digam qual definição estão usando. "Aberto" sem qualificar
(risco? registro?) é ambíguo e já produziu leitura errada de 4× o risco real.

## Defeito medido no histórico (2026-10-08) — evento sem DATA

O painel de histórico de um achado exibia "— — Correção disponível · systemadmin". Causa: o
serviço devolvia a linha crua do ORM, e o modelo (`timestamps` + `underscored`) expõe o
carimbo como `createdAt` — a tela lia `created_at`. Data vazia num recurso cujo propósito é
responder "quando apareceu, quem aceitou e por quê".

Correção: `getFindingTimeline` normaliza e expõe `at` (ISO) explicitamente, `null` quando não
há carimbo (nunca data inventada); a tela lê `at`. Regressão: 2 casos em
`findingsRiskOnly.test.js` (com createdAt → `at` preenchido; sem carimbo → `at: null`).
Verificado no browser: "08/10/2026, 20:37:41 — Correção disponível · systemadmin".

Regra que fica: nome de campo do ORM não pode vazar para a tela. Ao expor linha de modelo,
normalize o carimbo de tempo num campo próprio e teste — `formatDate(x)` que devolve "—" é
falha silenciosa, não estado vazio legítimo. Varredura da classe: na tela sobrou só
`row.expires_at` (declarado no modelo de waiver).

## Caminho de execução: 3 bloqueios reais medidos (2026-10-09)

Executar a primeira missão de correção de verdade (fast-uri) revelou uma cadeia de bloqueios que
nenhum teste pegava — todos corrigidos e commitados (`b1eb87bee`, `a8a2881a4`):

1. **HTTP 500 `22001` ao clicar Executar**: `engineering_tasks.title` é varchar(255) e o
   orquestrador punha ali o objetivo INTEIRO da missão (`objective` é `text`). Missão manual tem
   objetivo curto e passava; a de segurança estourava e morria ANTES de começar. Fix: título =
   rótulo limitado (`buildTaskContract`/`taskTitleOf`).
2. **`NO_PATCH_SCOPE` em todo patch**: sem `allowedPaths` o Roteador recusa QUALQUER patch
   (ER-V1-FINAL-003 — vazio nunca é "tudo"). O coder acertava o patch e ele era barrado.
   Fix: `dependencyScopeOf` + caminhos proibidos (governança/gates/roteamento/segredos) com
   regressão no `checkPathBoundary` real.
3. **O compilador descarta `allowedPaths` do criador** (`previousSpec ? … : []`): declarar nas
   opções não bastava. Fix: o escopo entra como NOVA VERSÃO do spec pelo caminho "Editar e
   aprovar" com `approveEdited: false` (aplicar escopo nunca aprova; a decisão humana segue
   obrigatória).

Depois dos três, a missão `undici` produziu **duas tentativas com patch válido** (`ok=true`,
`APPLIED`) e avançou para `TESTING`. O que a reprova agora é a **suíte do serviço**, que precisa
estar verde para o aceite ("suíte do serviço consumidor verde").

## Falso verde na suíte: `process.exit(0)` mata o Jest

`tests/unit/governance/pruneTestMissionFkCoverage.test.js` faz `require` de um script CLI; sem o
guard `if (require.main === module)` o `require` roda `main()` (que apaga dados de DEV) e chama
`process.exit(0)`: o Jest **morre no meio**, sai **sem** a linha `Test Suites:` e o comando
termina com **código 0** mesmo com 13 suítes FAILED. Medido em 2026-10-09 no `--bail=0`
(`EXIT=0`, 13 `FAIL` no log).

Regra: ao medir "suíte verde", exigir a linha `Test Suites:` no final e desconfiar de `EXIT=0`
sem resumo. Script CLI requerido por teste precisa do guard.

## Aceite da missão: era INSATISFAZÍVEL no ambiente em que roda (2026-10-09)

Duas causas independentes, as duas medidas:

1. **O worktree isolado não herda ESTADO.** `.env`, `api/data` e `reports` são ignorados/untracked,
   então a suíte do serviço reprova ali **com a árvore limpa** (sem patch nenhum).
2. **O deadline de UM comando de teste é 120 s** (política `INTEGRATION_TEST`), e
   `npm run test:unit` leva ~9 min. Exigi-la era pedir o impossível.

Consequência: missões com patch **válido** (`valid=true`) morriam em `TESTING`; o histórico do
repo era **1 GREEN em 75 aprovações**. Não era qualidade de patch — era o aceite.

Correção (decisão do dono, duas partes):
- **(1) Semear o estado** no worktree: `patchApplyService.seedWorkspaceState` copia `.env`,
  `api/data` e `reports`. **Cópia, nunca symlink** (symlink gravável para o repo real é o defeito
  ER-V1-FINAL-001). Falha ao semear NÃO derruba a materialização (semear é pré-requisito do
  aceite, não do patch).
- **(2) Aceite escopado**: prova MECÂNICA do alvo (o pacote resolvido tem versão >= alvo —
  comando real validado: `fast-uri 3.1.0 < 3.1.7` → exit 1 "ALVO NAO APLICADO") + comando
  funcional que cabe no deadline (`npm run test:flow`: 30 suítes / 264 testes / **40 s no
  workspace isolado**).

O que NÃO muda: suíte completa e gates de selo/release continuam obrigatórios no pipeline
(`validate:governance-enforcement`, `test:unit` humano/CI). O fechamento do ACHADO quem mede é o
Release Security Gate (re-scan), não a missão. Limitação declarada: o frontend não tem suíte
executável no workspace isolado (`frontend/node_modules` ausente; symlink gravável proibido).
