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
| Suítes de bug-closure | `npx jest tests/unit/governance/bugClosure` | **279 testes / 10 suítes, todos PASS** |
| L0 (governança) | `npx jest tests/unit/governance --bail=0` | **2069 PASS / 15 FAIL / 2 SKIP (2086)** |
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

### 2.1 Comandos executados (SHA `93c487484`)

| Comando | Exit | Resultado medido |
|---|---|---|
| `npx jest tests/unit/governance/bugClosure` | 0 | 273 / 273 PASS (10 suítes) |
| `npx jest tests/unit/governance --bail=0` | 1 | 2064 PASS / 15 FAIL / 2 SKIP — as 7 suítes abaixo |
| `node scripts/ci/dev-branch-gate.js --fases A,D` | 0 | `PASS_PARCIAL` (A pre-voo 10 checks OK; 4 gates L1 verdes) |
| `node scripts/governance/audit-bug-closure-inventory.js` | 0 | 130 itens: 118 `INVALID_EVIDENCE`, 12 `PENDING_REGRESSION` |
| `node scripts/governance/recover-bug-closure-journal.js` | 0 | nada pendente (nenhuma mutação real feita no repo) |
| `node scripts/governance/recover-bug-closure-journal.js --reparar` | 0 | cadeia íntegra, nada a reparar |
| `npm run audit:json-persistence` | 0 | `status: PASS`, `unknown: 0` (566 alvos) |
| `node scripts/governance/run-governance-enforcement.js` | ≠0 | `BLOCKED` 0/64 — identidade de run inexistente |

### 2.2 Explicitamente NÃO executado

- **L2** (`test:system` / integração com DB e runner) nesta passada: `NOT_EXECUTED`. A stack de
  teste foi usada nas fases anteriores (banco `crm_p0_test`, runner em 8090), mas não foi
  reexecutada aqui; nada aqui depende dela para o veredito.
- **`coverageCompletenessCanonicalDomains`**: `NOT_EXECUTED` — exige artefato de `ci:bootstrap`
  (`qa-mesh/meshRegistry.json`) que este ambiente não gera. `NOT_EXECUTED` nunca é contado como PASS.
- **Regeneração das 118 provas**: `NOT_EXECUTED` — exige reexecutar a suíte citada por item no
  SHA final; só depois disso os drafts voltam a ser assináveis.
- **Provisionamento de âncoras e assinatura das provas**: `NOT_EXECUTED` — exige a chave privada
  do dono; por política nenhum agente assina.

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

Cinco passadas por revisor adversarial com contexto separado, **sem acesso ao meu raciocínio**.

- **2ª passada — 7 achados** (4 P1): symlink escape por prova pendente, atestação sem
  lock/base/commit, evento anexado antes do lock, `abortar` fora de escopo; e 3 P2.
- **3ª passada — 4 achados**: retry rebaixava `COMMITTED` (regressão introduzida pela correção
  anterior), temporários previsíveis escritos com `writeFileSync` (segue symlink), TOCTOU do
  diretório de provas, diário sem autenticação.
- **4ª passada — 2 P2**: a cadeia de hash do diário era **write-only** (nenhum consumidor a
  verificava, e `status` mudava sem recomputar o hash — todo `COMMITTED` legítimo nascia com hash
  inválido); e sobrava **um** temporário previsível (`<journal>/<id>.json.tmp`) cuja pré-criação
  prendia a operação em `INTENT` **com o serviço devolvendo `ok:true`**.

**Correção estrutural da 4ª passada** — o diário deixou de ser "um JSON por operação reescrito"
e virou **log append-only encadeado** (`journal.log.jsonl`, `O_APPEND` + `fsync`, um registro por
evento):

- `hash` cobre `seq`, `em`, `transitionId`, `defectId`, `kind`, `from`, `to`, `proofRel`,
  `proofHash`, `queueRel`, `ledgerRel`, `base`, `status`, `tentativa`, `motivo`, `prevHash`
  (JSON canônico, o mesmo de `signature.js`);
