# L-1 — Janela congelada para certificação (handoff)

**Objetivo:** fechar o critério 7 (`gates aplicáveis executados`) com `--runtime` PASS **reproduzível**
e, se tudo passar, L0 + L1 na mesma árvore — única condição honesta para mudar o veredito de
`ENGINEER_SUPERVISED_READY_NO_GO` para GO.

## Estado no momento do handoff (2026-10-20 22:57)

```
HEAD   = aa8431be6
REMOTE = aa8431be6   (origin/dev/engineering-hardening — nada pendente de push)
worktree = LIMPO (git status --short vazio)
run em voo: JEST_MAX_WORKERS=4 npm test (será morto ao fechar o VS Code — perde-se só o log desse run)
```

Tudo o que foi produzido está commitado e publicado. Fechar o VS Code não perde trabalho; apenas
encerra o `npm test` em andamento.

## Pré-condições (verificar ANTES de rodar)

1. **Nenhuma outra sessão ativa.** Confirmar que não há `jest`, `node scripts/` nem outro agente
   editando o repositório.
2. `git status --short` **vazio**. Se houver pendências de outra sessão, commitar ou descartar antes
   — nunca rodar a certificação com árvore suja.
3. `HEAD == origin` (nada a publicar antes da medição).

## Sequência canônica (uma única execução, sem tocar em nada durante)

```bash
cd /opt/results/ria/r-agent2
export PATH="/home/jmachado/.nvm/versions/node/v22.12.0/bin:$PATH"

# 1) snapshot de integridade
echo "SNAP_INI head=$(git rev-parse --short HEAD) dirty=$(git status --short | wc -l) $(date +%H:%M:%S)" | tee /tmp/cert2-snap.txt

# 2) evidência de runtime (25 itens, arquivo inteiro por item; ~40-50 min)
node scripts/governance/collect-engineering-router-runtime-evidence.js | tail -3

# 3) gate na MESMA árvore
node scripts/governance/validate-engineering-router-v1.js --runtime | tail -3

# 4) L0 e L1
npx jest "tests/unit/engineering" tests/unit/governance --bail=0 | tail -5
npx jest "tests/integration/engineering" tests/contracts/engineeringCoderReviewerService.test.js --bail=0 --maxWorkers=2 | tail -5

# 5) snapshot final
echo "SNAP_FIM head=$(git rev-parse --short HEAD) dirty=$(git status --short | wc -l) $(date +%H:%M:%S)" | tee -a /tmp/cert2-snap.txt
```

## Critérios de aceite (todos obrigatórios)

| Verificação | Aceite |
|---|---|
| `SNAP_INI` e `SNAP_FIM` | mesmo `head` e `dirty` nos dois (senão: medição inválida, repetir) |
| coletor | `status=RUNTIME_PASS items=25 falhas=0` |
| gate `--runtime` | `status=PASS (STRUCTURAL_PASS/RUNTIME_PASS)` |
| L0 | exit 0, sem suíte vermelha |
| L1 | exit 0, 40 suítes / 221 testes |

## Se algo falhar

1. **Item de runtime reprovado** → rodar o item isolado. Se passar isolado, é instabilidade do
   coletor (registrar em `L1-RUNTIME-EVIDENCE-NAO-REPRODUZIVEL`), **não** declarar PASS.
2. **Suíte de L0/L1 vermelha** → é defeito: abrir item na fila com o teste de regressão e corrigir
   antes de qualquer GO.
3. **`SNAP_FIM` diferente do `SNAP_INI`** → a árvore mudou durante a medição: repetir a janela. Nunca
   "aproveitar" resultado de árvore que mudou.

## O que continua fora do escopo de L-1 (não impede GO supervisionado)

- gate agregado de governança (depende de identidade de run no branch de desenvolvimento);
- selo/release (`SEAL_PENDING`), missão de ensaio supervisionada com aprovação humana.
