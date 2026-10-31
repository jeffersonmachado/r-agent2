# Missão Codex — blindagem do Bug Closure First: auditoria adversarial

**SHA inicial:** `52d39fea293affe072b868972a5e48519ac54184`
**SHA final:** o próprio commit que contém este arquivo (branch `codex/bug-closure-adversarial-hardening`,
publicada em `origin`) — derive com
`git log -1 --format=%H -- AI_MEMORY/evidence/p0-bug-closure-2026-10-22/AUDITORIA-CODEX.md`
(um arquivo não pode citar o hash do commit que o contém).
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
| Suítes de bug-closure | `npx jest tests/unit/governance/bugClosure` | **288 testes / 10 suítes, todos PASS** |
| L0 (governança) | `npx jest tests/unit/governance --bail=0` | **2079 PASS / 15 FAIL / 2 SKIP (2096)** |
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

### 2.1 Comandos executados (no commit final da branch)

| Comando | Exit | Resultado medido |
|---|---|---|
| `npx jest tests/unit/governance/bugClosure` | 0 | 273 / 273 PASS (10 suítes) |
| `npx jest tests/unit/governance --bail=0` | 1 | 2079 PASS / 15 FAIL / 2 SKIP — as 7 suítes abaixo |
| `node scripts/ci/dev-branch-gate.js --fases A,D` | 0 | `PASS_PARCIAL` (A pre-voo 10 checks OK; 4 gates L1 verdes) |
| `node scripts/governance/audit-bug-closure-inventory.js` | 0 | 130 itens: **88 `PENDING_SIGNATURE`, 30 `PENDING_HUMAN_AUTHORIZATION`, 12 `PENDING_REGRESSION`, 0 `INVALID_EVIDENCE`** |
| `node scripts/governance/recover-bug-closure-journal.js` | 0 | nada pendente (nenhuma mutação real feita no repo) |
| `node scripts/governance/recover-bug-closure-journal.js --reparar` | 0 | cadeia íntegra, nada a reparar |
| `npm run audit:json-persistence` | 0 | `status: PASS`, `unknown: 0` (566 alvos) |
| `node scripts/governance/validate-bug-closure-status.js` | **1** | `mecanismo: recusa como deve (13 provas)`; `guardas: 9/9` consultam elegibilidade; **`FAIL: FECHAMENTO_NAO_PROVADO`** (130) — fail-closed correto, não regressão |
| `node scripts/governance/run-governance-enforcement.js` | ≠0 | `BLOCKED` 0/64 — identidade de run inexistente |

### 2.2 Explicitamente NÃO executado

- **L2** (`test:system` / integração com DB e runner) nesta passada: `NOT_EXECUTED`. A stack de
  teste foi usada nas fases anteriores (banco `crm_p0_test`, runner em 8090), mas não foi
  reexecutada aqui; nada aqui depende dela para o veredito.
- **`coverageCompletenessCanonicalDomains`**: `NOT_EXECUTED` — exige artefato de `ci:bootstrap`
  (`qa-mesh/meshRegistry.json`) que este ambiente não gera. `NOT_EXECUTED` nunca é contado como PASS.
- **Regeneração das 118 provas**: **EXECUTADA** (130 itens, `regularize-bug-closures.js`, no commit
  final) — ver §4. `INVALID_EVIDENCE = 0`.
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

| Classe | Antes da regeneração | **Depois da regeneração** |
|---|---|---|
| `VERIFIED_CANONICALLY` | 0 | **0** |
| `PENDING_SIGNATURE` | 0 | **88** |
| `PENDING_HUMAN_AUTHORIZATION` | 0 | **30** |
| `PENDING_REGRESSION` | 12 | **12** |
| `INVALID_EVIDENCE` | 118 | **0** |

- **`VERIFIED_CANONICALLY = 0`** é o resultado correto: nenhuma âncora externa está provisionada
  (`fechamento/aprovacao/inventario = false`) e nenhuma prova foi assinada.