- `verificarCadeia` roda em **toda leitura** (`lerRegistros` → `lerIntents` → `recuperar` /
  `haOperacaoPendente`) e detecta edição de campo, reordenação, remoção no meio e `seq` fora de
  ordem;
- mudar status agora é **anexar evento**, não editar registro — forjar `ABORTED`→`COMMITTED`
  quebra o hash e deixa o diário `corrompido`, o que mantém a certificação **negada**
  (fail-closed); anexar sobre cadeia quebrada é recusado (`JOURNAL_CORROMPIDO`);
- **não existe mais temporário algum** no diário (o log só cresce), então o alerta 2 desapareceu
  por construção; e a falha de `marcarCommit` passou a ser **propagada** (`COMMIT_NAO_REGISTRADO`,
  `ok:false`, `projecaoAplicada:true`).

Regressões novas: 5 testes (diário legítimo passa; forja de status detectada e certificação
segue negada; reordenação/remoção no meio detectadas; tmp pré-criado não afeta o commit; falha de
commit não vira sucesso).

- **5ª passada — 2 achados**: (P1) `O_APPEND` protegia os *bytes* mas **não** a alocação de
  `seq`/`prevHash`: dois processos liam N registros, ambos calculavam `seq=N` e o diário quebrava
  de forma **permanente** (`iniciar` passava a recusar tudo e não havia reparo); e (P2) `...extra`
  vinha **depois** de `status`/`seq` em `atualizarStatus`, permitindo que um chamador
  sobrescrevesse campos de controle (API latente).

**Correção da 5ª passada** — o par leitura+append do diário passou a rodar sob **lock próprio**
(`journal/journal.log.lock`, `O_EXCL`, timeout `JOURNAL_OCUPADO`, remoção de lock órfão por PID
morto, nunca de PID vivo); `extra` só entra por allowlist e os campos de controle são atribuídos
por último; e — porque um diário quebrado era um bloqueio **sem saída** — há agora **reparo
canônico** (`recover-bug-closure-journal.js --reparar`) que mantém o maior prefixo válido,
**recusa-se** a descartar registro cujo `transitionId` já tem evento no livro
(`REPARO_PERDERIA_EVIDENCIA_DE_EFEITO`) sem `--forcar`, e nunca toca no livro append-only.
Descartar registro só pode **rebaixar** o estado observado — o reparo nunca libera certificação.

**Prova vermelho→verde da corrida (real, não simulada).** Com a exclusão mútua desligada
(`spawn` de 8 processos simultâneos, 5 execuções): `JOURNAL_CADEIA_SEQ_DIVERGENTE:3`,
`corrompido=true`, 0/8 concluídos. Com o lock: `seq` contíguo, cadeia íntegra, 0 processos com
`ok:true` sem `COMMITTED` correspondente, e o retry dos recusados por contenção
(`FILA_MUDOU_DESDE_A_BASE` / `FILA_OCUPADA`, ambos sem efeito) converge para 8/8 `VERIFIED`.
O teste foi executado **10×** consecutivas sem falha após a correção de um segundo defeito de
corrida que ele mesmo revelou: `removerLockOrfao` podia apagar o lock **vivo** de outro processo
(o arquivo podia ser trocado entre a leitura e o `rmSync`); agora a remoção revalida o `ino` e
nunca remove lock ilegível recente. Leitura concorrente também deixou de negar certificação:
fragmento sem `\n` (escrita em voo) é ignorado na leitura e **descartado antes do próximo
append**, em vez de virar linha do meio e quebrar a cadeia.

**Limite que continua declarado:** truncamento da **cauda** do diário, remoção do arquivo e forja
com cadeia **recalculada** não são detectáveis sem âncora externa — mesma propriedade do livro
(`transitions.log.jsonl`). Verificado que truncar a cauda/filtrar o arquivo **não** libera
certificação (o efeito parcial continua negando o selo por `INVENTARIO_ADULTERADO` /
`P1_BLOQUEANTE_ABERTO`).

## 6. Criptografia — o que é realmente garantido

