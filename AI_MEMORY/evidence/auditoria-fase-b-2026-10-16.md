# Auditoria FASE A/B — branch `dev/engineering-hardening` (2026-10-16)

Artefato derivado de execuções reais nesta máquina. Nada aqui é narrativa sem comando: cada linha
tem o comando e o exit code correspondente.

## FASE A — inventário

| Item | Valor medido |
|---|---|
| Branch | `dev/engineering-hardening` |
| HEAD local == `origin/dev/engineering-hardening` | `6221b7cca` (no início da fase) |
| `main` (remota) | `3f619de2a3e9ddabc1e3840f8930e5c2d4684803` |
| merge-base com `main` | `3f619de2a…` (a main é ancestral direta) |
| Commits à frente da `main` | **29** (0 atrás) |
| Arquivos alterados desde a `main` | **120** |
| Worktree | limpo (0 pendentes) |
| `sourceFingerprint` | `1c10ffa62e169a18db1cd22e935fb41420fd5a865da58dd576b36a0f355d971e` |

Áreas mais tocadas (arquivos): `governance/` 27, `scripts/governance/` 10, `qa/enterprise/` 10,
`tests/unit/governance/` 9, `qa/reports/` 9, `qa-waves/journey-coverage/` 8, `reports/` 6,
`qa-mesh/` 5, `docs/governance/` 4, `AI_MEMORY/evidence/` 4, `tools/audit/` 3,
`tests/unit/audit/` 3.

## FASE B — execuções (evidência)

| Alvo (missão §5) | Comando | Resultado |
|---|---|---|
| Gate agregado no HEAD do branch | `npm run validate:governance-enforcement` (worktree congelado) | **exit 0** — 31 linhas `status=PASS`, 0 `FAIL`, 0 `NO_GO` |
| P0 seleção por impacto | `npx jest tests/unit/coverage/impactSelection.test.js impactRunner.test.js` | PASS |
| P0 reuso de resultados | `npx jest tests/unit/governance/releaseSuiteRunner.test.js releaseSuiteBatchDiagnostics.test.js releaseSuiteExclusiveGroups.test.js` | PASS |
| P1 validade temporal (unit) | `npx jest tests/unit/governance/evidenceTtl.test.js askAiRuntimeEvidenceTtlPreflight.test.js` | PASS |
| 4.1/4.2 Router + Mission (unit) | `npx jest tests/unit/engineeringRouter tests/unit/engineeringMission` | **69 suítes / 803 testes PASS** (232 s) |
| Identidade do artefato entregue | `npm run verify:delivered-release` | **exit 0** — `DELIVERED_RELEASE_VERIFIED` |
| P0 integridade da cadeia criptográfica | `node scripts/governance/validate-governance-chain.js` | **exit 1** |
| P0 integridade temporal do run | `npm run validate:current-run-temporal-integrity` | **exit 1** |

## Achados confirmados

### A1 — (meu) teste de unidade regravava artefato governado → derrubou a integridade temporal — CORRIGIDO

- **Reprodução**: `validate:current-run-temporal-integrity` → `status=FAIL fase=CONVERGE violações=1`,
  `INVALID_AUTHORITATIVE_ARTIFACT governance/json-persistence-audit.json`.
- **Causa raiz**: `tests/unit/audit/auditEntrypointArtifact.test.js` chamava
  `json-persistence-audit.js --check`; esse script executa `fs.writeFileSync` do relatório
  **antes** de checar a flag. O arquivo é artefato autoritativo do run governado, então regravá-lo
  fora da janela invalidou o run.
- **Prova da colisão temporal**: mtime do artefato `16:47:39` × fim do agregado `16:33:58`.
- **Correção**: o teste passou a **ler** o artefato (PASS, `unknown=0`, nenhum alvo `UNKNOWN` sob
  `AI_MEMORY/`) em vez de reexecutar o produtor.
- **Prova do fix**: mtime `16:47:39` **idêntico** antes e depois da suíte; `14/14 PASS`.

### A2 — cadeia criptográfica fora do gate agregado (P0) — ABERTO

- `package.json`: `validate-governance-chain` **não** participa da cadeia do agregado (o alias
  existe, mas é invocado apenas na fase `certify` do selo).
- Consequência medida: o agregado deu **exit 0** com a cadeia **quebrada** — um verde que não cobre
  integridade.
