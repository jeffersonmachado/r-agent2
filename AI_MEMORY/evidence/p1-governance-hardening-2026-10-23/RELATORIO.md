# Missão Codex — Hardening P1 definitivo do r-agent2

**SHA inicial:** `484eee4788e553907e31f7b0528cac9ee41d9298`
**Branch:** `codex/p1-governance-hardening-20261023` (worktree `/tmp/r-agent2-p1-hardening`)
**SHA final:** o commit que contém este arquivo — derive com
`git log -1 --format=%H -- AI_MEMORY/evidence/p1-governance-hardening-2026-10-23/RELATORIO.md`

> Relatório de **DEVELOPMENT**. Não é certificação de release.
> `RELEASE_CERTIFICATION = NO_GO` · `MAIN_MODIFIED = FALSE` · `PUBLISHED = FALSE`

---

## 1. Identidade e ambiente

| Item | Valor |
|---|---|
| SHA base | `484eee4788e553907e31f7b0528cac9ee41d9298` (`git cat-file -t` = `commit`) |
| Branch de trabalho | `codex/p1-governance-hardening-20261023` (isolada; `main` intocada) |
| Worktree | `/tmp/r-agent2-p1-hardening` (o workspace original não foi alterado) |
| Node / npm | `v22.12.0` / `10.9.0` |
| Dependências | `node_modules` e `frontend/node_modules` ligados ao workspace (mesmo lockfile) |
| Ferramentas | Jest (backend), Playwright (não usado nesta missão), Docker (sandbox do Router), Postgres `crm_p0_test`, Engineering Runner em `:8090` |
| Estado Git inicial | árvore limpa em `484eee478` |

**Nenhuma** publicação, tag, deploy, push para `main` ou assinatura foi executada.

---

## 2. Correções (cinco grupos P1)

### P1-A — Path traversal no regularizador

**Causa-raiz.** `scripts/governance/regularize-bug-closures.js` montava caminho com o `defectId`
vindo da **fila** (dado, não caminho): `${defectId}.log`, `${item.id}.json`, `itens/${r.id}.json`.

**Reprodução (antes, filesystem real).** Id `../../../../../tmp/p1a-fora-2` produziu
`/tmp/p1a-fora-2.log`; id `../../../..//p1a-fora-1` produziu `/tmp/p1a-fora-1.log` — fora da raiz
autorizada. Confirmado por existência de arquivo criado fora do `root` temporário.

**Correção (na origem, não no último `writeFileSync`).** Novo
`governance/bug-closure/defect-id.js`:
1. contrato canônico (`^[A-Za-z0-9][A-Za-z0-9._-]*$`, ≤ 120 chars, ASCII, sem `..`, sem
   separador, sem controle/NUL, sem nome reservado de FS, sem início com `.`);
2. `validarConjunto` valida o **lote** antes de qualquer efeito e detecta **colisão
   case-insensitive** (`P0-1` vs `p0-1`);
3. `resolverDestino` confere contenção por `realpath` do ancestral existente (symlink de
   diretório não escapa);
4. `gravarSemSeguirSymlink` grava com `O_NOFOLLOW` + temporário imprevisível no mesmo diretório +
   `rename` (não segue symlink de destino, não deixa arquivo parcial).
O regularizador usa esse contrato em **todo** caminho derivado de id (log, draft, item,
relatório por escopo) e valida também `--only` e `--id` (allowlist).

**Teste vermelho→verde.** `tests/unit/governance/regularizadorPathTraversal.test.js` (9 testes):
14 ataques recusados com motivo; snapshot sha256 da árvore externa **idêntico** antes/depois (e
nenhum dos alvos de escape criado); symlink de diretório e de destino recusados com vítima
intacta; os **135 ids históricos da fila** continuam válidos; contrato de fonte impede
concatenação crua.

### P1-B — Agregação de evidências incompatíveis

**Causa-raiz.** O relatório agregado era montado lendo **todos** os arquivos de um diretório
compartilhado (`.../bug-closure-regularization/itens/`). Uma execução parcial reutilizava
resultados de execuções anteriores — outro commit, outro fingerprint — e o agregado passava a
parecer cobertura integral.

