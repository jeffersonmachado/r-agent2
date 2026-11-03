# Parecer do revisor independente — blindagem Bug Closure First

**Data:** 2026-10-22
**Escopo revisado:** commit local `058c17391` (1ª versão) e correções da 2ª passada
(worktree `/tmp/p0-bugclosure`, branch `mission/p0-bug-closure-20261022`)
**Baseline de referência:** `0023634244ad05b3e2a01a61987a244c30ea75b2`

## 1. Veredito da 1ª passada

`CHANGES_REQUIRED` — 2 CRITICAL, 3 HIGH, 2 LOW. O revisor confirmou que os ataques óbvios
**não** funcionam (edição JSON pura, estado/severidade desconhecidos, mutação de campo após
assinar, SHA/fingerprint de outro código, regressão ausente/exit≠0/null/timeout, hash de
artefato divergente, replay/duplicata/reordenação do livro, ator agente, assinante divergente,
`authorities: []`, concorrência com estado obsoleto) e que todos os consumidores internos usam
o inventário migrado. Os achados abaixo são de **borda de confiança**, não do mecanismo central.

## 2. Achados e desfechos

### A1 — CRITICAL — a âncora de confiança estava dentro da árvore gravável

A chave pública era lida de `governance/risk-acceptance/authorities.json`, um JSON que o mesmo
ator que edita a fila pode reescrever. Cenário do revisor: o atacante gera um par de chaves,
registra a pública, assina a própria prova e fecha um P0 com `humanAuthorization: null`,
`negativeEvidence: []` e um teste contendo apenas um comentário — as seis operações
certificantes voltavam `ALLOWED`. A afirmação "o agente não tem a chave privada" era falsa: ele
gera a dele.

**Correção.** `governance/bug-closure/trusted-authorities.js` passa a ser a raiz: a chave só
confere autoridade se a impressão sha256 do SPKI estiver **pinada em código**
(`PINNED_AUTHORITY_FINGERPRINTS`) e, quando `RAP_CLOSURE_TRUST_ANCHOR_SHA256` (âncora externa à
árvore) está definida, se casar com ela. Chave registrada e não pinada ⇒
`SEM_ANCORA_DE_CONFIANCA`. Pinar em código é ato visível (diff + `sourceFingerprint`, que a
própria prova assina) — editar o pin invalida todas as provas existentes.

**Limite declarado.** Este repositório tem `PINNED_AUTHORITY_FINGERPRINTS = []` e nenhuma
âncora externa. Logo a certificação continua **bloqueada**. Isso é o comportamento correto da
missão §5 ("sem âncora confiável, o veredito permanece bloqueado") — não é contorno.

### A2 — CRITICAL — `BUG_CLOSURE_INVENTORY_PATH` era bypass de um comando

`BUG_CLOSURE_INVENTORY_PATH=/tmp/vazio.json node ...` com `{"items":[]}` fazia
`evaluateExecutionEligibility(..., 'SELO_FINAL')` devolver `ALLOWED`, contradizendo o comentário
do próprio módulo ("nenhuma variável de ambiente desliga esta proteção").

**Correção.** O override só é honrado em contexto explícito de teste (`NODE_ENV=test` ou
`JEST_WORKER_ID` presente); fora dele o módulo lança `OVERRIDE_DE_INVENTARIO_RECUSADO` com o
caminho oficial. Execução real (gate, CI, release) nunca depende de env.

### A3 — HIGH — travessia de caminho por `proof.transitionId`

`applyTransition` usava `proof.transitionId` como nome de arquivo: `../../governance/...`
gravava fora do diretório de provas (o revisor citou sobrescrever `authorities.json`), e a prova
de transição intermediária era gravada sem verificação.

**Correção.** `transitionId` tem de ser UUID, validado **antes** da verificação da prova; o nome
do arquivo é derivado do `transitionId` do evento gerado pelo serviço; `path.resolve` +
checagem de prefixo; escrita em `try/catch`; prova anexada a transição que não é fechamento é
recusada (`PROVA_EM_TRANSICAO_NAO_FECHAMENTO`).

### A4 — HIGH — `severityBefore` era auto-declarada

Uma prova de item P0 declarando `severityBefore: 'P3'` escapava de `APROVACAO_HUMANA_AUSENTE` e
de `EVIDENCIA_NEGATIVA_AUSENTE`.

**Correção.** A severidade do **inventário** é a autoridade: divergência ⇒
`SEVERIDADE_DIVERGENTE`; as exigências usam a **maior** severidade entre declarada e de
inventário (declarar menos nunca reduz exigência).

### A5 — MEDIUM/P1 — `QUEUE_NO_OPEN_DEFECT` lia `status` cru

`state:"OPEN"` + `status:"done"` passava por todos os checks novos do gate de readiness.

**Correção.** O check deriva de `carregarInventario().defeitos` (mesma função que certifica) e
há um check novo, `QUEUE_STATE_STATUS_COHERENT`, que mede divergência estrutural `state`×`status`.

### A6 — LOW/P2 — `outputSha256` sem artefato

**Correção.** `executions[].outputPath` é obrigatório e o hash é **recalculado do disco**;
divergência ou ausência ⇒ `EVIDENCIA_ADULTERADA`.

### A7 — LOW/P2 — `prova.fromState` não era confrontado com o estado persistido

**Correção.** `ESTADO_DE_ORIGEM_DIVERGENTE` quando `prova.fromState` ≠ `state` persistido.

## 3. Provas de regressão

Cada achado ganhou teste em `tests/unit/governance/bugClosureBypassDefense.test.js`
(blocos `ALERT 1` … `ALERT 5`). Os testes foram escritos para ficarem **vermelhos** no código da
1ª versão; a suíte completa tem 61 testes e roda em `npx jest tests/unit/governance/bugClosureBypassDefense.test.js`.

## 4. O que NÃO foi alterado

- Nenhum gate foi relaxado, nenhum teste removido, nenhuma lista de bloqueio esvaziada.
- A fila oficial (`AI_MEMORY/hardening-queue.json`) **não** foi editada para "fechar" nada.
- A divergência real encontrada no gate (`MISSAO-B9-CI-GITHUB-ACTIONS`: `state: VERIFIED` com
  `status: blocked_external`) foi **reportada**, não maquiada.