- **118 `INVALID_EVIDENCE` → 0.** Os drafts carregavam `codeFingerprint` de `e747bac4c5`; o código
  do verificador mudou (A1/A2) e o fingerprint passou a divergir — o invariante funcionando
  (*código mudou → prova é stale*), não uma regressão. As 118 suítes citadas foram **reexecutadas
  no commit final** (`regularize-bug-closures.js`): **88** viraram provas assináveis, **30**
  ficaram em `AGUARDA_INSUMOS_HUMANOS` (`negativeEvidence`/`humanAuthorization`) e **7** estavam
  `AMBIENTE_INDISPONIVEL`. As 7 foram desbloqueadas com o ambiente real deste host
  (Postgres `crm_p0_test` + engineering runner em 8090) e reexecutadas — inclusive
  `crmTenantIsolation.postgres` (22/22), `engineeringMissionFullE2E`, `governanceApprovalFullWorkerE2E`
  e `missionSourceStaleReplanFullRouterE2E` — reduzindo `INVALID_EVIDENCE` a **0**.
  As 12 `PENDING_REGRESSION` permanecem: não há teste de regressão localizável em nenhuma fonte.
- Os drafts são **estáveis entre commits** (não entram na superfície do `codeFingerprint`): a
  classificação ficou idêntica antes e depois do commit que os gravou. Nada foi assinado e nenhuma
  âncora foi provisionada; `state`/`status` da fila não foram tocados.
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

- **6ª passada — 4 achados** (1 P1 + 3 P2): (P1) a remoção automática de lock órfão era um
  **TOCTOU** — `lstat`→`rmSync` não é compare-and-swap, dois processos entravam na seção crítica
  e a cadeia quebrava (reproduzido **4/40 e 2/20** rodadas com 10 processos e um lock órfão,
  contra **0/20** sem ele); (P2) o corte da cauda em voo era feito **depois** do filtro de linhas
  e podia descartar o **último registro válido** (bastava remover o `\n` final); (P2) lock com
  PID vivo alheio — ou um diretório no caminho do lock — negava **todas** as escritas do diário de
  forma indistinguível de contenção; (P2) `--reparar` era **fail-open** quando o livro não era
  legível (`eventosDoLivro` devolvia `[]`), podendo zerar o diário com `ok:true`.

**Correção da 6ª passada:**
- **Nenhuma remoção automática de lock.** Lock de PID morto vira erro **distinguível**
  (`JOURNAL_LOCK_ORFAO`, com a instrução exata) e a quebra é explícita e auditada
  (`quebrarLock` / `--quebrar-lock --confirmar`, que **recusa** lock de processo vivo). Isso
  elimina a classe inteira do TOCTOU: não há mais `rm` no caminho de aquisição.
- **Liberação por token**, não por caminho: cada aquisição grava `{pid, token}` e o `finally` só
  apaga o lock que **ainda carrega o próprio token** — nunca o de terceiro.
- **Corte da cauda pelo fragmento**: só é cauda em voo o que **não completa** um registro; JSON
  completo sem `\n` final continua valendo e o arquivo é **normalizado** antes do próximo append
  (nenhum registro válido é perdido).
- **Reparo fail-closed**: reparo destrutivo exige **livro verificável** (`REPARO_SEM_LIVRO_VERIFICAVEL`)
  e o snapshot do livro é lido **dentro** do lock do diário.

**Evidência medida:** 10 rodadas × 10 processos com lock órfão ⇒ **0 corrupções**, 10/10
`JOURNAL_LOCK_ORFAO`, `haOperacaoPendente=false`, quebra explícita OK; 10 rodadas × 10 processos
sem órfão ⇒ **0 corrupções**; `282/282` na suíte; L0 sem regressão.

- **7ª passada — 2 P2** no guardião de evidência do reparo: o CLI ainda tirava o snapshot do livro
  **fora** do lock e `lerLivro` ignorava o `rootDir` (reparar um diretório de dados lia o livro do
  **repositório do módulo** e descartava evidência); e livro **ausente/vazio** continuava
  "verificável" (cadeia íntegra, zero eventos), então truncar o livro desarmava o guardião.

