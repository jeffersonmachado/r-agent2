# Missão Codex — blindagem do Bug Closure First: auditoria adversarial

**SHA inicial:** `52d39fea293affe072b868972a5e48519ac54184`
**SHA final:** `e087eb10b` (branch `codex/bug-closure-adversarial-hardening`)
**Worktree:** `/tmp/rbc-audit`
**Baseline histórica do bypass:** `0023634244ad05b3e2a01a61987a244c30ea75b2`

> Relatório de DEVELOPMENT. **Não** é certificação de release.

---

## 1. Defeitos reproduzidos e corrigidos

### A1 (P1) — transição legítima invalidava a própria prova após persistir

**Causa-raiz:** `closure-proof.validarEstrutura` comparava `prova.fromState` com o estado
**persistido**. Depois de `applyTransition`, o persistido é o `toState` — a prova recém-aplicada
passava a ser recusada com `ESTADO_DE_ORIGEM_DIVERGENTE`.

**Reprodução (antes):** `applyTransition: OK` → recarregar inventário →
`state=VERIFIED`, `stateEfetivo=OPEN`, `fechamentoNaoProvado=true`,
`provaDeFechamento.code="ESTADO_DE_ORIGEM_DIVERGENTE"`, `SELO_FINAL: DENIED`.

**Correção:** a prova tem duas fases explícitas — PENDENTE (`persistido === fromState`) e
APLICADA (`persistido === toState`); qualquer outro estado segue recusado. O caminho APLICADA
não é atalho: exige o evento correspondente no livro, conferido campo a campo (A2).
`governance/bug-closure/closure-proof.js` (bloco de estado), `governance/bug-closure/defect-registry.js`
(repasse de `ancoragem` para o contexto de fechamento).

**Teste:** `tests/unit/governance/bugClosurePersistenceIntegrity.test.js` — 4 casos (aplicada
mantém prova, elegibilidade sem `FECHAMENTO_SEM_PROVA_VALIDA`, pendente continua válida, estado
estranho continua recusado).

### A2 (P1) — evento do livro não correspondia integralmente à prova

**Causa-raiz:** o verificador localizava o evento pelo `transitionId` e conferia apenas
existência/ordem. Livro internamente consistente mas semanticamente divergente passava.

**Correção:** comparação canônica de `from`, `to`, `proofHash`, `actorId`, `evaluatedCommit`,
`kind`, `defectId` → `EVENTO_DIVERGENTE_DA_PROVA`; busca do `transitionId` passa a ser global
(evento sob outro defeito vira `REPLAY_DE_EVENTO`, não "não registrado").

**Teste:** 8 casos parametrizados (um por campo adulterado) + `transitionId` trocado.

### A3 (P1) — evento órfão em `applyAttestation`

**Causa-raiz:** o append no livro acontecia **antes** da validação de `proofsPath`. Recusa
posterior deixava evento permanente e consumia o `transitionId`.

**Correção:** validação de caminho antes de qualquer mutação; a mesma prova pode ser reaplicada
com caminho válido.

**Teste:** recusa com livro byte-idêntico, fila intacta, `attestationId` ausente e reaplicação
bem-sucedida.

### A4 (P1) — concorrência e falha parcial

**Causa-raiz:** três artefatos mutados em sequência sem registro de intenção, sem lock na
atestação e sem detecção de lost update.

**Correção:** `governance/bug-closure/transition-journal.js` — INTENT → COMMITTED|ABORTED, base
hash de fila/livro, lock exclusivo, checagem de base antes da projeção, commit só após o rename,
recuperação determinística (`scripts/governance/recover-bug-closure-journal.js`). Efeito parcial
torna a certificação inelegível (`OPERACAO_PENDENTE_DE_RECUPERACAO`); ABORTED sem efeito não
bloqueia; o livro append-only nunca é truncado. Escrita atômica segura (sem seguir symlink) em
todos os artefatos; revalidação do diretório de provas no ponto de uso.

**Testes:** 22 casos com **processos reais** (lock ocupado, 4 transições simultâneas, falha de
escrita/rename, recuperação idempotente, diário ilegível, retry pós-abort/pós-commit).

---

## 2. Regressões

| Camada | Comando | Resultado |
|---|---|---|
| Suítes de bug-closure | `npx jest tests/unit/governance/bugClosure` | **268 testes / 10 suítes, todos PASS** |
| L0 (governança) | `npx jest tests/unit/governance --bail=0` | **2058 PASS / 15 FAIL / 2 SKIP (2075)** |
| L1 (DEVELOPMENT) | `node scripts/ci/dev-branch-gate.js --fases A,D` | **PASS_PARCIAL**, exit 0 |
| L3 (agregado) | `node scripts/governance/run-governance-enforcement.js` | **BLOCKED 0/64** — identidade de run ausente |
| Auditoria de persistência | `npm run audit:json-persistence` | **PASS**, `unknown: 0` |

**As 15 falhas de L0 são pré-existentes e dependem de artefato de bootstrap**, não de regressão:
`v2TimeoutGateDependency`, `v2AuditEnvelopeCoverage`, `convergenceFixpoint`,
`benchmarkCertificationAuthority`, `benchmarkSemanticVersionGate`, `modelDrivenE2e`,
`coverageCompletenessCanonicalDomains`. Medição comparativa em worktree limpo no SHA inicial
`52d39fea2`: **6 suítes / 12 testes idênticos**; a sétima (`coverageCompleteness`) exige
`qa-mesh/meshRegistry.json` gerado por `ci:bootstrap` (**NOT_EXECUTED no ambiente**, nunca PASS).

