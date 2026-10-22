# MISSÃO P0 — BLINDAGEM DO BUG CLOSURE FIRST

**Baseline:** `0023634244ad05b3e2a01a61987a244c30ea75b2`
**Branch local (isolada):** `mission/p0-bug-closure-20261022` em `/tmp/p0-bugclosure`
**Publicação:** nenhuma (sem push, sem merge, sem tag, sem release, sem SELO_FINAL real).
**Veredito do executor:** ver §9 (depende do parecer independente em `parecer-reviewer.md`).

---

## 1. Causa-raiz

A autoridade de "defeito fechado" era o **campo persistido** `state` de
`AI_MEMORY/hardening-queue.json`. `eBloqueanteParaCertificacao`
(`governance/bug-closure/defect-states.js`) tratava `VERIFIED`, `RESOLVED` e `RISK_ACCEPTED`
como fechados **por valor de enum**, sem exigir nenhuma prova. Duas consequências:

1. **Qualquer processo com escrita no arquivo** (agente, script ad-hoc, editor) fechava um
   P0/P1 mudando uma string. Não havia transição registrada, teste executado nem SHA avaliado.
2. **`status` legado também fechava**: `migrarItem` (`defect-registry.js`) traduz
   `status: "prevention_active"` → `RESOLVED` (`MIGRACAO_LEGADO`), então nem era necessário
   escrever `state`.

## 2. Caminho original do bypass (reproduzido)

`AI_MEMORY/evidence/p0-bug-closure-2026-10-22/reproducao-bypass.txt` (script:
`reproducao-bypass.js`), executado contra os módulos da **baseline** carregados via
`git show 002363424:governance/bug-closure/*.js`:

```text
01-p1-aberto:      decision=DENIED  allowed=false codes=P1_BLOQUEANTE_ABERTO
02-json-editado:   decision=ALLOWED allowed=true  codes=
03-so-status-legado: decision=ALLOWED allowed=true codes=
BYPASS_REPRODUZIDO = true
BYPASS_POR_STATUS_LEGADO = true
```

- arquivo da decisão: `governance/bug-closure/eligibility.js` (`negado` derivado de
  `bloquearP0 || bloquearP1 || condicionalPendente || ...`) alimentado por
  `classificarDefeitos` → `eBloqueanteParaCertificacao`;
- estado anterior `FIX_IN_PROGRESS`/`OPEN`; posterior `RESOLVED`;
- exit code da avaliação: operação **autorizada** (`allowed: true`);
- nenhum teste de correção foi executado (o cenário não roda nada além do parser).

## 3. Arquitetura — antes e depois

**Antes (1 camada):** `state` (JSON) → `eBloqueanteParaCertificacao` → elegibilidade.

**Depois (2 camadas + âncora):**

- **Camada A — estado operacional** (`defect-states.js`, inalterado): máquina de estados e
  transições permitidas continuam sendo a autoridade sobre "para onde posso ir".
- **Camada B — prova de fechamento** (`closure-proof.js`): documento verificável que amarra
  o fechamento ao **SHA atual**, **sourceFingerprint**, **testes exigidos executados com
  exit 0**, **hashes dos artefatos**, **livro de transições** e **assinatura Ed25519 de
  autoridade registrada**.
- **Livro** (`transition-ledger.js`): JSONL append-only com hash chain (`prevHash`/`hash`),
  `seq` monotônica, recusa `transitionId` repetido (replay) e detecta reordenação/edição.
- **Serviço** (`transition-service.js`): única API legítima de transição; lock exclusivo,
  escrita atômica (tmp + rename), concorrência otimista por estado esperado.
- **Consistência** (`authority-consistency.js`): inventário × livro (defeito apagado) e
  inventário × roteamento (rota removida).

Invariante implementado: **`state=RESOLVED` isolado não concede elegibilidade.** Sem prova
válida o item vira `fechamentoNaoProvado`, `stateEfetivo = OPEN`, e toda operação
**certificante** é NEGADA com `FECHAMENTO_SEM_PROVA_VALIDA`.

## 4. Arquivos e linhas modificados

| Arquivo | Natureza | Linhas |
|---|---|---|
| `governance/bug-closure/closure-proof.js` | novo (prova + âncora) | 500 |
| `governance/bug-closure/trusted-authorities.js` | novo (pin de chave + âncora externa; 2ª passada) | 85 |
| `governance/bug-closure/transition-ledger.js` | novo (livro append-only) | 170 |
| `governance/bug-closure/transition-service.js` | novo (API autoritativa) | 215 |
| `governance/bug-closure/authority-consistency.js` | novo (inventário × livro × rota) | 130 |
| `governance/bug-closure/defect-registry.js` | alterado (`stateEfetivo`, `provaDeFechamento`, contexto) | +121/−8 |
| `governance/bug-closure/eligibility.js` | alterado (bucket `fechamentoNaoProvado`, negação certificante) | +50/−0 |
| `scripts/governance/validate-engineer-supervised-readiness.js` | alterado (4 checks: `QUEUE_CLOSURE_EVIDENCE`, `QUEUE_INVENTORY_COMPLETE`, `ROUTING_CONSISTENT_WITH_AUTHORITY`, `QUEUE_STATE_STATUS_COHERENT`) | +70 |
| `tests/unit/governance/bugClosureBypassDefense.test.js` | novo (61 testes adversariais) | 810 |

