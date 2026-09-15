# MCP Research — operação (deployment, modos, runbook)

Operação do container `mcp-research` em produção e em desenvolvimento. Fontes:
`services/mcp-research/Dockerfile`, `docker-compose.prod.yml`,
`services/mcp-research/src/config.js`, `services/mcp-research/src/index.js`,
`api/services/mcp/registerMcpResearchConnection.js`.

## 1. Build da imagem (política bloqueante)

Imagens Docker são **sempre construídas localmente** (workstation/CI) e
transferidas ao servidor via `docker save | ssh 'docker load'` — **nunca**
`docker build`/`docker compose build` no host de produção
(`AI_MEMORY/deployment-rules.md`, `docs/deployment/local-build-policy.md`).

```bash
# contexto de build = RAIZ do monorepo (o Dockerfile copia código reusado da
# plataforma com a mesma estrutura relativa de diretórios)
docker build -f services/mcp-research/Dockerfile -t r-agent2-mcp-research:latest .
docker save r-agent2-mcp-research:latest | ssh <host-prod> 'docker load'
```

Propriedades da imagem (verificadas pelo gate): multi-stage
(`deps` → `runtime`), `node:22-alpine`, deps pinadas (`npm ci --omit=dev
--ignore-scripts` sobre `package-lock.json`), usuário não-root `rap`, sem
segredos nem `.env` na imagem, `HEALTHCHECK` em `GET /health` (30s/5s/3
retries/10s start-period), `EXPOSE 8080`, `CMD node src/index.js`.

## 2. Variáveis de ambiente

Do container (`src/config.js` — fail-closed, tudo validado no boot):

| Env | Default | Obrigatória | Função |
|---|---|---|---|
| `PORT` / `MCP_RESEARCH_PORT` | `8080` | não | porta HTTP |
| `MCP_RESEARCH_MODE` | `ONLINE` | não | `ONLINE` (egress real) ou `OFFLINE` (snapshot, zero egress) |
| `MCP_RESEARCH_TOKEN` | — | **SIM** | bearer serviço-a-serviço; sem ele o processo recusa subir |
| `MCP_RESEARCH_SNAPSHOT_DIR` | — | **SIM em OFFLINE** | diretório do snapshot (`index.json` + `documents/`) |
| `MCP_RESEARCH_TIMEOUT_MS` | `15000` | não | timeout por salto de fetch (100–60000) |
| `MCP_RESEARCH_MAX_BYTES` | `2097152` | não | teto de resposta (1 KiB–16 MiB) |
| `MCP_RESEARCH_MAX_REDIRECTS` | `3` | não | teto de saltos de redirect (0–10) |
| `MCP_RESEARCH_MAX_BODY_BYTES` | `1048576` | não | teto do body do request MCP |
| `MCP_RESEARCH_MAX_RESULTS` | `25` | não | teto de resultados de busca |
| `LOG_LEVEL` | `info` | não | `debug\|info\|warn\|error` (logger JSON no stdout) |
| `MCP_RESEARCH_ALLOW_PRIVATE_NETWORK` | estrito | TEST-ONLY | exceção de política de endpoint — nunca em produção |
| `MCP_RESEARCH_ALLOW_PLAINTEXT_HTTP` | estrito | TEST-ONLY | idem |

Da API (`docker-compose.prod.yml`, serviço `api`):

| Env | Função |
|---|---|
| `MCP_RESEARCH_ENDPOINT` | endpoint do container (default compose `http://mcp-research:8080/mcp`); sem ele o auto-registro é `skipped` explícito |
| `MCP_RESEARCH_TOKEN` | **mesmo valor** do container; a API persiste só a referência (`credentialRef`), nunca o valor |

## 3. Compose e redes

```yaml
mcp-research:
  networks: [rap-internal, rap-research-egress]   # NUNCA r-agent2-network
  expose: ["8080"]                                 # sem porta publicada no host
  volumes: [r-agent2-research-snapshots:/snapshots:ro]
  deploy: { resources: { limits: { cpus: '0.5', memory: 512M },
                         reservations: { cpus: '0.1', memory: 128M } } }
```

- `rap-internal` (`internal: true`): tráfego API ↔ mcp-research, sem egress.
- `rap-research-egress`: **única** saída externa do container de pesquisa.
- A API depende de `mcp-research: service_healthy` no startup.
- O volume de snapshot é **read-only** e o conteúdo é governado fora da imagem.

Subida: `docker compose -f docker-compose.prod.yml up -d mcp-research` (ou o
deploy completo da plataforma). Verificação pós-subida:

```bash
docker inspect --format '{{.State.Health.Status}}' r-agent2-mcp-research-prod
docker compose -f docker-compose.prod.yml exec mcp-research \
  wget -qO- http://127.0.0.1:8080/readiness   # ready:true + checks
```

## 4. Startup e shutdown

- Boot fail-closed: modo inválido, token ausente ou snapshot ausente em OFFLINE
  → `mcp_research_config_invalid` e o processo **não sobe** (exit 1 com a causa
  no stderr).
- `GET /health`: estado do processo. `GET /readiness`: prontidão real — token
  configurado e, em OFFLINE, índice do snapshot legível (503 quando não pronto).
- Shutdown gracioso: SIGTERM/SIGINT → para de aceitar conexões, drena
  keep-alive (`closeIdleConnections`) e sai (0; 1 se a drenagem falhar).
  `restart: unless-stopped` no compose cobre crash loops.

## 5. Modo OFFLINE (zero egress)

Para CI, desenvolvimento sem rede e reprodução determinística:

