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
| `governance/bug-closure/closure-proof.js` | novo (prova + âncora) | 470 |
| `governance/bug-closure/transition-ledger.js` | novo (livro append-only) | 170 |
| `governance/bug-closure/transition-service.js` | novo (API autoritativa) | 215 |
| `governance/bug-closure/authority-consistency.js` | novo (inventário × livro × rota) | 130 |
| `governance/bug-closure/defect-registry.js` | alterado (`stateEfetivo`, `provaDeFechamento`, contexto) | +121/−8 |
| `governance/bug-closure/eligibility.js` | alterado (bucket `fechamentoNaoProvado`, negação certificante) | +50/−0 |
| `scripts/governance/validate-engineer-supervised-readiness.js` | alterado (3 checks novos) | +47 |
| `tests/unit/governance/bugClosureBypassDefense.test.js` | novo (44 testes adversariais) | 520 |

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
  `outputSha256` de 64 hex, artefatos com hash conferido em disco, ator humano identificado,
  assinatura Ed25519 de autoridade com `mayCloseDefects`, evento no livro.

## 6. Modelo de confiança das evidências

- **Integridade** (detecta edição): `proofHash` = sha256 do JSON canônico do payload +
  hashes dos artefatos + hash chain do livro.
- **Autenticidade** (detecta forjamento): assinatura **Ed25519** verificada contra
  `governance/risk-acceptance/authorities.json` (repositório guarda só chaves PÚBLICAS; a
  privada não é acessível ao agente). `keyId` tem de casar com a identidade do ator.
- **Âncora ausente ⇒ bloqueio:** hoje o registro tem `authorities: []`. Nesse estado,
  `SEM_ANCORA_DE_CONFIANCA` é retornado e **a certificação permanece bloqueada**. Isto é
  declarado, não contornado: o mecanismo de prova existe e funciona (testado com autoridade
  de teste), mas o repositório não possui âncora humana registrada.
- `hash` sozinho nunca é aceito como prova: o teste "atacante edita inventário E hashes
  locais" mostra que a decisão continua NEGADA sem assinatura de autoridade registrada.

## 7. Resultados dos testes adversariais (§9)

`tests/unit/governance/bugClosureBypassDefense.test.js` — **44 testes, todos verdes**
(`npx jest tests/unit/governance/bugClosureBypassDefense.test.js`).

Cobrem: 1–12 (JSON/adúlteras: OPEN sem evidência, RESOLVED/VERIFIED direto, só status
legado, ambos, rota removida, defeito apagado, inventário ausente/malformado, estado e
severidade desconhecidos, BLOCKED_EXTERNAL→RESOLVED), 13–24 (prova: sem regressão, exit 1,
exit null, timeout, outro SHA, fingerprint divergente, hash adulterado, prova de outro
defeito, replay/reuso de evento, evento duplicado/fora de ordem, concorrência, aprovação
humana ausente), 25–30 (P0 aceito administrativamente, diagnóstico autorizado, transição
canônica válida, VERIFIED comprovado, gate com prova incompleta, publicação após bypass).

Três testes rodam os MESMOS ataques contra os módulos da **baseline** (via `git show`),
provando que o bypass existia (`02` e `03` ⇒ `allowed: true`).

## 8. Resultados por nível

| Nível | Comando | Resultado |
|---|---|---|
| **L0** (unit/contratos) | `npx jest tests/unit/governance --bail=0` (ignorando 2 suítes que exigem artefato de bootstrap) | **179 suítes / 1924 testes PASS**, 2 skip |
| **L1** (consumidores reais) | `node scripts/ci/dev-branch-gate.js --fases A,D` | **PASS_PARCIAL exit 0**; 4 gates verdes |
| **L2** (sistema) | `npm run test:system` | 10 suítes PASS / 1 FAIL — `finalStatusProjection` exige `governance/rap-master-scorecard.json` (artefato gitignored, só existe após run selado) ⇒ **BLOCKED_BY_POLICY (escopo de release)** |
| **L3** (agregado) | `node scripts/governance/run-governance-enforcement.js` | **BLOCKED** — 0/64: identidade de run inexistente no worktree (item `P1-AGREGADO-SEM-IDENTIDADE-DE-RUN-BLOQUEIA-L3`) |

Duas suítes L0 exigem artefatos gerados por `ci:bootstrap`/prod-like smoke
(`modelDrivenE2e`, `coverageCompletenessCanonicalDomains`) e não foram executadas neste
worktree: **NOT_EXECUTED (ambiente)**, não PASS.

## 9. Veredito

`PARTIALLY_VERIFIED` — pendente de: (a) parecer independente sem P0/P1 aberto; (b) âncora
humana registrada para tornar a certificação possível; (c) regressão L2 completa (depende de
artefato selado). Nenhuma operação certificante indevida foi autorizada durante a missão e
nenhuma publicação ocorreu.