- Divergências (3): `blocker_engine cumulative_hash_broken`,
  `package_validation hash_mismatch (governance/package-validation-report.json)`,
  `chain_root chain_root_mismatch`.
- Mecanismo: o próprio agregado regrava artefato coberto pela cadeia —
  `governance-chain.json` de `13:49:00` (selo) × `package-validation-report.json` de `16:33:29`
  (dentro do agregado). Ou seja: **a cadeia só pode estar válida imediatamente após a certificação**;
  qualquer ciclo de validação depois a invalida.
- Correção proposta (duas partes): incluir `validate:governance-chain` no agregado
  (`package.json` — fora de `SOURCE_ROOTS`, barato) **e** fixar a ordem do ciclo (certificar a
  cadeia depois do último escritor de artefato; toca `scripts/governance/**` ⇒ exige re-selagem).
- **Exige decisão do dono**: sem a segunda parte, ligar o gate deixa o agregado permanentemente
  vermelho.

### A2 — CADEIA: análise corrigida na mesma sessão (importante)

A primeira leitura de A2 acima estava **exagerada** e foi corrigida depois de ler o próprio pipeline:

- A fase `certify` do `seal-release.sh` **já reconstrói e assina** a cadeia pelo caminho sancionado
  (`governance/sign-governance.js`) e a **verifica bloqueantemente** em seguida. O comentário no
  arquivo documenta este mesmo defeito, medido em 2026-10-16 (9 divergências), e é a correção dele.
- Portanto a cadeia **é válida imediatamente após um selo**. Ela deixa de ser assim quando o ciclo
  regrava um elo **derivado** — e isso é legítimo, não adulteração.
- Classificação medida (derivada no ponto de entrada, com o validador rodando de verdade): das 9
  divergências, **todas as 5 com elo nomeado são elos DERIVADOS**
  (`evidence-manifest`, `final-proof-report`, `final-readiness-report`, `proof-signature`,
  `package-validation-report`); as outras 4 são consequências estruturais
  (`cumulative_hash_broken` ×3, `chain_root_mismatch`). **Nenhum elo IMUTÁVEL divergiu** — o
  artefato certificado (`…payload.zip`, commit `d9c469e6`) **não foi alterado**.
- **Residual real, menor do que a primeira leitura:** (i) `validate:governance-chain` não está no
  agregado, então um ciclo de validação pode deixar a cadeia divergente com o agregado verde — agora
  **explicitado** no `AUDIT_ENTRYPOINT.md`, que traz o estado da cadeia, a classificação por elo e o
  remédio (novo ciclo de selagem, nunca "conserto" manual); (ii) a cadeia cobre elos que o próprio
  ciclo regrava, o que a torna válida apenas no snapshot pós-selo.

### A3 — escrita fantasma no inventário de persistência (P1) — ABERTO

- Único alvo sob `AI_MEMORY/` no inventário: `AI_MEMORY/hardening-queue.json`, categoria
  `STATIC_VERSIONED_CONFIG`, writer `tools/audit/generate-audit-entrypoint.js`.
- Realidade: esse gerador apenas **lê** a fila (o caminho aparece no mesmo arquivo que escreve o
  `.md` e o scanner o trata como alvo). Classificação também imprópria: a fila é **mutável**.
- Sem impacto em gate (o alvo está classificado), mas o inventário mente.

## Não executado (e por quê)

- **Suítes de integração/E2E de Router/Mission** (112 arquivos): pertencem aos níveis **L2/L3** da
  missão, exigem banco e são o custo do ciclo de certificação. O subconjunto obrigatório já roda no
  agregado (`collect:engineering-router-runtime-evidence`, 25 itens).
- **Artefatos privados de CI** (§7): `BLOCKED_EXTERNAL` — sem orçamento de CI disponível nesta
  máquina; as evidências ficam locais/versionadas e **nenhuma publicação remota é alegada**.

## Estado de certificação (não fabricado)

**NÃO está `READY_FOR_RELEASE_REVIEW`**: A2 é um P0 aberto de integridade (a cadeia criptográfica do
release selado está quebrada por execução pós-selo e nenhum gate bloqueante cobre isso) e A3 é P1
aberto. O que **está** provado verde: agregado exit 0 no HEAD do branch, 914 testes executados entre
os batches 1 e 2, identidade do artefato entregue verificada, e o release selado íntegro como
artefato (fingerprint inalterado por todos os checkpoints).