**Correção.** Novo `scripts/governance/lib/regularizationRun.js`:
- cada execução tem `runId` (contrato `^run-\d{14}-[0-9a-f]{8}$`), diretório próprio
  `runs/<runId>/` e `manifest.json` com identidade (`commit`, `sourceFingerprint`,
  `inventoryFingerprint`, `testManifestFingerprint`, versão do regularizador, escopo, ambiente,
  início/fim, status);
- cada resultado carrega `runId`, a identidade e `artifactSha256` do próprio conteúdo;
- `agregar()` é a **única** forma de combinar execuções (`--agregar`) e recusa execução ausente,
  **incompleta** (`RUNNING`), **sem resultados**, identidade divergente (commit/fingerprints), **id
  duplicado** entre execuções e **artefato adulterado** (hash não confere);
- cobertura integral exige `escopo.tipo === 'INTEGRAL'` **e** a lista explícita
  `escopo.idsEsperados` coberta **exatamente** pelos artefatos (sem repetição, mesma
  cardinalidade) — recalculada dos artefatos, nunca aceita do manifesto;
- relatório de execução parcial **não** substitui o agregado canônico e se declara
  `cobertura PARCIAL (não cobre o inventário)`.

**Testes.** `regularizadorRunIsolation.test.js` (19 testes) cobre os 5 cenários exigidos
(SHA diferente, fingerprint diferente, evidência adulterada, execução interrompida, execuções
concorrentes) + parciais que não fingem integral + recálculo de completude + contrato de `runId`.

### P1-C — Preflight de âncoras bloqueante

**Causa-raiz.** `.github/workflows/release-governance.yml` tinha `continue-on-error: true` no
passo "Preflight das âncoras do Bug Closure". O script já devolvia exit 1; o Actions ignorava e
`release-gate` imprimia "Release autorizado".

**Correção.**
1. passo do preflight **sem** `continue-on-error`, com `set -o pipefail`, publicando atestação;
2. `release-gate` **revalida as âncoras por conta própria** (checkout + `--check`) antes de
   declarar release autorizado — defesa em profundidade contra job que pule o passo;
3. `release-gate` **baixa e exige** a atestação do preflight (`kind`, `ok`, `commit ==
   GITHUB_SHA`, `runId == GITHUB_RUN_ID`, 3 âncoras presentes);
4. únicos `continue-on-error` restantes são **uploads de diagnóstico** (provado por teste).

**Testes.** `releaseAnchorsPreflightBlocking.test.js` (14): o YAML é lido com **parser**, os
passos são extraídos, o **comando real** do preflight é executado e a **semântica do Actions** é
aplicada (passo vermelho derruba o job). Âncora ausente/vazia/malformada/divergente ⇒ exit 1 com
motivo; âncora válida em fixture ⇒ exit 0; cenário adversário "alguém reintroduz
`continue-on-error`" continua bloqueado pela revalidação do gate. Caminho DEVELOPMENT
(`dev-branch-ci.yml`) não depende de âncora de release.

### P1-D — Prontidão com checks vazios

**Reprodução (antes, contrato direto).**

```
decidirVeredito({ checks: [],            aprovacaoHumana: true }) → READY_GO (exit 0)
decidirVeredito({                        aprovacaoHumana: true }) → READY_GO   (checks undefined)
decidirVeredito({ checks: [{id:'fake', ok:true}], aprovacaoHumana: true }) → READY_GO
decidirVeredito({ checks: null,          aprovacaoHumana: true }) → TypeError (crash)
```

**Correção.** `CHECKS_OBRIGATORIOS` (21 ids) e decisão que exige **cobertura explícita**:
`checks` ausente/vazio, id desconhecido ou duplicado, `ok` não-booleano, `detalhe` vazio (sem
evidência), status `UNKNOWN|NOT_EXECUTED|TIMEOUT|SKIPPED|BLOCKED|ERROR` (com `trim`) e check com
identidade de outro commit ⇒ `NOT_READY`. Aprovação humana continua **necessária** para GO e
**nunca** suficiente. O gate passou a registrar cobertura explícita também nos caminhos felizes
(`QUEUE_EVIDENCE_READABLE`) e "não aplicável" quando não há assinatura
(`HUMAN_APPROVAL_ANCHORED/VALID`), para que "não medi" e "deu certo" deixem de ser
indistinguíveis no JSON.

**Testes.** `readinessChecksContract.test.js` (37) + `engineerSupervisedReadinessGate.test.js`
(7). Gate real executado: veredito `NOT_READY`, exit 1 (fail-closed).

