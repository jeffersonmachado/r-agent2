# Política de build local (imagens Docker)

**Status:** canônica e bloqueante
**Fonte canônica da política:** [`AI_MEMORY/deployment-rules.md`](../../AI_MEMORY/deployment-rules.md) — seção *Docker image build policy*
**Enforcement executável:** `npm run validate:local-build-policy` (bloqueante; incluído em `npm run validate:governance-enforcement`)

## Regra

> O build das imagens Docker é **SEMPRE local** — na workstation do operador ou no CI.
> O host de produção **nunca** constrói: ele apenas carrega imagens já prontas e sobe o stack.

O servidor de produção **não** é ambiente de build. Isso é uma regra de arquitetura, não uma preferência.

## Por que

- Builds remotos re-baixam `torch` e dependências npm sem cache e são ordens de magnitude mais lentos.
- O contexto de build não existe Íntegro no servidor: `vendor/`, `pbx/` e os `excludes` do rsync não chegam lá, então o build quebra.
- O build consome CPU e memória do host que está atendendo produção.
- Artefato construído no host de produção não tem proveniência verificável: não é o mesmo binário auditado, assinado e listado no manifesto SHA-256 do release.

## Fluxo correto

1. **Construir localmente** (workstation/CI):

   ```bash
   ./scripts/docker-deploy.sh --prod --build
   ```

   O script constrói as imagens localmente com os Dockerfiles do repositório
   (`r-agent2-api-base:test` → `r-agent2-api`, `r-agent2-frontend` com
   `VITE_BASE_PATH=/r-agent2/`, `r-agent2-rag-service`, `r-agent2-asterisk`,
   `r-agent2-redis`) e, no caminho oficial por artefato, o
   `tools/system/deploy.js` executa `npm run deploy:build` **na máquina local**,
   a partir do artefato extraído.

2. **Transferir as imagens** para o servidor — nunca o código-fonte para build:

   ```bash
   docker save <imagem>:latest | gzip | ssh root@<host> 'gunzip | docker load'
   ```

3. **Subir o stack no servidor sem build** (fail-closed):

   ```bash
   docker compose -f docker-compose.prod.yml up -d --no-build
   ```

   `--no-build` é obrigatório em toda subida remota: se a imagem estiver
   ausente no host, o deploy **falha** em vez de tentar construir lá.

## Proibições explícitas

- `NUNCA` executar `docker build` no host de produção.
- `NUNCA` executar `docker compose build` no host de produção.
- `NUNCA` executar `docker compose up` sem `--no-build` no host de produção.
- `NUNCA` executar `npm run deploy:build*` no host de produção — esses scripts são
  para a máquina local/CI (produzem as imagens que depois são transferidas).

Os comandos `npm run deploy:build*` existem para o **build local**; `npm run deploy:up`
usa `--no-build`. Para deploy real, o caminho oficial é
`npm run deploy:remote:ssh` (build local + transferência + `up --no-build`).

## Enforcement

`npm run validate:local-build-policy` verifica, a cada gate de governança:

- `scripts/docker-deploy.sh`: mantém o invariante declarado, usa `--no-build` em
  toda subida de stack e não executa build via `ssh`;
- `package.json`: `deploy:up` usa `--no-build` e nenhum script npm builda via `ssh`;
- `tools/system/deploy.js`: não builda via `ssh` (build é local, a partir do artefato);
- `DEPLOYMENT_CHECKLIST.md`: referencia esta política e declara que o servidor não constrói;
- `AI_MEMORY/deployment-rules.md`: mantém a âncora canônica da política.

Relatório: `reports/local-build-policy-report.json`.

## Relacionados

- [`AI_MEMORY/deployment-rules.md`](../../AI_MEMORY/deployment-rules.md) — política canônica, deploy diferencial e histórico de incidentes.
- [`DEPLOYMENT_CHECKLIST.md`](../../DEPLOYMENT_CHECKLIST.md) — checklist operacional de deploy.
- [`docs/release/NPM_DEPLOY.md`](../release/NPM_DEPLOY.md) — deploy por pacote npm.
