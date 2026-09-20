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

Estado medido em 2026-09-19 (detalhes em
`AI_MEMORY/finding-research-search-ignores-query.md`): nesta rede o scraping de
HTML está **inoperante** — DuckDuckGo falha no transporte e o Bing responde HTTP
200 com página **alheia à query** ("bakery management software" retornou
eletricistas e tela de login do Google, de forma não determinística). Um
levantamento de nove buscadores gratuitos não encontrou nenhum backend de
scraping viável (403, 429, 500 ou zero resultados).

Comportamento **vigente** da busca online
(`api/services/research/nativeResearchProvider.js` + `apiSearchBackend.js`):

1. **Backends por API vêm primeiro**, na ordem determinística `brave`,
   `google` — um provider só entra na lista quando **todas** as suas variáveis
   estão preenchidas: Brave exige `BRAVE_SEARCH_API_KEY` (chave no header
   `x-subscription-token`, nunca na URL); Google Custom Search exige
   `GOOGLE_CSE_API_KEY` **e** `GOOGLE_CSE_ID`. Sem chave, a lista é exatamente a
   de antes (scraping DDG → Bing), sem quebrar nada.
2. **Guarda de relevância**: HTTP 200 com página alheia à query **não é
   sucesso**. `assessSearchResultRelevance(query, candidates)` (pura) recusa o
   conjunto de um backend quando nenhum candidato compartilha radical com
   nenhum termo significativo da query; o runner cai para o próximo backend com
   motivo nominal `<backend>: search_results_unrelated_to_query (0/N casam ...)`
   em vez de aceitar lixo. Conservadora de propósito: um único acerto aceita o
   backend; query sem termo significativo não decide e não recusa.
3. **Falha honesta**: se todos os backends falharem, o resultado é `n=0` com o
   motivo nominal de cada um (`<backend>: research_fetch_failed`,
   `search_endpoint_http_*`, `search_results_unrelated_to_query`...). O erro
   sobe tipado ao chamador; o runner de benchmark registra
   `BLOCKED_NO_EXTERNAL_ACCESS` — nunca "zero novidade" fingido.

**Classificação `BLOCKED_EXTERNAL`** (2026-09-19): sem chaves de API e com o
scraping inviável, a pesquisa online está bloqueada por **credencial externa
ausente** — não é NO_GO do core local. O pipeline de market discovery reage
honestamente: quando todos os candidatos avaliados falham no filtro de categoria
(`category_signals_below_minimum`, minSignals=1), o veredito é **degenerado**
com `reason: provider_returned_no_relevant_candidates`
(`api/services/marketDiscovery/candidateDiscovery.js`,
`assessDiscoveryInputViability`) — "falha de entrada do provider, não ausência
de players no mercado" — em vez de declarar mercado vazio. O destravamento das
verticais paradas exige escolha de fornecedor com chave (decisão de custo do
dono do produto); o adaptador genérico já existe e um backend novo não exige
tocar em mais nada.

Mitigação operacional: configurar `BRAVE_SEARCH_API_KEY` (ou
`GOOGLE_CSE_API_KEY` + `GOOGLE_CSE_ID`) e repetir; ou rodar o container em
OFFLINE com snapshot governado.

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

## 7. Gate E2E de runtime Docker (release gate, 2026-09-19)

`npm run validate:mcp-research-docker-e2e`
(`scripts/governance/validate-mcp-research-docker-e2e.js`, gate
`MCP_RESEARCH_DOCKER_E2E`, bloqueante no agregado
`validate:governance-enforcement`). Diferente de `validate:mcp-research`
(compose_integration), que lê o **texto** do `docker-compose.prod.yml` e confere
se as redes estão **declaradas**, este gate mede o **runtime** — texto correto
não é runtime correto, e a divergência era silenciosa: em 2026-09-19 a rede
`rap-internal` em execução estava `Internal=false` (criada manualmente, sem
`--internal` nem labels do compose, reutilizada por nome) enquanto o compose
declarava `internal: true`. O que impedia o vazamento era o isolamento padrão
entre bridges do Docker — um efeito colateral, não o controle projetado.

O que o gate prova, contra o container real (`mcp-research-e2e`):

1. container presente e **healthy**;
2. rede `rap-internal` **isolada** (`Internal=true` medido em runtime) e
   **gerenciada pelo compose** (labels — drift de infraestrutura é violação);
3. container exatamente nas 2 redes do desenho (`rap-internal` +
   `rap-research-egress`);
4. fronteira viva de dentro da rede: `tools/list` responde, `GET /health`
   devolve 200 e um `tools/call` **real** executa
   (`research_inspect_documentation` — tool pura, zero rede e zero efeito
   externo, a única cujo call pode ser exigido em gate);
5. **egress externo** funciona (a saída projetada existe);
6. probes **negativos**: Postgres/Redis/Asterisk operacionais **inalcançáveis**
   a partir do container (alcançar = vazamento, `MCP_E2E_OPERATIONAL_LEAK`) e a
   **credencial AMI legada** do repositório **não autentica** — verificar que o
   segredo novo funciona não basta, é preciso provar que o antigo parou de
   valer (ver `AI_MEMORY/security-finding-pbx-ami-exposure.md`);
7. `--with-restart`: após `docker restart`, o healthcheck volta a `healthy` e
   `tools/list` volta a responder (prova de recovery).

Sem daemon Docker o gate sai 0 com status **`REQUIRES_DOCKER_RUNTIME`** —
decisão correta para CI/dev, mas **não é prova**. É o seal quem a exige:
`scripts/governance/verify-mcp-research-docker-e2e-pass.js` roda na fase
`consolidate` do `release:seal` e **reprova o release** se o relatório
`reports/mcp-research-docker-e2e-report.json` estiver ausente, com
`status !== 'PASS'` ou stale (teto `MCP_E2E_REPORT_MAX_AGE_MS`, default 24h).
**Release final não existe sem a prova de runtime.**

Ciclo completo (build → up → wait healthy → gate):
`npm run validate:mcp-research-docker-e2e:full`
(`scripts/governance/run-mcp-research-docker-e2e.sh`). **Idempotente**: stack
viva (container `mcp-research-e2e` existente) é **reutilizada** e nunca
derrubada; stack subida pelo script também permanece de pé — é o ambiente de
evidência do gate e o teardown é decisão operacional
(`docker compose -f docker-compose.mcp-research-e2e.yml down`), nunca do gate.

## 8. Troubleshooting rápido

| Sintoma | Primeira verificação |
|---|---|
| 401 em `/mcp` | token divergente entre API e container (mesma env, dois lugares) |
| 405 em `/mcp` | método errado — só POST (stateless) |
| 413 | body acima de `MCP_RESEARCH_MAX_BODY_BYTES` |
| `research_offline_snapshot_miss` | URL não está no snapshot; regenerar/estender o fixture |
| `research_offline_snapshot_unavailable` | `index.json` ilegível/malformado; readiness fica 503 |
| container sem saída externa | verificar membership de rede — egress só via `rap-research-egress` |
| conexão não registrada | `MCP_RESEARCH_ENDPOINT` ausente → `skipped` explícito nos logs |