### P1-E — Checkout limpo: timeout e contaminação de RAG

**E1 (causa-raiz).** `cenarioBancoIndisponivel` aceitava `exitCode === null` como "falhou
fechado" e marcava **PASS** — `null` acontece por timeout, sinal, spawn falho ou processo
travado; nenhum prova que a aplicação falhou **pelo motivo esperado**.

**E1 (correção).** Novo `scripts/ci/lib/resultClassification.js` com as 9 classes exigidas
(`EXPECTED_SUCCESS`, `EXPECTED_FAILURE`, `EXPECTED_FAILURE_SEM_ASSINATURA`,
`UNEXPECTED_SUCCESS`, `UNEXPECTED_FAILURE`, `TIMEOUT`, `SIGNALLED`, `NOT_EXECUTED`,
`INFRASTRUCTURE_ERROR`) e `vereditoDoRun` com precedência de `BLOCKED`. O cenário agora exige a
**assinatura do motivo** (`ECONNREFUSED`, `password authentication failed`, `does not exist`,
`getaddrinfo`, `persistence_required`); timeout/sinal reprovam. `passo()` registra classe e
motivo no relatório.

**E2 (causa-raiz).** Se o RAG isolado não subia, o ambiente caía em `http://127.0.0.1:8001` — o
serviço do desenvolvedor.

**E2 (correção).** Sem fallback em nenhum ponto: porta reservada é verificada (`portaOcupada`),
`docker inspect` do container **deste run** é obrigatório, `/health` é registrado por hash como
identidade observada, e qualquer falha de provisionamento vira `ErroDeInfraestrutura` ⇒ veredito
`BLOCKED` (exit 3). O ambiente inicial aponta para `127.0.0.1:1` (porta morta), nunca para 8001.

**Testes.** `cleanCheckoutTimeoutRag.test.js` (18), incluindo **processos reais**: travado até o
timeout ⇒ `TIMEOUT`; morto por `SIGKILL` ⇒ `SIGNALLED`; exit 1 sem assinatura ⇒
`EXPECTED_FAILURE_SEM_ASSINATURA`.

---

## 3. Testes

| Conjunto | Comando | Exit | Resultado |
|---|---|---|---|
| Suítes da missão | `npx jest tests/unit/governance/regularizadorPathTraversal regularizadorRunIsolation readinessChecksContract cleanCheckoutTimeoutRag releaseAnchorsPreflightBlocking --ci` | **0** | **127 passed / 5 suites** |
| Bug closure + missão | `npx jest tests/unit/governance/bugClosure regularizador* readiness* cleanCheckout* releaseAnchors* engineerSupervised* --ci` | **0** | **446 passed / 18 suites** |
| L0 completo (nova) | `ENGINEERING_RUNNER_URL=http://127.0.0.1:8090 npx jest tests/unit --bail=0` | **1** | **9524 passed / 42 failed / 2 skipped (9568)** |
| L0 completo (base `484eee478`) | idem, worktree limpo | **1** | **9417 passed / 48 failed / 2 skipped (9467)** |
| L1 (DEVELOPMENT) | `node scripts/ci/dev-branch-gate.js --fases A,D` | **0** | **PASS_PARCIAL** (10 checks de pré-voo OK; 4 gates L1 verdes) |
| Gate de Bug Closure | `node scripts/governance/validate-bug-closure-status.js` | **1** | `mecanismo: recusa como deve`, `guardas 9/9`, `FAIL: FECHAMENTO_NAO_PROVADO` (130) — fail-closed correto |
| Inventário | `node scripts/governance/audit-bug-closure-inventory.js` | **0** | 130 declarando fechamento sem prova; âncoras ausentes |
| Persistência JSON | `npm run audit:json-persistence` | **0** | `PASS`, `unknown: 0` (569 alvos) |

**Sobre as 42 falhas de L0.** Nenhuma é regressão: são dependentes de artefato de bootstrap
(`reports/*.json` gerados por outros validadores) e de infraestrutura. Prova em dois passos:
1. o conjunto de suítes vermelhas difere da base nas **duas** direções (4 suítes falham só na
   minha árvore, 4 só na base) — comportamento de ordem/artefato, não de código;
2. as 4 suítes que falham só na minha árvore **passam isoladas em AMBAS as árvores**
   (`backupImportExportEndpoints`, `benchmarkCertificationAuthority`,
   `benchmarkSemanticVersionGate`, `publicStorefrontPhysicalEndpoints` → exit 0 nas duas).
