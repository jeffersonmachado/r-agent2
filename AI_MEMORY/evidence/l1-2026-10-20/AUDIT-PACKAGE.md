# L-1 — Pacote de auditoria externa (o que verificar, em quanto tempo, com qual prova)

**Veredito corrente:** `CANDIDATE_GO_SUPERVISIONADO` — **não** é GO. Por regra da missão (§14), o
relatório do próprio Engenheiro solicita auditoria independente; `GO SUPERVISIONADO` só depois dela.

**Commit medido:** `486a498cb` · **Publicação do relatório:** `b9ba31a4a` · **Branch:**
`dev/engineering-hardening`

## 1. Estado do gate oficial (medido, verbatim)

`npm run validate:engineer-supervised-readiness` → `veredito=NOT_READY (exit 1)`

```
PASS QUEUE_READABLE — 130 item(ns)
PASS QUEUE_NO_OPEN_DEFECT — nenhum item aberto (pending/in_progress/failed/fixed_unverified)
FAIL QUEUE_NO_BLOCKED — 6 itens blocked_external (lista abaixo)
PASS EVIDENCE_COMMITS_EXIST — 127 commits de prova verificados no git
PASS SEGREGATION_VISIBILITY — status=PASS violations=0
PASS SEGREGATION_EXPERIENCE — status=PASS violations=0
PASS SEGREGATION_EXPERIENCE_API — status=PASS violations=0 (leaks 0/0/0)
PASS READINESS_DOC_PRESENT / READINESS_DOC_SECTIONS
FAIL HUMAN_APPROVAL_PRESENT — sem assinatura humana em
     AI_MEMORY/evidence/engineer-supervised-approval.json
```

**Duas condições abertas, ambas fora da autoridade do agente.**

## 2. Condição 1 — 6 itens `blocked_external` (todos de plataforma, não da cadeia do Engenheiro)

| Item | O que trava |
|---|---|
| `H15-DIST-RECIBO-STALE` | higiene do `dist/`: recibo STALE do verifier polui a avaliação |
| `H19-DIST-CAUSA-UNICA` | `validate:dist` reduzido a causa única (payload ausente) |
| `MISSAO-B9-CI-GITHUB-ACTIONS` | CI do GitHub bloqueado por budget; `release-governance.yml` não protege publicação |
| `H20-CADEIA-POS-CERTIFICACAO-DIVERGENTE` | cadeia de governança diverge do conteúdo atual e projeções divergem |
| `P1-PROJECAO-FINAL-DIVERGE-DA-CANONICA-DE-RUN-ABANDONADO` | projeções de status gravadas antes da decisão final |
| `P1-AGREGADO-SEM-IDENTIDADE-DE-RUN-BLOQUEIA-L3` | gate agregado para em fail-closed sem identidade de run |

**Achado de consistência (importante):** `ENGINEER_SUPERVISED_READINESS.md` §14.6 afirma que o gate
passa com os itens "resolvidos **ou aceitos explicitamente como risco pelo dono**". O código **não
implementa** esse aceite: `scripts/governance/validate-engineer-supervised-readiness.js` exige
`impedidos.length === 0` (`QUEUE_NO_BLOCKED`). Ou seja, hoje o único caminho é **resolver** os 6 —
todos de escopo de plataforma, que a própria missão declara não serem requisito de L-1.

Decisão necessária do dono (uma das duas):

- **A) manter o gate estrito** → L-1 fica bloqueado por itens de plataforma até que sejam resolvidos;
- **B) autorizar a implementação do aceite documentado** — mecanismo explícito, por item, exigindo
  ator humano, motivo escrito e escopo, com registro auditável e o relatório listando cada item
  aceito (nunca em silêncio). Isso alinha código e documento; não desliga o gate.

Não implementei B por conta própria: aceitar risco de plataforma é decisão do dono, e mudar um gate
sem autorização explícita seria exatamente o que a missão proíbe.

## 3. Condição 2 — assinatura humana (template, **não assinado**)

Arquivo exigido: `AI_MEMORY/evidence/engineer-supervised-approval.json`

```json
{
  "approver": "<nome ou identificador do humano>",
  "approvedAt": "<ISO-8601>",
  "missionId": "<id da missão de ensaio>",
  "scope": "ENGINEER_SUPERVISED_READY_GO",
  "statement": "<o que está sendo aprovado, em texto próprio>",
  "simulated": false
}
```

