# L-1 — Bloqueio de certificação medido (sessões concorrentes no mesmo worktree)

**Data:** 2026-10-20 · **Sessão:** L-1 (engenheiro supervisionado) · **Branch:** `dev/engineering-hardening`

## O que está bloqueado

A certificação de runtime do Engineering Router exige que o código **não mude** entre a coleta da
evidência e a verificação. O gate compara `sourceFingerprint` da evidência com o fingerprint do
código no instante da verificação (`RUNTIME_EVIDENCE_FRESH`). Nesta máquina, outra sessão de agente
commita no **mesmo worktree** a cada poucos minutos, então a janela nunca fecha.

## Medições (não narrativa)

### Rodada de certificação de 22:44:26 → 22:53:48

```
SNAP_INI head=11a461e59 dirty=1 22:44:26
COLETOR EXIT=1   (1 item reprovado: EXECUTION_SANDBOX_ISOLATION — "Expected: PASS")
GATE             RUNTIME_EVIDENCE_FRESH falso → RUNTIME_FAIL
SNAP_FIM head=7bab9d05d dirty=3 22:53:48
```

Commits que entraram **durante** a coleta (`11a461e59..7bab9d05d`):

- `24603e69b` ci(gate): L0 determinístico (`JEST_MAX_WORKERS=4`) e env do passo auditável
- `7bab9d05d` docs(memoria): probe de sandbox e determinismo do L0 registrados

E, durante a checagem seguinte, mais um: `51bb995b9` test(budget): contrato do override
`JEST_MAX_WORKERS`.

### O item reprovado passa por comando direto

```
npx jest tests/unit/engineeringRouterExecutionSandboxSecurity.test.js --runInBand
PASS — 10/10 testes, 110,7 s
```

Mesmo padrão em todas as rodadas: cada execução reprova **um item diferente** (promoção → reroute
de provider → reviewer recode → sandbox) e **cada item passa** quando executado diretamente. O
produto não falha; o instrumento não encontra janela estável.

### Rodadas anteriores (mesma causa)

| Rodada | Fingerprint da evidência | Fingerprint do worktree na verificação |
|---|---|---|
| 1 | `15bc43e9…` | `128f32f5…` |
| 2 | `e823bdca…` (clone do commit) | `128f32f5…` |
| 3 | — | HEAD mudou no meio (11a461e59 → 7bab9d05d) |

## Consequência para o veredito

`ENGINEER_SUPERVISED_READY_NO_GO` — critério 7 (gates aplicáveis executados) fica **PARCIAL**: o
`--runtime` não pode ser declarado PASS reproduzível nesta árvore, ainda que os itens passem por
comando direto.

## O que desbloqueia (qualquer uma das opções)

1. **Janela congelada** de ~60 min sem commits nem edições na outra sessão: executar
   `coletor → gate --runtime → L0 → L1` com `dirty=0` antes e depois. É o caminho canônico.
2. **Certificar um commit específico em clone isolado** (`git clone` + `.github/`, `.env`,
   `api/data/config.json` e `node_modules`), sem tocar no worktree compartilhado. Requer aceitar que
   o clone não tem os artefatos gerados (reports/dist) — a certificação vale para o commit, não para
   o estado governado do run.
3. **Definir um único dono** de `ENGINEER_SUPERVISED_READINESS.md` e de
   `AI_MEMORY/hardening-queue.json`: hoje as duas sessões escrevem nos mesmos arquivos e o relatório
   passou a conter duas estruturas de veredito (§1–§13 desta sessão e §14 da outra).

## Nota técnica relevante (produzida pela outra sessão, verificada)

`P1-SANDBOX-PROBE-CACHE-NEGATIVO` (`11a461e59`): `isSandboxAvailable()` fazia `docker info` uma vez
por processo e **cacheava o resultado negativo**. Sob carga o probe estourava e o processo inteiro
passava a responder `SANDBOX_UNAVAILABLE` com Docker saudável — exatamente a assinatura das 17
suítes vermelhas medidas nesta sessão em lote e verdes isoladas. Correção: só o positivo é cacheado,
transitório é retentado, `ENOENT` é definitivo. Isso remove o falso vermelho; **não** remove o
bloqueio de janela descrito acima.