Evidência: `l0-comparativo.txt`, `l0-delta.txt`, `l0-suites-novas-em-relacao-a-base.txt`.

**Testes não executados (declarados).** L2 (`test:system`), L3 (agregado de governança),
`coverageCompletenessCanonicalDomains` e `ci:clean-checkout` completo (exige Docker + Postgres +
Redis provisionados pelo harness) — `NOT_EXECUTED` neste ambiente. Nenhum deles foi contado como
PASS.

---

## 4. Ataques (matriz executada)

| # | Ataque | Resultado |
|---|---|---|
| 1 | `../../outside`, `../../../tmp/evil`, `..\..\outside`, `/tmp/absolute`, `a/../../b`, `....//....//etc`, NUL, vazio, espaços, 121 chars, `.oculto`, `..`, `C:\Windows\System32` | **recusados** com motivo próprio; nada criado fora da raiz (snapshot sha256 idêntico) |
| 2 | symlink de diretório para fora / symlink no destino | **recusado**; vítima intacta |
| 3 | colisão `P0-1` vs `p0-1` | **recusada** |
| 4 | ids históricos legítimos (135 da fila) | **aceitos** (compatibilidade preservada) |
| 5 | agregação com SHA divergente | **recusada** `IDENTIDADE_INCOMPATIVEL:commit` |
| 6 | agregação com fingerprint divergente | **recusada** `IDENTIDADE_INCOMPATIVEL:sourceFingerprint` |
| 7 | artefato editado sem recalcular hash | **recusada** `ARTEFATO_ADULTERADO` |
| 8 | execução interrompida (RUNNING) | **recusada** `EXECUCAO_INCOMPLETA` |
| 9 | id duplicado entre execuções | **recusada** `ID_DUPLICADO_ENTRE_EXECUCOES` |
| 10 | manifesto forjado `completo:true` sem artefatos | **recusada** `EXECUCAO_SEM_RESULTADOS` |
| 11 | manifesto mentindo `completo` com 1 de 3 artefatos | `ok:true`, **`completo:false`** |
| 12 | N artefatos com ids distintos e conteúdo repetido | **não** vira cobertura integral |
| 13 | `--agregar ../../../evil` | **recusado** `RUN_ID_FORA_DO_CONTRATO`, exit 3 |
| 14 | `--only "x/../../y"` | **recusado**, exit 2 |
| 15 | `--id "../../evil"` | **recusado**, exit 2 |
| 16 | âncora ausente/vazia/malformada/divergente (script real) | **exit 1** com achados |
| 17 | reintroduzir `continue-on-error` no preflight | gate **ainda falha** (revalidação independente) |
| 18 | `decidirVeredito` com `[]`, `null`, `undefined`, `[{}]`, `[{status:'PASS'}]`, `[{id:'fake'}]`, `'PASS'`, `42` + aprovação humana | **todos NOT_READY** |
| 19 | catálogo incompleto / id desconhecido / duplicado / `ok` não-booleano / detalhe vazio | **NOT_READY** |
| 20 | status `UNKNOWN/NOT_EXECUTED/TIMEOUT/SKIPPED/BLOCKED/ERROR` (com espaço e case variados) | **NOT_READY** |
| 21 | check declarando outro commit | **NOT_READY** |
| 22 | `catalogo: []`/`null` tentando desligar as guardas | **NOT_READY** (cai no catálogo canônico) |
| 23 | processo travado até timeout / morto por SIGKILL | **TIMEOUT / SIGNALLED** (nunca PASS) |
| 24 | exit 1 sem a assinatura do motivo | **EXPECTED_FAILURE_SEM_ASSINATURA** (nunca PASS) |
| 25 | qualquer caminho para RAG preexistente em 8001 | **nenhum** (5 ocorrências restantes são comentários; teste garante) |

**Bypasses encontrados e corrigidos pela revisão adversarial independente (5 passadas, 30 achados):**