1. Montar o snapshot em `MCP_RESEARCH_SNAPSHOT_DIR` com o layout:
   - `index.json` — `{ version: 1, documents: [{ url, canonicalUrl, title, snippet, contentType, retrievedAt, domain, sourceType, queryTerms }] }`;
   - `documents/<sha256(url)>.json` — `{ url, contentType, retrievedAt, content }`;
     o nome do arquivo é derivado (`sha256` da URL normalizada) — gerar com
     `snapshotFileName(url)` de `services/mcp-research/src/snapshotStore.js`.
2. Subir com `MCP_RESEARCH_MODE=OFFLINE` e o volume read-only montado.
3. `research_search` busca no índice (conjunção de termos); `research_fetch`
   lê o documento endereçado por URL; ausência →
   `research_offline_snapshot_miss` (nunca fallback para rede). Inspeções e
   evidência funcionam igual (funções puras). O gate executa esse caminho com
   um fixture real (`scripts/governance/mcp-research-gate-smoke.js`).

## 6. Runbook

### Container down / unhealthy

1. `docker ps -a | grep mcp-research`; `docker logs --tail 200 r-agent2-mcp-research-prod`.
2. Boot falhando com `mcp_research_config_invalid`: corrigir a env indicada
   (token ausente é a causa mais comum; em OFFLINE, snapshot dir ausente).
3. Healthcheck falhando com processo vivo: verificar porta (`PORT`),
   memória (limite 512M) e logs de request.
4. Reiniciar: `docker compose -f docker-compose.prod.yml restart mcp-research`
   — é stateless, não há estado a preservar.

### Provider de busca indisponível (search falha online)

- Sintoma: `research_search` devolve erro tipado (`research_fetch_failed` do
  backend de busca). O DuckDuckGo responde 202 (bot-check) a datacenters; o
  provider tem **fallback automático para Bing** (`nativeResearchProvider`).
- Se ambos falharem: o erro sobe tipado ao chamador; o runner de benchmark
  registra `BLOCKED_NO_EXTERNAL_ACCESS` — nunca "zero novidade" fingido.
- Mitigação operacional: repetir mais tarde ou rodar o container em OFFLINE com
  snapshot governado.

### Falha de descoberta MCP (tools/list ou registro)

- Sintoma: a conexão `system/mcp-research` não aparece ou tools ausentes.
- Verificar `MCP_RESEARCH_ENDPOINT` na API; logs `[McpResearchBootstrap]`
  (`persistida`/`reconciliada`/`skipped`).
- Testar a fronteira manualmente a partir da rede interna:
  `curl -H "Authorization: Bearer $MCP_RESEARCH_TOKEN" -X POST http://mcp-research:8080/mcp -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`
  (401 sem bearer é o comportamento correto, verificado pelo gate).
- Drift de config é reconciliado no próximo startup da API (o control plane é a
  autoridade); um disable administrativo nunca é revertido pelo bootstrap.

### Schema de tool mudou

- A paridade 1:1 tool ↔ capability ↔ bootstrap é verificada pelo gate
  (`tool_contract_parity`). Mudança intencional exige atualizar juntos:
  `TOOL_DEFINITIONS`/`TOOL_CAPABILITY_MAP` (container),
  `RESEARCH_CAPABILITIES` (`api/services/benchmark/researchCapabilities.js`) e
  `RESEARCH_TOOLS` (`registerMcpResearchConnection.js`), e rodar o gate.

### Bloqueio de SSRF / DNS / TLS / timeout em fetch

Erros tipados esperados — **não são falha do container**, são a política
agindo:

| Erro | Causa | Ação |
|---|---|---|
| `research_fetch_blocked` / `mcp_endpoint_*` | destino proibido (privado, metadata, protocolo) | revisar a URL; não relaxar a política |
| `research_domain_blocked` / `research_domain_not_allowed` | filtros de domínio do chamador | ajustar `allowedDomains`/`blockedDomains` no chamador |
| `mcp_endpoint_dns_rebinding_detected` | DNS revalidado para IP proibido | tratar como hostil; registrar |
| falha TLS | certificado inválido | nunca contornar com TLS inseguro |
| `research_fetch_timeout` | salto > `MCP_RESEARCH_TIMEOUT_MS` | retry; subir o teto (máx 60000) só se justificado |
| `research_fetch_too_large` | resposta > `MCP_RESEARCH_MAX_BYTES` | esperado para páginas enormes; subir o teto (máx 16 MiB) só se justificado |
| `research_fetch_redirect_blocked` | redirect para destino proibido ou > 3 saltos | tratar destino como hostil ou revisar a cadeia |

### Restart e rollback

- **Restart**: `docker compose -f docker-compose.prod.yml up -d mcp-research`
  (recria com as envs atuais). Stateless: seguro a qualquer momento.
- **Rollback de imagem**: `docker load` da imagem anterior transferida +
  recriar o serviço. Como o container é stateless e o schema de tools é
  versionado com a plataforma, rollback de imagem exige que a paridade de
  contrato continue válida (rodar o gate na versão resultante).
- **Rollback de config**: reverter as envs no compose/`.env` e recriar; a API
  reconcilia a conexão no próximo startup (drift → update).

## 7. Troubleshooting rápido

| Sintoma | Primeira verificação |
|---|---|
| 401 em `/mcp` | token divergente entre API e container (mesma env, dois lugares) |
| 405 em `/mcp` | método errado — só POST (stateless) |
| 413 | body acima de `MCP_RESEARCH_MAX_BODY_BYTES` |
| `research_offline_snapshot_miss` | URL não está no snapshot; regenerar/estender o fixture |
| `research_offline_snapshot_unavailable` | `index.json` ilegível/malformado; readiness fica 503 |
| container sem saída externa | verificar membership de rede — egress só via `rap-research-egress` |
| conexão não registrada | `MCP_RESEARCH_ENDPOINT` ausente → `skipped` explícito nos logs |