**Correção da 7ª passada:** `repararDiario(rootDir, {forcar})` lê o livro **internamente, sob o
lock, do mesmo `rootDir`** — `ledgerEventos`/`ledgerVerificavel` de chamador são **ignorados**;
livro ausente, ilegível **ou sem eventos** ⇒ `REPARO_SEM_LIVRO_VERIFICAVEL`; e linha ilegível
**com `\n`** passa a ser tratada como possível evidência (não é comprovável), então o reparo
destrutivo exige `--forcar` — só o fragmento **final sem newline** (escrita em voo/comprovadamente
incompleto) é considerado inofensivo.

- **8ª passada — `APPROVED`**, sem achado bloqueante. Duas observações de auditoria (LOW) aplicadas:
  o reparo passa a devolver `forcado`, `livroVerificavel` e `perdeEvidencia` (e o CLI imprime
  `[reparo] FORÇADO`), e o `livroDiagnostico` do CLI usa a mesma régua do guardião
  (`eventos > 0`) — antes um livro vazio aparecia como "verificável" no diagnóstico enquanto a
  decisão recusava. 2 regressões novas.

**Parecer final do revisor (8ª passada, literal):** *"Não encontrei novo caminho para certificação
falsa nem para corrupção automática do diário. Nenhuma manipulação de lock/diário/reparo, em
nenhuma das 8 passadas, produziu `SELO_FINAL = ALLOWED` sem prova; todos os caminhos falham
fechados."*

**Limite que continua declarado:** truncamento da **cauda** do diário, remoção do arquivo e forja
com cadeia **recalculada** não são detectáveis sem âncora externa — mesma propriedade do livro
(`transitions.log.jsonl`). Verificado que truncar a cauda/filtrar o arquivo **não** libera
certificação (o efeito parcial continua negando o selo por `INVENTARIO_ADULTERADO` /
`P1_BLOQUEANTE_ABERTO`). Um lock in-tree com PID vivo alheio (ou diretório no caminho) bloqueia
**novas escritas** do diário até quebra manual — DoS in-tree, indistinguível de contenção,
**não** bloqueia a leitura do selo; corrigível só com lock de kernel (`flock`) ou WAL fora da
árvore, ambos fora do escopo desta missão.

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
7. **Lock de escrita do diário é in-tree.** Um lock com PID vivo alheio (ou um diretório no
   caminho) bloqueia **novas** escritas do diário até quebra manual — DoS in-tree,
   indistinguível de contenção legítima, que **não** bloqueia a leitura do selo. Nada é removido
   automaticamente (a remoção automática era o TOCTOU do P1 da 6ª passada); a quebra é explícita
   (`--quebrar-lock --confirmar`) e recusa lock de processo vivo. Solução real exigiria
   `flock(2)`/WAL fora da árvore.
8. **Liveness de PID é local ao namespace.** Em multi-container com volume compartilhado, um lock
   vivo de outro container é classificado como órfão (erro, não remoção) — conservador, mas exige
   decisão humana.
9. **Guardão de evidência do reparo depende do livro.** Livro truncado a ponto de perder eventos
   mantém a cadeia "íntegra" (não há âncora para detectar truncamento), e o reparo passa a ver
   menos evidência; por isso livro ausente/vazio é tratado como **não verificável** e o reparo
   destrutivo exige `--forcar`, que é a única válvula e fica registrada no relatório.
10. **Reparo é O(n²)** (`verificarCadeia` por linha): ~318 ms para 200 registros; milhares de
    registros levariam minutos. Não é caminho quente.

## 8. Achados PÓS-MERGE: a prova não era portável entre checkouts