| Passada | Achados | Exemplos |
|---|---|---|
| 1ª | 5 (2 bloqueantes) | cobertura INTEGRAL declarada sem artefatos; `runId` com traversal em `--agregar`; `catalogo: []`/`null` desligando guardas; atestação publicada e não consumida |
| 2ª | 9 | `>= N` artefatos satisfeito com ids distintos e conteúdo repetido; symlink em `runs/`; `vereditoDoRun([])` = PASS; `--agregar` sobrescrevia o canônico ao recusar |
| 3ª | 7 | CLI e `agregar` comparavam fontes diferentes de inventário (toda execução genuína virava PARCIAL); cobertura relativa ao escopo do manifesto; `itens/` symlink lia **e escrevia** fora; `sandbox-sem-docker` apontava para teste **inexistente** |
| 4ª | 5 | INTEGRAL com `limite`/filtro = cobertura de **subconjunto**; `tests/integration/engineering` inexistente em `--with-integration`; `manifest.json` symlink; manifesto sem `identidade` lançava TypeError |
| 5ª | 8 (1 próprio + 7 do parecer) | temporário do manifesto órfão em falha de escrita; Jest **une** posicional e `--testPathPattern` (167 em vez de 40 suítes); short write silencioso; `finalizar` marcando completo com `idsEsperados` curto; manifesto sem `escopo` lançando TypeError |

Cada um com reprodução antes, correção e regressão própria. Os que não são corrigíveis neste
modelo estão declarados na §8.

---

## 5. Governança

- **Integridade das provas:** livro de transições íntegro (`integridadeOk=true`, 0 eventos neste
  worktree), diário **não** corrompido, nenhuma operação pendente de recuperação. O Bug Closure
  First foi exercitado pelas suítes de regressão (`bugClosure*`, 288+ testes) sem alteração de
  contrato.
- **Estado do Bug Closure First:** `validate:bug-closure-status` **FAIL** com
  `FECHAMENTO_NAO_PROVADO` (130) — fail-closed correto, **não** convertido em sucesso.
- **Os 130 defeitos históricos:** **nenhum** `state`/`status` foi alterado por esta missão. Os
  drafts aparecem como `INVALID_EVIDENCE` neste SHA porque o `sourceFingerprint` mudou
  (código mudou ⇒ prova stale) — é o invariante funcionando, não edição de estado. Regenerar
  exige reexecutar as suítes no commit final e a assinatura continua humana.
- **Gates:** L0 comparado com a base (sem regressão de suíte); L1 `PASS_PARCIAL`;
  `audit:json-persistence` PASS; `SELO_FINAL` **DENIED** (âncoras não provisionadas).

---

## 6. Roteador Engenheiro / segregação

- Regressão executada: `tests/unit/engineeringRouter` + `tests/integration/engineeringRouter`
  com `ENGINEERING_RUNNER_URL` real — **313 passed / 1 failed**, e a única falha
  (`engineeringRouterFullLoopE2E`) **passa isolada** (ordem/artefato).
- `engineeringRouterSafeEnvironment` (sandbox + redação de output) **passa** com o runner
  disponível; sem runner o teste falha fechado (`SANDBOX_UNAVAILABLE`) — comportamento esperado,
  idêntico na base.
- Impacto em **Engineering Mission/Memory**: nenhum arquivo dessas áreas foi tocado; as mudanças
  ficam em `scripts/governance/`, `scripts/ci/`, `governance/bug-closure/` e no workflow de
  release.
- **Segregação operacional:** `PRODUCTION`/`SUPPORT` não foram alterados; nenhuma alteração em
  `api/` ou no roteamento de experiência. O caminho DEVELOPMENT (L0/L1) continua independente das
  âncoras de release (provado por teste).
- **RAG:** a correção **elimina** a possibilidade de usar serviço preexistente no harness, o que
  reforça (não enfraquece) a segregação operacional × interno.

---

## 6.1 Parecer da revisão independente (5 passadas)

Todas as 5 passadas foram feitas por agente **separado**, read-only, com o diff e as instruções
da missão, sem acesso ao meu raciocínio:

- 1ª: `CHANGES_REQUIRED` (2 bloqueantes) → 5 achados
- 2ª: `CHANGES_REQUIRED` (2 bloqueantes + 1 funcional) → 9 achados
- 3ª: `CHANGES_REQUIRED` (2 funcionais) → 7 achados
- 4ª: `CHANGES_REQUIRED` para `eb91b1780`; declarou que o commit seguinte fechava o bloqueante → 5 achados
- 5ª: **`APPROVED`**, com a frase: *"Não encontrei vulnerabilidade de segurança explorável nas
  mudanças revisadas dentro do modelo de ameaça declarado."*