Não criei este arquivo. Assinatura de terceiro, gerada pelo agente, seria falsificação de aprovação.

## 4. O que o auditor deve verificar (comandos e resultado esperado)

```bash
git fetch origin && git log -1 --format=%H          # b9ba31a4a (relatório) / 486a498cb (medição)
npx jest tests/unit --maxWorkers=4                  # exit 0 · 1087 suítes / 9218 testes
npx jest "tests/integration/engineering" tests/contracts/engineeringCoderReviewerService.test.js \
       --bail=0 --maxWorkers=2                      # exit 0 · 41 suítes / 226 testes
node scripts/governance/collect-engineering-router-runtime-evidence.js   # RUNTIME_PASS 25/25
node scripts/governance/validate-engineering-router-v1.js --runtime      # PASS 209 checks
npm run validate:bug-closure-status                  # PASS 9/9 entrypoints
npm run validate:hardening-queue                     # PASS
npm run validate:engineer-supervised-readiness       # NOT_READY até as duas condições acima
```

Reprodução da janela congelada (procedimento completo): `CERTIFICATION-WINDOW.md`.

## 5. Provas versionadas e integridade

| Arquivo | SHA-256 (prefixo) |
|---|---|
| `certificacao-snapshots.txt` | `6ec1238c68167700` |
| `certificacao-coletor.log` | `e88266395f498002` |
| `certificacao-gate-runtime.log` | `e8be88a370e15be6` |
| `certificacao-resumos.txt` | `64816c7ae329fdac` |
| `CERTIFICATION-BLOCKER.md` | `fd5f034757fc68c5` |
| `CERTIFICATION-WINDOW.md` | `dea1ceb2c4c7a6e0` |

Conferir com `sha256sum AI_MEMORY/evidence/l1-2026-10-20/*`. Divergência = conteúdo alterado após
a publicação deste pacote.

## 6. O que está declarado como NÃO feito (sem maquiagem)

- gate agregado de governança (`BLOCKED_EXTERNAL`, condição 1);
- selo/release e publicação de tag (proibidos pela missão; `publish-tag` exige `DELIVERED_VERIFIED`
  + `confirm:true`);
- validação de segregação em **browser real** nesta janela (os três gates de segregação são
  estáticos e passam com 0 violações);
- certificação do contrato EVO (fora do escopo explícito de L-1).

---

## 6. Atualização 2026-10-21 (ciclo de CI) — auditoria externa continua PENDENTE

**Veredito:** `NOT_READY` / `PENDING_HUMAN_APPROVAL` (exit 1). **Auditoria independente: `AUDIT_PENDING`.**

### 6.1 O que mudou desde a publicação anterior

8 causas-raiz de AMBIENTE do CI foram corrigidas com prova de execução (tabela §15.1 de
`ENGINEER_SUPERVISED_READINESS.md`): units hermeticas, prazo de infraestrutura, resolucao de
`origin/main`, Postgres+Redis no job L0, artefatos governados gerados, preflight de TTL fail-closed,
imagem do Execution Sandbox construida no job e log do passo publicado no artefato.

Commits medidos: `ac92a70ab`, `2c36f3d1d`, `20abca31c`, `0fbb744d6`, `d987a1ecb`, `40ca9ea98`,
`c087dd40a`, `70a24552a`, `704150648`.

### 6.2 O que o auditor deve verificar primeiro (nesta ordem)

1. `.github/workflows/dev-branch-ci.yml` — os passos novos (infra, migrações, geradores, prova de
   artefato, build do sandbox). Nenhum deles pula teste: ou o teste EXECUTA, ou o passo falha.
2. `tests/helpers/infraGate.js` (`comPrazo`) e `tests/unit/helpers/infraGatePrazo.test.js` —
   a garantia de que prazo estourado vira `NOT_EXECUTED` em dev e `INFRA_ERROR` em
   release-authoritative, nunca PASS.
3. `api/services/engineeringMission/missionSourceService.js#readMainCommit` +
   `tests/unit/engineeringMissionSourceRefRemote.test.js` — resolução de ref com precedência local e
   fail-closed quando o commit não existe em nenhuma forma.