Diff completo: `diff-p0.patch`.

## 5. Contrato canônico de transição

```
OPEN → REPRODUCED → FIX_IN_PROGRESS → FIXED_PENDING_VERIFICATION → VERIFIED
                                                              ↘ FIX_IN_PROGRESS (regressão)
VERIFIED → RESOLVED | OPEN | RISK_ACCEPTED
BLOCKED_EXTERNAL → OPEN | FIX_IN_PROGRESS     (NUNCA → RESOLVED/VERIFIED)
```

- `FIXED_PENDING_VERIFICATION`, `VERIFIED` e `RESOLVED` exigem `regressionTest`;
- `VERIFIED`/`RESOLVED` exigem `evidence` **e** prova de fechamento válida;
- `VERIFIED` exige `verificationCommit` **igual** ao SHA atual (teste em SHA antigo recusa);
- fechamento exige, além da prova: teste listado **e executado** com exit 0, sem timeout,
  **arquivo de saída real** com `outputSha256` recalculado do disco, `severityBefore` igual à
  severidade do INVENTÁRIO, `fromState` igual ao estado PERSISTIDO, ator humano identificado,
  assinatura Ed25519 de autoridade **ancorada** (pin em código + âncora externa opcional) e
  evento no livro, com `transitionId` UUID.

## 6. Modelo de confiança das evidências

- **Integridade** (detecta edição): `proofHash` = sha256 do JSON canônico do payload +
  hashes dos artefatos (inclusive o **arquivo de saída** de cada execução, lido do disco) +
  hash chain do livro de transições.
- **Autenticidade** (detecta forjamento): assinatura **Ed25519** verificada contra
  `governance/risk-acceptance/authorities.json`.
- **ÂNCORA (corrigida na 2ª passada do revisor).** A 1ª versão tratava o JSON de
  autoridades como raiz de confiança — e ele é gravável pelo MESMO ator que edita a fila.
  Agora `governance/bug-closure/trusted-authorities.js` mantém as **impressões pinadas em
  código** (`PINNED_AUTHORITY_FINGERPRINTS`, sha256 do SPKI da chave pública) e, quando
  `RAP_CLOSURE_TRUST_ANCHOR_SHA256` está definida (âncora externa à árvore), o pin tem de
  casar com ela. Chave registrada em JSON e **não pinada** ⇒ `SEM_ANCORA_DE_CONFIANCA`.
  Editar o pin é ato visível (diff + `sourceFingerprint`, que a própria prova assina).
- **Âncora ausente ⇒ bloqueio:** hoje `PINNED_AUTHORITY_FINGERPRINTS = []` e não há âncora
  externa configurada. Nesse estado a certificação permanece bloqueada. Isto é **declarado,
  não contornado**: o mecanismo de prova existe e funciona (testado com pin de teste), mas o
  repositório não possui autoridade humana ancorada.
- `hash` sozinho nunca é aceito como prova: o teste "atacante edita inventário E hashes
  locais" mostra que a decisão continua NEGADA sem chave ancorada.

## 7. Resultados dos testes adversariais (§9)

`tests/unit/governance/bugClosureBypassDefense.test.js` — **61 testes, todos verdes**
(`npx jest tests/unit/governance/bugClosureBypassDefense.test.js`).

Cobrem: 1–12 (JSON/adúlteras: OPEN sem evidência, RESOLVED/VERIFIED direto, só status
legado, ambos, rota removida, defeito apagado, inventário ausente/malformado, estado e
severidade desconhecidos, BLOCKED_EXTERNAL→RESOLVED), 13–24 (prova: sem regressão, exit 1,
exit null, timeout, outro SHA, fingerprint divergente, hash adulterado, prova de outro
defeito, replay/reuso de evento, evento duplicado/fora de ordem, concorrência, aprovação
humana ausente), 25–30 (P0 aceito administrativamente, diagnóstico autorizado, transição
canônica válida, VERIFIED comprovado, gate com prova incompleta, publicação após bypass) e
**31–47 (2ª passada do revisor): P0/P1 achados e fechados** — âncora pinada, override de
inventário por env, travessia de caminho por `transitionId`, severidade e estado de origem
vindos do inventário, artefato de saída obrigatório, coerência `state`×`status` no gate.

Três testes rodam os MESMOS ataques contra os módulos da **baseline** (via `git show`),
provando que o bypass existia (`02` e `03` ⇒ `allowed: true`).

