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


## Lições do primeiro deploy real (2026-08-07, artefato r-agent2-20260807-195511)

Armadilhas encontradas e corrigidas ao executar o deploy real pela primeira vez:

- **npm ci + link `file:../../packages/auth`:** o arborist só resolve o link quando o projeto está a ≥2 níveis da raiz do filesystem. Builds com `WORKDIR /app` (profundidade 1) quebram com EUSAGE (TypeError em `#loadLink`). Por isso `api/Dockerfile` builda em `/build/r-agent2` e materializa o pacote irmão a partir de `vendor/auth/` (builder: `/build/packages/auth`; runtime: `/packages/auth`, alvo do symlink relativo em `node_modules/@results/auth`). Nunca rodar `npm prune/ci` no estágio runtime em `/app`.
- **Excludes de cobertura no empacotador:** padrões rsync/regex não ancorados (`coverage/`, `**/coverage/`, `(^|/)coverage/`) suprimiam `qa/coverage/` (código-fonte do Coverage Engine) do payload → `MODULE_NOT_FOUND` no container. Âncoras atuais: `/coverage/`, `/frontend/coverage/` (rsync) e `^([^/]+/)?(frontend/)?coverage/` (forbidden-regex). `qa/coverage/` e `tests/unit/coverage/` são código e devem permanecer no payload.
- **`src/` na imagem:** a API exige `src/core/**` (Cognitive Core, learning); o `api/Dockerfile` precisa do `COPY src/` nos dois estágios.
- **Jest zumbi no system:validate:** qualquer teste que crie cliente Redis real (`getRateLimitClient`) sem `closeRateLimitClient()` mantém TCPWRAP aberto e o Jest nunca sai após "463 passed" — o step `backend unit` pende por horas. Intermitente: só trava quando o Redis está acessível.
- **dist/ vazio quebra platform-readiness:** se uma run do `system:release` morre após `zip:release:clean` apagar os ZIPs e antes de recriar, a próxima run falha em `artifact_missing:none_found_in_dist`. Recuperação: rodar `zip:release:clean` standalone e depois fechar a cadeia (runtime:clean → platform-readiness → package-validator → release-gate → go-no-go → release-manifest → release-summary), com a API dev parada para não recriar resíduo de runtime entre o clean e o readiness.
- **Portas na máquina de dev:** o deploy resolve portas automaticamente (`tools/system/deploy.js` PORT_SPECS; API candidatas 3001→3101→...). Com a API dev fora do ar, a prod toma a 3001. Padrão adotado: **prod na 3101, dev na 3001** (override `API_PUBLIC_PORT=3101` no `docker compose up -d api` a partir do payload extraído).
- **Pré-validação de imagem:** antes de queimar uma run de release, validar o grafo de módulos na imagem: `docker run --rm --entrypoint node -e RUNTIME_ROOT=/var/lib/ragent2 <imagem> -e "require('/app/api/app/registerRoutes.js'); console.log('OK')"`.