4. `tests/unit/dev/{devServicesSupervision,apiServiceUnit}.test.js` — verificação hermética das
   units (o critério continua estrito: nenhuma linha do systemd pode citar a unit).
5. `tests/unit/governance/discoveredBlockerGuards.test.js` — asserção estado-dependente do preflight
   de TTL (com evidência exige `OK/STALE`; sem evidência exige `UNAVAILABLE`).

### 6.3 Limite honesto deste ciclo

O CI **continua vermelho** e a causa está medida: em clone limpo, 13 suítes / 35 testes dependem de
ambiente populado (`reports/` gerados, `.env`, evidência de smoke real). Resolver exige decisão
humana entre popular o ambiente no CI (A) ou declarar auditavelmente as suítes não executáveis em
clone limpo (B) — §15.2 do relatório. O item `L1-NPM-TEST-CI-VERMELHO` está `blocked` na fila com a
decisão nomeada. **Nenhum gate foi afrouxado para produzir verde.**

### 6.4 Solicitação formal

`AI_MEMORY/evidence/engineer-supervised-approval-request.json` — três decisões separadas
(auditoria independente, riscos não dispensáveis, CI/clone limpo), riscos residuais por classe e
critérios de cancelamento. `engineer-supervised-approval.json` **não existe**: aprovação é ato
humano com assinatura Ed25519 verificável.

## 4. Ciclo CI DEFINITIVO (2026-10-21/22) — o que um auditor independente deve conseguir repetir

**Comando único (versionado):**

```bash
npm ci
npm run ci:clean-checkout -- --scenario clean --gate-phases A,B,C,D --with-integration
```

O comando clona o commit exato em `/tmp`, recusa resíduo, provisiona Postgres/Redis/RAG/runner e
containers do próprio run, executa `ci:bootstrap`, o produtor prod-like (Chromium) e o gate.
Relatório: `reports/ci-clean-checkout-report.json`; resumo versionado:
`AI_MEMORY/evidence/ci-clean-checkout-<sha>/clean/RESULT.md`.

### 4.1 O que verificar (ordem de menor para maior custo)

1. **Que o clone é limpo**: o passo `clone-limpo` no RESULT.md só passa se `git status --ignored`
   estiver vazio e não houver `.env`, `dist/`, `node_modules` nem `api/data/config.json`.
2. **Que os gates de IA são verdes em clone** — `validate:ai-memory` e `validate-agent-adherence`
   reprovavam em QUALQUER checkout antes de `c4b3fc70e` porque
   `.github/copilot-instructions.md` não era versionado.
3. **Que o L1 tem 4 verdes / 3 vermelhos** (inventário no RESULT.md). Os três vermelhos
   (`cadeia-criptografica`, `self-proving`, `decisao-canonica`) são a família de certificação de
   release e exigem `npm run release:seal` em `main` — proibido nesta missão.
4. **Que nada foi reclassificado**: `governance/risk-routing/l1-scope-routing.json` mantém
   `L1-NPM-TEST-CI-VERMELHO` como `L1_BLOCKING`; `ENGINEER_SUPERVISED_READINESS.md` §16 não declara
   CI verde.

### 4.2 Cenários negativos (prova de que "verde" não é vacuidade)

`--scenario missing-artifact` (artefato ausente REPROVA o consumidor e o produtor regenera),
`--scenario corrupt-artifact`, `--scenario bootstrap-twice` (idempotência do seed),
`--scenario l0-full` (a seleção oficial inteira com `--bail=0`), `--scenario db-unavailable` e
`--scenario docker-unavailable` (falha fechada, nunca PASS).

### 4.3 Limites declarados deste ciclo

- GitHub Actions (run **39722271457**, commit `321d2aae6`, node 20.20.2): prod-like-smoke SUCCESS,
  dev-branch-integration SUCCESS, `L0` exit 0 em 451,8 s, `L0b` exit 0 em 472,6 s,
  `L1-cadeia-criptografica` exit 1 → veredito `FAIL (completo=false)`. O CI **não** está verde; o
  que mudou é que agora o único vermelho é a família de certificação de release — o mesmo padrão
  do checkout limpo local. `CI_PASS` continua NÃO alcançado.
- Auditoria independente: `AUDIT_PENDING`. O executor revisou o próprio trabalho.
- Aprovação humana: ausente (`AI_MEMORY/evidence/engineer-supervised-approval.json` não existe).