## 8. Resultados por nível

| Nível | Comando | Resultado |
|---|---|---|
| **L0** (unit/contratos) | `npx jest tests/unit/governance --bail=0` (ignorando 2 suítes que exigem artefato de bootstrap) | **179 suítes / 1946 testes PASS**, 2 skip |
| **L1** (consumidores reais) | `node scripts/ci/dev-branch-gate.js --fases A,D` | **PASS_PARCIAL exit 0**; 4 gates verdes |
| **L2** (sistema) | `npm run test:system` | 10 suítes PASS / 1 FAIL — `finalStatusProjection` exige `governance/rap-master-scorecard.json` (artefato gitignored, só existe após run selado) ⇒ **BLOCKED_BY_POLICY (escopo de release)** |
| **L3** (agregado) | `node scripts/governance/run-governance-enforcement.js` | **BLOCKED** — 0/64: identidade de run inexistente no worktree (item `P1-AGREGADO-SEM-IDENTIDADE-DE-RUN-BLOQUEIA-L3`) |

Duas suítes L0 exigem artefatos gerados por `ci:bootstrap`/prod-like smoke
(`modelDrivenE2e`, `coverageCompletenessCanonicalDomains`) e não foram executadas neste
worktree: **NOT_EXECUTED (ambiente)**, não PASS.

## 9. Segunda passada do revisor independente (2026-10-22)

Parecer completo em `parecer-reviewer.md`. A 1ª versão recebeu **CHANGES_REQUIRED** com 2
CRITICAL, 3 HIGH e 2 LOW. Todos foram corrigidos com teste que fica vermelho na 1ª versão:

| # | Sev | Achado | Correção | Teste |
|---|---|---|---|---|
| 1 | CRITICAL | âncora de confiança dentro da árvore gravável (atacante registrava a própria chave) | `trusted-authorities.js`: pin de impressão em código + âncora externa `RAP_CLOSURE_TRUST_ANCHOR_SHA256`; chave não pinada ⇒ `SEM_ANCORA_DE_CONFIANCA` | ALERT 1 (5 testes) |
| 2 | CRITICAL | `BUG_CLOSURE_INVENTORY_PATH` concedia `ALLOWED` para `SELO_FINAL` com `{"items":[]}` | override só em contexto de teste (`NODE_ENV=test`/`JEST_WORKER_ID`), senão `OVERRIDE_DE_INVENTARIO_RECUSADO` | ALERT 2 (3 testes) |
| 3 | HIGH | travessia de caminho via `proof.transitionId` em `applyTransition` | UUID obrigatório validado ANTES da prova; nome do arquivo derivado do evento; `resolve`+prefixo; prova só em transição de fechamento | ALERT 3 (3 testes) |
| 4 | HIGH | `severityBefore` auto-declarada escapava das exigências de P0 | severidade do INVENTÁRIO é autoridade; exigências usam a MAIOR severidade ⇒ `SEVERIDADE_DIVERGENTE` | ALERT 4 (1 teste) |
| 5 | MEDIUM | `QUEUE_NO_OPEN_DEFECT` lia `status` cru (`state:"OPEN"`+`status:"done"` passava) | check deriva de `carregarInventario().defeitos`; novo `QUEUE_STATE_STATUS_COHERENT` mede divergência `state`×`status` | ALERT 5 (2 testes) |
| 6 | LOW | `outputSha256` era atestação sem artefato | `executions[].outputPath` obrigatório, hash recalculado do disco | ALERT 6 (2 testes) |
| 7 | LOW | `prova.fromState` podia divergir do estado persistido | `ESTADO_DE_ORIGEM_DIVERGENTE` | ALERT 4/7 (1 teste) |

Medição nova do gate de readiness com o check de coerência: o item real
`MISSAO-B9-CI-GITHUB-ACTIONS` declara `state: VERIFIED` e `status: blocked_external` —
divergência reportada (não corrigida na fila: a fila é evidência governada, não se
"conserta" dado para o gate passar).

## 10. Veredito

`PARTIALLY_VERIFIED` — o mecanismo está provado contra a matriz adversarial e contra os
achados das duas passadas do revisor; permanece incompleto por fatos externos ao código:

- (a) **âncora humana ausente**: `PINNED_AUTHORITY_FINGERPRINTS = []` e nenhuma âncora
  externa ⇒ toda certificação continua bloqueada. Registrar a chave pública é ato do dono;
- (b) **130 fechamentos sem prova** na fila oficial continuam bloqueando `SELO_FINAL`
  (`FECHAMENTO_SEM_PROVA_VALIDA`) — é o defeito real que a missão mandou expor;
- (c) regressão L2 completa depende de artefato selado (`governance/rap-master-scorecard.json`).

Nenhuma operação certificante indevida foi autorizada durante a missão e nenhuma publicação
ocorreu. A árvore local do worktree não foi publicada.
