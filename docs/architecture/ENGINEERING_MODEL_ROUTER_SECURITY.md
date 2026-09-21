# ENGINEERING_MODEL_ROUTER_SECURITY.md

## Modelo de ameaça

Conteúdo do repositório, saída de teste e resposta do LLM são tratados como **dado não
confiável** (`UNTRUSTED DATA`). O Router se protege contra: prompt injection via código-fonte,
saída de teste maliciosa, injeção de shell, path traversal, traversal de patch, exposição de
segredo, dump de ambiente, vazamento de credencial.

## Camadas de proteção reais (não aspiracionais — testadas)

### 1. Segredo nunca sai do disco para o modelo
`engine/engineeringRouter/secretRedaction.js`:
- Bloqueio total de arquivo por nome (`.env`, `.token.env`, `credentials.json`, `secrets/**`,
  chaves privadas, `.npmrc`/`.pypirc`) — o arquivo nem entra no contexto.
- Redação por padrão de valor (chaves de API conhecidas: AWS, OpenAI-style, Anthropic-style,
  GitHub, Slack, Google; atribuições `PASSWORD=`/`SECRET=`/`TOKEN=` com valor real, não
  placeholder).
- Testado em `tests/unit/engineeringRouterSecretRedaction.test.js` e
  `tests/unit/engineeringContextBuilder.test.js`.

### 2. Escopo de patch (path boundary)
`engine/engineeringRouter/pathBoundary.js` + `patchValidator.js`: um patch só é aceito se todo
caminho tocado casar com `allowedPaths` do Task Contract E nenhum com `forbiddenPaths`
(forbidden sempre vence). Violação → `PATCH_OUTSIDE_ALLOWED_SCOPE`, patch rejeitado antes de
qualquer aplicação. Testado com o exemplo real da missão (task autorizada só em
`scripts/governance/**`/`qa-mesh/**` não pode tocar `frontend/**`/`verticals/**`).

### 3. Patch precisa ser um diff real, nunca texto livre
`patchValidator.parseUnifiedDiff`/`validatePatch`: exige `diff --git`/hunks válidos, rejeita
alteração binária, rejeita delete não autorizado, rejeita arquivo sensível mesmo dentro do
escopo, limite de tamanho (200KB por padrão).

### 4. Aplicação sempre em workspace isolado
`patchApplyService.js`: `git worktree` isolado a partir de um snapshot (nunca o working tree
principal). `git apply --check` roda antes de aplicar de verdade. Workspace é destruído ao
final de cada tentativa (`destroyWorkspace`), inclusive em caminho de erro.

### 5. Comando de teste nunca é arbitrário
`engine/engineeringRouter/commandPolicy.js`: allowlist positiva de prefixo (`npm test`,
`npm run test*`, `npx jest`, `node scripts/`, `git diff`/`status`/`apply --check`) **e**
blocklist de padrões perigosos como defesa em profundidade (`rm -rf`, `curl | sh`, `git push`,
`git merge`, `npm publish`, `docker push`, `sudo`, dump de ambiente via `env`/`printenv`, etc.)
— um comando é rejeitado se bater em QUALQUER padrão perigoso, mesmo com prefixo permitido
(ex.: `npm run test:unit && rm -rf /` é rejeitado). O modelo NUNCA declara os `testCommands` —
eles vêm do Task Contract (humano/policy), não de texto gerado em runtime.

### 6. LLM nunca é a autoridade de PASS
Test Runner: só o `exitCode` real decide PASS/FAIL (`testRunnerService.runTestCommands`).
Reviewer: decisão estruturada fechada (`APPROVE`/`REJECT`), nunca texto livre interpretado —
`reviewerService.validateReviewShape` rejeita qualquer resposta fora do contrato JSON exigido.

### 7. Independência de provider para risco alto
`modelSelector.selectCoderAndReviewer`: para `HIGH`/`CRITICAL` (ou `requiresIndependentReview:
ALWAYS` na policy), reviewer é forçado a um provider diferente do coder quando há candidato
qualificado. Se impossível, registra `INDEPENDENT_PROVIDER_UNAVAILABLE` explicitamente — nunca
finge independência.

### 8. Sem escalada de privilégio de rede/publicação
O Router nunca executa `git push`, merge ou publicação de release — produz patch/workspace
GREEN; a integração final segue o pipeline oficial (`npm run system:release`) fora do escopo
desta missão.

### 9. Autorização em profundidade
`api/middleware/requireClassification.js` (`DEVELOPMENT`) é exigido em toda rota, validado no
backend — nunca confia no frontend. Um usuário `PRODUCTION` recebe 403 estruturado mesmo que
tente acessar a API diretamente por URL.

## O que NÃO está coberto pela V1 (registrado, não implementado)

- Sandbox de isolamento de processo/rede em nível de SO (o workspace isolado protege o
  filesystem via worktree separado e a rede via ausência de credencial automática, mas não há
  contêiner/namespace dedicado por tentativa). Ver `POST_RELEASE_MODEL_ROUTER_BACKLOG.md`.
- Budget Manager real (custo é `UNKNOWN` quando o provider não retorna `usage`, nunca inventado).
