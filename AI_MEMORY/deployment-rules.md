# Deployment Rules

## Canonical deployment path

- Build/validate with `npm run system:release`.
- Deploy only from approved release artifact through `npm run system:deploy`.
- For pre-deploy gate use `npm run deploy:gate:official`.
- Real deploy requires explicit `SYSTEM_DEPLOY_EXECUTE=1`.

## Sources

- `docs/release-contract.md`
- `docs/DEPLOY_PRODUCAO.md`
- `docs/DEPLOY_DOCKER_COMPOSE.md`
- `docs/DOCKER_DEPLOY.md`
- `docs/operations/README_DEPLOY.md`
- `scripts/deploy-gate.sh`
- `tools/system/deploy.js`

## Rule

No deployment may bypass package validation, runtime governance, release gate and approved artifact manifest.

## Docker image build policy (canônica, 2026-09-08)

- **NUNCA construir imagens Docker no servidor remoto.** O host de produção apenas carrega imagens prontas e sobe o stack.
- O build é SEMPRE local (workstation/CI): `scripts/docker-deploy.sh --prod --build` constrói localmente (`r-agent2-api-base:test` → `r-agent2-api`, `r-agent2-frontend` com `VITE_BASE_PATH=/r-agent2/`, `r-agent2-rag-service`, `r-agent2-asterisk`, `r-agent2-redis`) e transfere via `docker save | gzip | ssh 'gunzip | docker load'`.
- O `docker compose up` remoto roda com `--no-build` (fail-closed): se faltar imagem no servidor, o deploy falha em vez de tentar build remoto.
- Motivação: builds remotos são lentos (re-download de torch/npm sem cache), quebram por falta de contexto (`vendor/`, `pbx/`, excludes rsync) e consomem CPU/memória do host de produção.
- **Doc operacional canônica da política:** `docs/deployment/local-build-policy.md` (esta seção é a origem; a doc detalha o fluxo e as proibições).
- **Enforcement executável:** `npm run validate:local-build-policy` (bloqueante, incluído em `validate:governance-enforcement`). Verifica `scripts/docker-deploy.sh`, `tools/system/deploy.js`, `package.json`, `DEPLOYMENT_CHECKLIST.md` e esta seção — a doc sozinha não impede regressão.

## Política de deploy diferencial e build sob demanda (2026-09-08)

- **Deploy diferencial inteligente (padrão):**
  - O deploy padrão (`npm run deploy:prod` / `./scripts/docker-deploy.sh --prod --build`) consulta a última release implantada em `releases/latest.txt` do servidor remoto e executa um `git diff` contra o código local.
  - Se nada mudou em relação à release remota, nenhum build é executado e o stack remoto permanece intacto (zero downtime, zero tráfego desnecessário).
  - Se apenas determinados serviços tiveram arquivos modificados (ex.: `frontend/` ou `api/`), o script reconstrói e transfere **apenas as imagens dos serviços desatualizados** e recria exclusivamente esses containers (`docker compose up -d --no-build <servicos>`), mantendo os demais componentes (como Postgres e Redis) em execução contínua.
- **Opção de forçar build total (`--force` / `--force-build`):**
  - Reconstrução completa de todas as imagens só ocorre quando solicitado explicitamente via flag `--force` (`npm run deploy:prod:force` / `npm run deploy:remote:ssh:force`).
- **Deploy sem build (`--no-build`):**
  - Reaplica o stack no servidor remoto com as imagens já existentes, sem compilar ou transferir nada (`npm run deploy:prod:nobuild`).


## Lições do primeiro deploy real (2026-08-07, artefato r-agent2-20260807-195511)

Armadilhas encontradas e corrigidas ao executar o deploy real pela primeira vez:

- **npm ci + link `file:../../packages/auth`:** o arborist só resolve o link quando o projeto está a ≥2 níveis da raiz do filesystem. Builds com `WORKDIR /app` (profundidade 1) quebram com EUSAGE (TypeError em `#loadLink`). Por isso `api/Dockerfile` builda em `/build/r-agent2` e materializa o pacote irmão a partir de `vendor/auth/` (builder: `/build/packages/auth`; runtime: `/packages/auth`, alvo do symlink relativo em `node_modules/@results/auth`). Nunca rodar `npm prune/ci` no estágio runtime em `/app`.
- **Excludes de cobertura no empacotador:** padrões rsync/regex não ancorados (`coverage/`, `**/coverage/`, `(^|/)coverage/`) suprimiam `qa/coverage/` (código-fonte do Coverage Engine) do payload → `MODULE_NOT_FOUND` no container. Âncoras atuais: `/coverage/`, `/frontend/coverage/` (rsync) e `^([^/]+/)?(frontend/)?coverage/` (forbidden-regex). `qa/coverage/` e `tests/unit/coverage/` são código e devem permanecer no payload.
- **`src/` na imagem:** a API exige `src/core/**` (Cognitive Core, learning); o `api/Dockerfile` precisa do `COPY src/` nos dois estágios.
- **Jest zumbi no system:validate:** qualquer teste que crie cliente Redis real (`getRateLimitClient`) sem `closeRateLimitClient()` mantém TCPWRAP aberto e o Jest nunca sai após "463 passed" — o step `backend unit` pende por horas. Intermitente: só trava quando o Redis está acessível.
- **dist/ vazio quebra platform-readiness:** se uma run do `system:release` morre após `zip:release:clean` apagar os ZIPs e antes de recriar, a próxima run falha em `artifact_missing:none_found_in_dist`. Recuperação: rodar `zip:release:clean` standalone e depois fechar a cadeia (runtime:clean → platform-readiness → package-validator → release-gate → go-no-go → release-manifest → release-summary), com a API dev parada para não recriar resíduo de runtime entre o clean e o readiness.
- **Portas na máquina de dev:** o deploy resolve portas automaticamente (`tools/system/deploy.js` PORT_SPECS; API candidatas 3001→3101→...). Com a API dev fora do ar, a prod toma a 3001. Padrão adotado: **prod na 3101, dev na 3001** (override `API_PUBLIC_PORT=3101` no `docker compose up -d api` a partir do payload extraído).
- **Pré-validação de imagem:** antes de queimar uma run de release, validar o grafo de módulos na imagem: `docker run --rm --entrypoint node <imagem> -e "require('/app/api/app/registerRoutes.js'); console.log('OK')"`.
- **Delta deploy transferia só a última imagem (2026-09-09):** `TRANSFER_IMAGES=(...)` (atribuição) nos cases rag-service/asterisk/redis de `scripts/docker-deploy.sh` resetava o array montado pelo build — só redis era transferido e a API subiu stale (MODULE_NOT_FOUND em prod). Corrigido para `+=` e a verificação pós-transferência agora compara **image ID local × remoto** (nome da tag não basta: tag antiga existente no host passava no check por nome).
- **Candidate falho em dist/release/ quebra o próximo release:** um payload de release abortado (ex.: `r-agent2-...payload.zip` com manifest `audit: null`) faz o pre-package platform-readiness falhar com `package_mismatch`/`artifact_candidate_without_audit_passed`. Recuperação: remover o candidato falho de `dist/release/`, restaurar o dist/ do último envelope selado (release+governance+signatures), rodar `bash dist/verifier/verify-enterprise-governance.sh` para regravar `verify-result.json` bindado ao payload bom, convergir e re-rodar o gate.