**Nenhum teste anterior foi enfraquecido:** `git diff 52d39fea2..HEAD -- tests/` só adiciona.

---

## 3. Segurança — ataques executados

`tests/unit/governance/bugClosureAttackMatrix.test.js` (29 casos) cobre a tabela da missão:
`state`→`VERIFIED`, `status`→`prevention_active`, remover P0/P1, inventário vazio, `--queue`,
`BUG_CLOSURE_INVENTORY_PATH`, prova sem regressão, `NOT_EXECUTED`/`UNKNOWN`, `exitCode: null`,
SHA forjado, output hash, source fingerprint, severidade P0→P3, chave não autorizada,
`authorities.json` editado, pin editado, evento de outro defeito, `transitionId` reutilizado,
`proofHash` divergente, `proofsPath` fora da raiz, `transitionId` com traversal, atestação em
`OPEN`/`RISK_ACCEPTED`, atestação sem teste, livro consistente-mas-divergente, âncora ausente,
evidência de outro commit, symlink escape.

**Bloqueados:** todos os acima. **Casos positivos legítimos aprovados:** transição válida que
permanece verificável após persistir; atestação válida que não muda o estado; operação não
certificante autorizada com P0 aberto.

**Bypasses restantes:** nenhum encontrado que produza fechamento **certificado** sem assinatura
de autoridade ancorada. Ver limites.

## 4. Governança — os 130 defeitos históricos (Fase E)

`node scripts/governance/audit-bug-closure-inventory.js` no SHA final:

| Classe | Itens |
|---|---|
| `VERIFIED_CANONICALLY` | **0** |
| `PENDING_SIGNATURE` | 0 |
| `PENDING_HUMAN_AUTHORIZATION` | 0 |
| `PENDING_REGRESSION` | **12** |
| `INVALID_EVIDENCE` | **118** |
| `BLOCKED` | 0 |

- **`VERIFIED_CANONICALLY = 0`** é o resultado correto: nenhuma âncora externa está provisionada
  (`fechamento/aprovacao/inventario = false`) e nenhuma prova foi assinada.
- **118 `INVALID_EVIDENCE`**: os drafts carregam `codeFingerprint` de `e747bac4c5`; o código do
  verificador mudou (A1/A2) e o fingerprint atual é outro. É o invariante funcionando —
  *código mudou → prova é stale* —, não uma regressão da missão. Regenerar exige re-executar as
  suítes correspondentes no SHA final.
- **12 `PENDING_REGRESSION`**: sem teste de regressão localizável em nenhuma fonte
  (campo, evidência declarada ou commit do fix).
- **`SELO_FINAL`**: `DENIED` com `INVENTARIO_NAO_ANCORADO`,
  `BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO`, `FECHAMENTO_SEM_PROVA_VALIDA`.
- Nenhum `state`/`status` foi alterado para aumentar contagem de fechados.

## 5. Revisão independente

Quatro passadas por revisor adversarial com contexto separado, **sem acesso ao meu raciocínio**.
Achados: **7** na 2ª passada (4 P1: symlink escape, atestação sem lock/base/commit, evento
antes do lock, `abortar` fora de escopo; 3 P2) e **4** na 3ª (retry rebaixava COMMITTED —
regressão introduzida pela minha própria correção —, temporários previsíveis com symlink,
TOCTOU do diretório de provas, diário sem autenticação). Todos corrigidos com reprodução e
regressão própria.

## 6. Limites de confiança (não resolvidos por design)

1. **Âncoras externas são valores bearer no ambiente do processo.** Quem provisiona o ambiente
   de release decide quais chaves e qual inventário valem. Não é assinatura de intenção.
2. **Nenhum workflow define as âncoras** ⇒ default fail-closed: toda operação certificante
   `DENIED`.
3. **O diário é estado in-tree.** Ganhou cadeia de hash (forja exige reescrever a cadeia
   inteira), mas **não é autenticado**: quem reescreve diário **e** livro de forma coerente
   desliga a guarda A4. Só âncora externa (ou WAL fora da árvore) resolveria.
4. **O verificador vive na árvore que audita.** `sourceFingerprint` é integridade relativa.
5. **`at` do evento não é vinculado pela prova** — não alimenta decisão.
6. **Operações não certificantes** seguem permitidas com P0/P1 abertos, por design.

## 7. Veredito

**`PARTIALLY_VERIFIED`**

Os quatro P1 da missão (A1–A4) estão corrigidos, com teste vermelho antes e verde depois, e os
11 achados das revisões independentes seguintes também. Não é `DEVELOPMENT_VERIFIED` porque
quatro critérios de aceitação dependem de insumo externo e continuam abertos: âncoras
provisionadas, aprovação humana dos P0, regeneração das 118 provas no SHA final e execução de
L1/L2 completos com infraestrutura (runner + banco de teste já usados; `coverageCompleteness`
segue `NOT_EXECUTED`).

**RELEASE_CERTIFICATION = NO_GO**

Nenhuma publicação, tag, deploy, alteração em `main` ou assinatura foi executada. `SELO_FINAL`
permanece `DENIED`.