## 7. Limitações do ambiente

1. L2/L3 e `ci:clean-checkout` completo não executados (`NOT_EXECUTED`) — exigem Docker,
   Postgres e Redis provisionados pelo próprio harness.
2. Quatro suítes de L0 dependem de artefatos de bootstrap e falham no agregado por ordem de
   execução; passam isoladas nas duas árvores.
3. `ENGINEERING_RUNNER_URL` aponta para o runner do host (`:8090`); sem ele as suítes de sandbox
   falham fechadas.
4. Nenhuma âncora de confiança está provisionada — todo caminho certificante permanece `DENIED`.

## 8. Riscos residuais (não corrigíveis neste modelo)

1. **Identidade de execução é auto-declarada.** `manifest.json` e `artifactSha256` são calculados
   pelo próprio executor: quem reescrever manifesto + itens **e recalcular os hashes** passa. A
   agregação é detecção de erro **operacional**, não controle anti-adulteracão deliberada; isso
   está escrito no código.
2. **Preflight valida forma, não correspondência.** `--check` confere 64 hex + digest do
   inventário; `aaaa…` com o digest correto dá exit 0. Prova presença/forma da âncora, não que ela
   corresponde a uma chave real.
3. **Identidade do RAG** amarra "nosso container existe **e** algo responde `/health` na porta";
   um endpoint autenticado por `RAG_INTERNAL_TOKEN` fecharia a janela teórica de corrida de porta.
4. **`gravarSemSeguirSymlink`** protege o arquivo (`O_NOFOLLOW`), não o diretório pai — TOCTOU
   exigiria escritor local já dentro da árvore.
5. **Assinaturas de falha do cenário de banco** são genéricas (`does not exist`, `getaddrinfo`);
   PASS pelo motivo semanticamente errado continua possível.
6. **`gravarResultado`/`finalizar`** são API pública sem contrato próprio de id/contagem — hoje o
   regularizador valida antes; um chamador futuro precisa repetir a validação.
7. **`RAP_CLOSURE_INVENTORY_SHA256` não é consultado** na agregação: a fila que define os
   candidatos é o arquivo do `rootDir`. Fila vazia é fail-closed; fila **curta** permite
   "cobertura integral" de um inventário legitimamente menor.
8. **`carregarInventario` no agregado** roda com o contexto de prova do repositório do **módulo**,
   não do `rootDir`: agregar evidência de outra árvore deriva candidatos do estado do módulo.
9. **TOCTOU da fila:** digest e derivação de candidatos leem o arquivo em dois momentos; um
   escritor concorrente pode fazê-los divergir.
10. **Hardlink não é detectado** por `lstat` e um `runs/` simbólico é resolvido e aceito —
    exploração exige escrita no diretório de evidência.
11. **`sinaisAceitos`** pode aprovar morte por sinal sem assinatura (sem chamador hoje);
    `PENDING_HUMAN_APPROVAL` é inalcançável no gate real (checks `NOT_EXECUTED` ⇒ `NOT_READY`),
    por desenho fail-closed.

## 9. Veredito

**`PARTIALLY_VERIFIED`**

Os cinco grupos P1 estão corrigidos, com reprodução antes, teste vermelho→verde, ataques reais
(25 vetores) e revisão adversarial independente em **cinco passadas** (30 achados, todos
tratados ou declarados como limite; parecer final `APPROVED`). O que impede `DEVELOPMENT_VERIFIED`:
- **L2/L3 e `ci:clean-checkout` completo: `NOT_EXECUTED`** neste ambiente (critério de aceitação
  exige L0 **e** L1 relevantes aprovados — L0 tem 42 falhas pré-existentes dependentes de
  artefato, L1 está `PASS_PARCIAL`, não `PASS`);
- 4 suítes de L0 dependem de artefato de bootstrap e não ficam verdes no agregado;
- os 130 defeitos históricos seguem sem prova válida (nada assinado, nada ancorado).

**`RELEASE_CERTIFICATION = NO_GO`**
**`MAIN_MODIFIED = FALSE`** — verificado: `git log origin/main` inalterado; todo o trabalho está
na branch `codex/p1-governance-hardening-20261023`; nenhum push.
**`PUBLISHED = FALSE`** — nenhum `release:seal`, `zip:release`, tag, imagem ou deploy executado.