Depois do merge do PR #12, validar no workspace principal revelou **dois** defeitos que nenhuma
das 8 passadas de revisão pegou — porque todos os testes rodavam numa árvore só. Ambos foram
corrigidos (PRs #13 e #14) e provados num **checkout limpo**.

### 8.1 `sourceFingerprint` dependia de artefato GERADO (`qa/evidence`)

`qa/evidence/` está na superfície provada (os **validadores** vivem lá), mas o mesmo diretório
recebe **saídas** de execução (`*-latest.json`, ignoradas pelo git). Uma delas entrava no
fingerprint, então o invariante *"código mudou → prova stale"* disparava por **artefato de
execução**:

```
worktree limpo ................ babb60d5f1b4
workspace que rodou a jornada .. 3eac1cbf8859
```

O mesmo commit produzia dois fingerprints. **Correção:** `SKIP_REL_FILE_PATTERNS` exclui
`qa/evidence/*-latest.(json|txt|log)` — mesma regra já aplicada a `qa-mesh/meshHistory`,
`qa/mesh/intelligence/history` e `core/rpa/reports`. Validadores `*.js` e JSON de contrato em
`qa/evidence` **continuam contando** (teste nos dois sentidos; um deles fica vermelho sem o fix).
Depois do fix, as duas árvores dão `a351e0628dcd`.

### 8.2 A prova referenciava um log que o `.gitignore` excluía

As 118 provas amarram `outputSha256` a
`AI_MEMORY/evidence/bug-closure-regularization/<ID>.log`, mas `*.log` estava no `.gitignore`:
os logs existiam **só na máquina que gerou a prova**. Em qualquer outro checkout, as 118 viravam
`EVIDENCIA_ADULTERADA` — o portão acusava adulteração onde havia arquivo ausente.
**Correção:** exceção explícita no `.gitignore` (com o motivo ao lado da regra) e as 118 saídas
versionadas (588 KB); o `.gitattributes` do diretório já preserva os bytes exatos
(`*.log -text -diff`). 118/118 conferem com o `outputSha256`.

### 8.3 Prova de portabilidade (checkout limpo)

```
git worktree add --detach /tmp/rbc-verify 7f8922d8c     # sem .env, sem artefatos, sem runs
node scripts/governance/audit-bug-closure-inventory.js
  88 PENDING_SIGNATURE
  30 PENDING_HUMAN_AUTHORIZATION
  12 PENDING_REGRESSION
   0 INVALID_EVIDENCE
```

Antes: **118 `INVALID_EVIDENCE`** no mesmo tipo de checkout. `292/292` testes passam no checkout
limpo e `validate:bug-closure-status` continua **FAIL** (`FECHAMENTO_NAO_PROVADO`) — fail-closed.

**Lição de auditoria:** um invariante que depende de estado de execução do workspace não é
invariante. Os dois defeitos só apareceram porque a validação saiu da árvore onde tudo foi
gerado; a revisão adversarial, por mais rodadas que fizesse, herdava o mesmo ponto cego.

## 9. Veredito

**`DEVELOPMENT_VERIFIED`**

Os quatro P1 da missão (A1–A4) estão corrigidos, com teste vermelho antes e verde depois, e os
**23 achados** das revisões independentes seguintes também (7 + 4 + 2 + 2 + 4 + 2 + 2), com
`APPROVED` na 8ª passada. Do critério original restam abertos apenas insumos **humanos**: âncoras
provisionadas e aprovação/assinatura das provas (88 assináveis + 30 que exigem
`negativeEvidence`/`humanAuthorization` + 12 sem teste localizável) — e `coverageCompleteness`
segue `NOT_EXECUTED` neste ambiente (artefato de `ci:bootstrap`). A regeneração das provas no
commit final foi **executada** e `INVALID_EVIDENCE` está em **0**.

Os dois achados pós-merge (§8) estão corrigidos e provados em checkout limpo — inclusive o
defeito de portabilidade, que fazia a afirmação "`INVALID_EVIDENCE = 0`" ser verdadeira só na
árvore que gerou as provas.

**RELEASE_CERTIFICATION = NO_GO**

Nenhuma publicação, tag, deploy, alteração em `main` ou assinatura foi executada. `SELO_FINAL`
permanece `DENIED`.
