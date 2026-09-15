# MCP Research — container MCP das capabilities `research.*`

Documentação canônica do container de pesquisa (`services/mcp-research/`). O
gate bloqueante `scripts/governance/validate-mcp-research.js` (8 checagens,
fail-closed, relatório em `reports/mcp-research-report.json`) verifica o
container, a integração no compose, a paridade de contrato, os controles de
segurança, este conjunto de documentos
(`config/mcp-research-docs-manifest.json`) e dois smokes executáveis (modo
OFFLINE real + protocolo MCP real).

## Índice do conjunto

- **Este documento**: visão geral, decisões de arquitetura (ADR), integração
  com o RAP, segregação DEVELOPMENT.
- `tool-contracts.md` — contrato das 5 tools MCP (input/output/erros/timeouts/
  efeitos colaterais/classificação/segurança/exemplos).
- `security-model.md` — modelo de ameaças e controles implementados.
- `operations.md` — deployment, modo OFFLINE, runbook e troubleshooting.
- `data-flow.md` — fluxo de dados da pesquisa até a saturação de benchmark.

## 1. O que é

Um **servidor MCP real** (SDK oficial `@modelcontextprotocol/sdk@1.30.0`,
transporte Streamable HTTP em modo **stateless**) empacotado como container
Docker próprio, que atende as 5 capabilities governadas de pesquisa declaradas
em `api/services/benchmark/researchCapabilities.js`:

| Tool MCP | Capability canônica |
|---|---|
| `research_search` | `research.search` |
| `research_fetch` | `research.fetch` |
| `research_inspect_documentation` | `research.inspectDocumentation` |
| `research_inspect_api_docs` | `research.inspectApiDocs` |
| `research_capture_evidence` | `research.captureEvidence` |

O container **não forka** a lógica de pesquisa: ele reusa os mesmos arquivos da
plataforma — `api/services/research/nativeResearchProvider.js` (engine de
busca/fetch/inspeção/evidência), `api/services/askAi/injectionGuard.js`
(neutralização de injeção) e `src/core/mcp/endpoint-policy.js` (política de
endpoint) — copiados para a imagem com a mesma estrutura relativa de diretórios
para que os `require` resolvam sem adaptação (ver
`services/mcp-research/Dockerfile`).

## 2. Decisões de arquitetura (ADR)

### ADR-1 — Por que um container separado

O egress de pesquisa é a superfície de rede mais perigosa da plataforma: busca
e fetch de URLs externas, escolhidas em parte por resultados de busca (conteúdo
de terceiros). Isolar esse egress em um container próprio permite:

- **Segmentação de rede por construção** (`docker-compose.prod.yml`): o serviço
  `mcp-research` vive em `rap-internal` (rede `internal: true`, sem saída
  externa, só API ↔ mcp-research) e `rap-research-egress` (única rede com saída
  externa). Ele **não** está em `r-agent2-network`: não alcança
  postgres/redis/asterisk — o gate falha se isso mudar.
- **Blast radius limitado**: limites de recurso próprios (0.5 CPU / 512M),
  usuário não-root, imagem mínima (node:22-alpine, deps pinadas via
  `npm ci --omit=dev`, sem segredos na imagem).
- **Ciclo de vida independente**: healthcheck próprio (`GET /health`), restart
  `unless-stopped`, shutdown gracioso por SIGTERM/SIGINT.

### ADR-2 — Por que MCP (e não uma API interna ad-hoc)

A plataforma já tem um control plane MCP governado: conexões, delegação de
capabilities, política de endpoint, classificação e auditoria vivem no MCP
Client Hub (`src/core/mcp/`). Falar MCP torna o container **um provider como
qualquer outro**: ele é descoberto por `tools/list`, invocado por `tools/call`
e governado pelas mesmas estruturas (`mcpConnectionService`, delegação
explícita, `toolCapabilityMap`). Nenhum caminho novo de governança foi criado
para a pesquisa — o container entra na malha existente.

O transporte é **stateless** (`sessionIdGenerator: undefined`): um par
Server+Transport por request `POST /mcp`, sem sessão em memória — o container
escala horizontalmente e reinicia sem estado a drenar. `GET|DELETE /mcp`
respondem 405 por construção.

### ADR-3 — Por que o Canonical Tool Registry