**Primitivas.** Assinatura **Ed25519** (`crypto.verify(null, payload, chavePublicaPem, assinatura)`)
sobre o **JSON canônico** da prova (chaves ordenadas recursivamente, sem espaços —
`governance/risk-acceptance/signature.js`). `proofHash = sha256(payload canônico)` é conferido
separadamente contra o `proofHash` gravado e contra o evento do livro.
Chave pública resolvida do registro (`governance/risk-acceptance/authorities.json`), nunca do
próprio artefato — o agente não pode se auto-conferir autoridade.

**Cobertura verificada (teste, não prosa).** Todo campo que o verificador lê está assinado:
o conjunto `CAMPOS_ASSINADOS` de `closure-proof.js` contém `artifactType`, `artifactVersion`,
`transitionId`, `defectId`, `severityBefore/After`, `fromState`, `toState`, `evaluatedCommit`,
`codeFingerprint`, `requiredTests`, `executions`, `negativeEvidence`, `artifactHashes`, `actor`,
`humanAuthorization`, `policyDecision`, `createdAt` — e nada mais é lido pelo verificador além de
`proofHash`/`signature` (os próprios resultados da assinatura). Logo não existe **campo não
assinado que influencie a decisão**: trocar `negativeEvidence`, `executions` ou `artifactHashes`
invalida a assinatura; trocar `transitionId` faz o evento não casar.

**Cadeia de confiança.** âncora externa (sha256 do conjunto de pins, no ambiente) → pin em código
versionado → `identity` → `publicKeyPem` do registro. Cada elo é verificável; a **raiz é um valor
bearer no ambiente do processo de release**, não um segredo criptográfico. Não há assinatura de
intenção humana: a âncora atesta *quais chaves valem*, não *que o dono autorizou este fechamento*.

**Replay.** Reutilizar `transitionId` (mesmo com assinatura válida) é recusado: `REPLAY_DE_EVENTO`
quando o evento existe sob outro defeito, `EVENTO_DIVERGENTE_DA_PROVA` quando os campos divergem.

**O que a criptografia NÃO cobre.** `at` do evento (não alimenta decisão), a ordem temporal real
do livro (só encadeamento de hash), a autoria do diário de transição e a integridade do próprio
verificador na árvore. Nenhum desses é usado para conceder fechamento.

## 7. Limites de confiança (não resolvidos por design)

1. **Âncoras externas são valores bearer no ambiente do processo.** Quem provisiona o ambiente
   de release decide quais chaves e qual inventário valem. Não é assinatura de intenção.
2. **Nenhum workflow define as âncoras** ⇒ default fail-closed: toda operação certificante
   `DENIED`.
3. **O diário é estado in-tree.** A cadeia é **verificada** a cada leitura (edição, reordenação e
   remoção no meio são detectadas) e a alocação de `seq` é serializada por lock, mas **não é
   autenticada**: remover o arquivo, truncar a cauda ou forjar tudo com a cadeia recalculada não é
   detectável, e o lock em si também é um arquivo in-tree (quem escreve na árvore pode removê-lo).
   Só âncora externa (ou WAL fora da árvore) resolveria. Verificado que nenhuma dessas
   manipulações, isoladamente, produz fechamento certificado.
4. **O verificador vive na árvore que audita.** `sourceFingerprint` é integridade relativa.
5. **`at` do evento não é vinculado pela prova** — não alimenta decisão.
6. **Operações não certificantes** seguem permitidas com P0/P1 abertos, por design.

## 8. Veredito

**`PARTIALLY_VERIFIED`**

Os quatro P1 da missão (A1–A4) estão corrigidos, com teste vermelho antes e verde depois, e os
**15 achados** das revisões independentes seguintes também (7 + 4 + 2 + 2). Não é `DEVELOPMENT_VERIFIED` porque
quatro critérios de aceitação dependem de insumo externo e continuam abertos: âncoras
provisionadas, aprovação humana dos P0, regeneração das 118 provas no SHA final e execução de
L1/L2 completos com infraestrutura (runner + banco de teste já usados; `coverageCompleteness`
segue `NOT_EXECUTED`).

**RELEASE_CERTIFICATION = NO_GO**

Nenhuma publicação, tag, deploy, alteração em `main` ou assinatura foi executada. `SELO_FINAL`
permanece `DENIED`.
