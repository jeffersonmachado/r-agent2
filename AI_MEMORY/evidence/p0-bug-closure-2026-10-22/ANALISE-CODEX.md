# Índice para revisão externa (Codex) — blindagem do Bug Closure First

**Ref a revisar:** `dev/engineering-hardening` @ `d50b02d2d` (tudo mergeado; nada pendente em branch).
**Baseline antes da missão:** `0023634244ad05b3e2a01a61987a244c30ea75b2`.

```bash
git fetch origin
git checkout d50b02d2d
git diff 002363424..d50b02d2d            # a missão inteira
git log --oneline 002363424..d50b02d2d    # 5 PRs (#6, #7, #8, #9, #10, #11)
```

## O defeito que a missão fecha

`state`/`status` em `AI_MEMORY/hardening-queue.json` decidiam bloqueio por **valor de enum**. Editar o JSON (ou só o `status` legado, porque `prevention_active → RESOLVED`) fazia `evaluateExecutionEligibility(..., 'SELO_FINAL')` devolver `ALLOWED` — sem teste, sem SHA, sem prova. Reprodução em `reproducao-bypass.txt` (mesmo arquivo `.js` roda contra a baseline via `git show`).

## Ordem de leitura sugerida

| # | Arquivo | Por que ler |
|---|---|---|
| 1 | `governance/bug-closure/closure-proof.js` | núcleo: schema da prova, verificação, âncoras, atestação |
| 2 | `governance/bug-closure/trusted-authorities.js` | raiz de confiança fora da árvore (pins + 3 âncoras externas) |
| 3 | `governance/bug-closure/eligibility.js` | onde a negação acontece (`FECHAMENTO_SEM_PROVA_VALIDA`, `INVENTARIO_NAO_ANCORADO`) |
| 4 | `governance/bug-closure/defect-registry.js` | `stateEfetivo` / `fechamentoNaoProvado` (Camada A) |
| 5 | `governance/bug-closure/transition-ledger.js` | livro append-only com hash chain e `kind=ATTESTATION` |
| 6 | `governance/bug-closure/transition-service.js` | `applyTransition` / `applyAttestation` (validação antes de escrever) |
| 7 | `tests/unit/governance/bugClosureBypassDefense.test.js` | 92 testes adversariais, incl. ataques contra a baseline |
| 8 | `scripts/governance/regularize-bug-closures.js` | re-verificação em massa (não assina, não altera a fila) |
| 9 | `AI_MEMORY/evidence/p0-bug-closure-2026-10-22/RELATORIO.md` | relatório com os 4 ciclos de revisão adversarial |

## Alegações verificáveis (e como conferir cada uma)

| Alegação | Como verificar |
|---|---|
| bypass original era real | `node AI_MEMORY/evidence/p0-bug-closure-2026-10-22/reproducao-bypass.js` → `BYPASS_REPRODUZIDO` na baseline |
| bypass hoje é negado | `node scripts/governance/evaluate-execution-eligibility.js --operation SELO_FINAL` → `DENIED` |
| fila vazia não libera selo | trocar a fila por `{"items":[]}` e repetir → `INVENTARIO_NAO_ANCORADO` |
| prova forjada não passa | `npx jest tests/unit/governance/bugClosureBypassDefense.test.js` (blocos `ALERT 1`…`ALERT 4`) |
| nada foi enfraquecido | `git diff 002363424..d50b02d2d -- tests/` → 0 remoções fora do fixture de `outputPath` |

## Limites declarados (não são bugs; estão no RELATORIO §11)

1. As âncoras são valores **bearer** no ambiente do processo: quem controla o env do release certifica o que quiser. O canal tem de ser o orquestrador/CI.
2. Nenhum workflow define as âncoras ⇒ default é fail-closed (toda operação certificante `DENIED`).
3. O pin em código é cache; quem impede forja nova é a âncora externa.
4. `sourceFingerprint` é integridade relativa; o livro é hash-chain **sem assinatura**.
5. O digest do inventário cobre `[id, severity, state]`, não todos os campos.
6. O **verificador** vive na mesma árvore gravável: âncoras autenticam dados, não código.
7. Operações não certificantes (L0/L1/diagnóstico/correção) seguem autorizadas com P0/P1 abertos, por design.

## Estado real hoje (não é verde)

- `SELO_FINAL` **DENIED**: `INVENTARIO_NAO_ANCORADO`, `BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO`, `FECHAMENTO_SEM_PROVA_VALIDA`.
- 130 fechamentos declarados sem prova: **88 com prova montada** aguardando assinatura, **30 P0** aguardando `negativeEvidence`/`humanAuthorization`, **12** sem teste em lugar nenhum (dossiê em `DECISOES-PENDENTES.md`).
- L3 (`run-governance-enforcement`) para no gate com `0/64` passos — comportamento pretendido.
- Nenhuma prova foi assinada e a fila oficial **não** foi editada por esta missão.