Subagentes de pesquisa não ganham acesso externo irrestrito: eles pedem a
**capability** (`research.fetch`), nunca o provider, o host ou a conexão
(`src/core/mcp/capability-resolution.js`). O Canonical Tool Registry aplica
tenant, permissão, visibilidade, schema, política e auditoria em toda execução
(`researchCapabilities.js: ensureResearchCapabilities` — visibilidade
DEVELOPMENT, `sideEffects: false`, `riskLevel: 'low'`, `outputTrust:
'DATA_ONLY'`). A seleção de provider é **determinística** (nunca "o LLM
escolheu"), nativa tem precedência, e a decisão é auditável (devolve `reason`).

### ADR-4 — Por que o Core não conhece o provider

O Core Cognitivo e os consumidores de pesquisa (runner de benchmark, Agent OS)
resolvem `research.*` via `executeResearchCapability`, que delega a seleção ao
`resolveProvider` da capability-resolution. O container MCP é apenas mais um
provider elegível atrás da mesma capability: trocar nativo ↔ MCP externo não
muda nenhuma linha dos consumidores. Provider de MCP externo é ligado ao tenant
da conexão — nunca elegível para ator de outro tenant (fail-closed).

### ADR-5 — Por que não substitui o R-Bridge (WhatsApp QR)

O `@results/whatsapp-qr-bridge` é um bridge de **domínio operacional**
(sessões WhatsApp, tickets, mídia, WS) acoplado ao runtime do tenant. O
mcp-research é um provider de **capability de engenharia** (pesquisa de
mercado/benchmark), sem estado de tenant, read-only, classificação DEVELOPMENT.
São camadas e ameaças diferentes; nenhum dos dois executa o papel do outro.

### ADR-6 — Por que DEVELOPMENT-only (segregação explícita)

Pesquisa competitiva/benchmark é superfície de engenharia, não de produção:

- as 5 capabilities são registradas com `visibility: 'DEVELOPMENT'`
  (`researchCapabilities.js`) e `metadata.domain = 'SYSTEM'` (nada de dados de
  pesquisa em RAG operacional);
- a conexão auto-registrada tem `classificationCeiling: 'DEVELOPMENT'`
  (`registerMcpResearchConnection.js`) — as exceções de política de endpoint
  (`allowPlaintextHttp`, `allowPrivateNetwork` para alcançar o container na
  rede interna) só são válidas **porque** a classificação é DEVELOPMENT; a
  política de endpoint recusa plaintext em PRODUCTION
  (`mcp_endpoint_plaintext_http_forbidden_in_production`);
- **Production nunca vê o mcp-research**: nenhuma rota de API de tenant, nenhum
  item de menu e nenhum fluxo operacional referencia o container. O caminho de
  execução exige ator com classificação DEVELOPMENT.

### ADR-7 — ONLINE/OFFLINE como modos estruturais

`MCP_RESEARCH_MODE=ONLINE` (default): egress real sob a política de endpoint.
`MCP_RESEARCH_MODE=OFFLINE`: **zero egress por construção** — o provider de
rede não é sequer instanciado; `research_search`/`research_fetch` leem o
snapshot local (`MCP_RESEARCH_SNAPSHOT_DIR`); as inspeções e a evidência
(funções puras) usam um provider cujo transporte/DNS lançam
`research_offline_egress_forbidden` se forem acionados. Ausência no snapshot é
erro tipado `research_offline_snapshot_miss` — nunca fallback silencioso para
rede. OFFLINE existe para CI, desenvolvimento sem rede e reprodução
determinística de runs de pesquisa.

### ADR-8 — Fronteiras do container (o que ele NÃO é)

- **Read-only**: apenas GET externo; `sideEffects: false` em todas as tools;
  `research_capture_evidence` valida e normaliza o registro — a persistência
  fica no store do chamador (a API).
- **Sem dado de tenant na requisição**: nada de contexto de tenant sai no
  egress; o container nem recebe tenantId.
- **Sem estado**: nenhuma persistência local, nenhuma sessão; o snapshot
  OFFLINE é volume read-only montado de fora.
- **Sem confiança automática**: a resposta de tool é DADO
  (`outputTrust: 'DATA_ONLY'`); nunca vira `VERIFIED_OFFICIAL` por si só —
  quem decide isso é a política de fonte da pesquisa de benchmark.

## 3. Integração com o RAP (auto-registro)

Com `MCP_RESEARCH_ENDPOINT` configurado na API (default do compose:
`http://mcp-research:8080/mcp`), o startup do MCP Client executa o bootstrap
idempotente `api/services/mcp/registerMcpResearchConnection.js`:

- persiste a conexão `system/mcp-research` (`transport: 'http'`,
  `authType: 'bearer'`, `credentialRef: 'MCP_RESEARCH_TOKEN'` — o **nome** da
  env, nunca o valor) com as 5 tools, `toolCapabilityMap`, `toolPolicies`
  read-only e `delegatedCapabilities` = as 5 capabilities `research.*`;
- **idempotente**: a chave (tenant, name) impede duplicação; drift de config
  (endpoint, classificação, mapas, políticas) é reconciliado via update — o
  control plane é a autoridade. Um disable administrativo **não** é revertido
  pelo bootstrap;
- **fail-closed**: sem `MCP_RESEARCH_ENDPOINT` a ausência é explícita
  (`skipped/mcp_research_endpoint_not_configured`), nunca conexão inventada;
  o hostname do endpoint é fixado em `metadata.allowedHosts` para auditoria.

Autenticação serviço-a-serviço: bearer por **referência de ambiente**
(`MCP_RESEARCH_TOKEN`), mesmo padrão do `RAG_INTERNAL_TOKEN` — o MCP Client Hub
resolve a env e envia `Authorization: Bearer <token>`; o container compara em
tempo constante (`services/mcp-research/src/auth.js`). Sem token configurado o
servidor **recusa subir** (`mcp_research_config_invalid`). `GET /health` e
`GET /readiness` são não autenticados e não expõem dado sensível.

## 4. Superfície HTTP

| Rota | Auth | Função |
|---|---|---|
| `GET /health` | não | estado do processo (`status/service/mode`) |
| `GET /readiness` | não | prontidão real (token configurado; em OFFLINE, snapshot legível) |
| `POST /mcp` | **bearer obrigatório** | endpoint MCP (initialize, tools/list, tools/call) |
| `GET\|DELETE /mcp` | — | 405 (stateless não mantém stream de sessão) |
| demais | — | 404 |

Defesas de borda: teto de body (`MCP_RESEARCH_MAX_BODY_BYTES`, default 1 MiB —
excesso é 413, nunca truncamento), JSON malformado → 400, shutdown gracioso.

## 5. Governança executável

`node scripts/governance/validate-mcp-research.js` roda 8 checagens
fail-closed: arquivos do container, propriedades do Dockerfile, integração no
compose (redes, envs, limites, ausência em `r-agent2-network`), paridade 1:1
tool ↔ capability ↔ bootstrap, wiring estático dos controles de segurança,
presença desta documentação, smoke OFFLINE real com snapshot fixture e smoke de
protocolo MCP real em-processo (initialize/tools/list/tools/call + 401 sem
bearer). Relatório: `reports/mcp-research-report.json`.
