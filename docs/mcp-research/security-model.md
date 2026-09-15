# MCP Research — modelo de segurança

Ameaças e controles **implementados** do container de pesquisa. Fontes:
`services/mcp-research/src/*`, `api/services/research/nativeResearchProvider.js`,
`src/core/mcp/endpoint-policy.js`, `api/services/askAi/injectionGuard.js`,
`api/services/mcp/registerMcpResearchConnection.js`, `docker-compose.prod.yml`.
O gate `scripts/governance/validate-mcp-research.js` verifica estaticamente o
wiring destes controles (checagem `security_controls`) — eles não são
documentais.

## Postura geral

- O egress de pesquisa é tratado como **boundary hostil**: a URL buscada pode
  ter vindo de um resultado de busca (conteúdo de terceiros), e o documento
  obtido é conteúdo ativo potencialmente malicioso.
- O container é **read-only, stateless e sem dado de tenant**: nada para
  exfiltrar do processo, nenhuma sessão para sequestrar, nenhum dado de tenant
  na requisição.
- **Fail-closed em tudo**: sem token não sobe; modo inválido não sobe; OFFLINE
  sem snapshot não sobe; erro é tipado, nunca silencioso.

## Ameaças e controles

### 1. SSRF (Server-Side Request Forgery)

**Ameaça**: `research_fetch` usado para alcançar loopback, rede privada,
link-local ou metadata de cloud (169.254.169.254).

**Controles** (`src/core/mcp/endpoint-policy.js` + provider):
- protocolo `https` obrigatório por padrão; `http` só com exceção explícita
  (TEST-ONLY no container);
- hostnames bloqueados (`localhost`, `metadata.google.internal`, sufixos
  `.local`, `.internal`, `.home.arpa`);
- faixas IP bloqueadas por categoria: loopback, link-local, **cloud metadata
  (sem exceção possível)**, privadas RFC1918/CGNAT, reservadas;
- credencial em URL proibida (`mcp_endpoint_credentials_in_url_forbidden`);
- no compose, o container nem tem rota para a rede da plataforma: ele não está
  em `r-agent2-network` (gate falha se estiver) — defesa em profundidade.

### 2. DNS rebinding

**Ameaça**: hostname público que resolve para IP privado no momento da conexão
(ou muda entre validação e conexão).

**Controle**: o DNS resolvido é **revalidado antes de conectar** e **a cada
salto de redirect** (`nativeResearchProvider` + `resolveAndValidateEndpoint`);
código de bloqueio estável `mcp_endpoint_dns_rebinding_detected`.

### 3. Redirect malicioso

**Ameaça**: URL pública redirecionando para destino proibido.

**Controles**: redirects são caminhados salto a salto (`redirect: 'manual'` no
transporte) e **cada destino é reavaliado pela política de endpoint** antes de
conectar; teto de saltos `MCP_RESEARCH_MAX_REDIRECTS` (default 3); excesso ou
destino proibido → `research_fetch_redirect_blocked` /
`mcp_endpoint_redirect_blocked`.

### 4. TLS enfraquecido

**Ameaça**: certificado inválido aceito silenciosamente; plaintext.

**Controles**: TLS verificado pelo transporte padrão; `rejectUnauthorized:
false` é **proibido no código do container** (o gate varre as fontes e falha se
encontrar); na política de endpoint, TLS inseguro exigiria `allowInsecureTls:
true` + classificação não-PRODUCTION + justificativa — nunca silencioso.
`MCP_RESEARCH_ALLOW_PLAINTEXT_HTTP` é TEST-ONLY (fixtures locais); o default é
estrito e o gate verifica isso.

### 5. Prompt/data injection via documento buscado

**Ameaça**: o documento obtido contém instruções ("ignore as instruções
anteriores…") que chegariam ao modelo como comando.

**Controles** (`api/services/askAi/injectionGuard.js`, aplicado em
`sanitizeFetchedContent`):
- linhas com marcadores de injeção conhecidos (EN/PT, delimitadores de chat
  template `[INST]`, `<|im_start|>` etc.) são substituídas por marcador neutro;
- metadados da sanitização são devolvidos (`injectionDetected`,
  `neutralizedLines`, `treatedAs: 'DATA_ONLY'`);
- `outputTrust: 'DATA_ONLY'` no registry: a resposta de tool nunca vira
  `VERIFIED_OFFICIAL` automática.

### 6. Documento/credenciais na resposta (vazamento de segredo e PII)

**Ameaça**: página buscada contém tokens, chaves, CPF, cartões que iriam ao
modelo ou à evidência.

**Controles**: redaction de PII/credenciais no `injectionGuard` (CPF, cartão,
e-mail, telefone BR, bearer, api keys) com contagem em `redactions`;
`contentHash` recomputado **pós-sanitização** — a evidência liga ao que foi
efetivamente analisado. No lado do container, o bearer nunca é logado
(`auth.js` não recebe logger; o logger do container é JSON mínimo sem
segredos) e nunca é persistido (`credentialRef` é o **nome** da env).

### 7. Resposta gigante / esgotamento de recurso

**Ameaça**: documento enorme estoura memória; body de request enorme idem.

**Controles**: teto de resposta `MCP_RESEARCH_MAX_BYTES` (default 2 MiB →
`research_fetch_too_large`); teto de body de request
`MCP_RESEARCH_MAX_BODY_BYTES` (default 1 MiB → 413, nunca truncamento);
timeout por salto `MCP_RESEARCH_TIMEOUT_MS` (default 15 s →
`research_fetch_timeout`); limites de container no compose (0.5 CPU / 512M);
polidez por host (`minIntervalMsPerHost: 1000` no provider).

### 8. Superfície de browser

**Controle estrutural**: o container **não tem browser**. Não há Playwright,
não há renderização de JS, não há cookies/sessão de navegação — o transporte é
GET HTTP puro com User-Agent identificado (`RAP-Research/1.0`). Toda a classe
de ataques de browser (XSS contra o agente, session hijacking, download de
binário ativo) é eliminada por construção.

### 9. Cross-tenant

**Ameaça**: provider de MCP externo servindo ator de outro tenant.

**Controles**: o container não recebe tenantId e não carrega dado de tenant; na
resolução de capability (`src/core/mcp/capability-resolution.js`), provider de
MCP externo é ligado ao tenant da conexão (`system`) — nunca elegível para ator
de outro tenant ou sem tenant (fail-closed; cross-tenant exigiria delegação
persistida explícita, que não existe).

### 10. Acesso à rede interna da plataforma

**Controles**: segmentação por construção no compose — `rap-internal`
(`internal: true`, sem egress) só liga API ↔ mcp-research; `rap-research-egress`
é a única saída externa; o serviço **não** está em `r-agent2-network` (não
alcança postgres/redis/asterisk) e não publica porta no host (`expose` apenas).
O gate `compose_integration` falha se qualquer uma dessas propriedades regredir.

### 11. Abuso da fronteira MCP (auth, sessão, tool desconhecida)

**Controles**: bearer obrigatório comparado em **tempo constante**
(`timingSafeEqualString`); sem token o processo não sobe
(`mcp_research_config_invalid`); modo **stateless** — sem sessão em memória
para roubar ou fixar; `GET|DELETE /mcp` → 405; rota desconhecida → 404; tool
desconhecida → `{ code: 'research_unknown_tool' }` com `isError: true`; erros
de tool nunca vazam stack nem segredo.

### 12. Egress acidental em modo OFFLINE

**Controle**: em OFFLINE o provider de rede **não é instanciado**; o provider
auxiliar das funções puras tem transporte/DNS que lançam
`research_offline_egress_forbidden` se acionados; o nome de arquivo do snapshot
é `sha256(url)` derivado no container — entrada externa **nunca compõe caminho
de arquivo** (sem path traversal por construção, com verificação de diretório).
O gate executa um smoke OFFLINE real contra um snapshot fixture.

## Exceções TEST-ONLY (inventário auditável)

| Env | Efeito | Guarda |
|---|---|---|
| `MCP_RESEARCH_ALLOW_PRIVATE_NETWORK=true` | libera rede privada na política de endpoint | default estrito verificado pelo gate |
| `MCP_RESEARCH_ALLOW_PLAINTEXT_HTTP=true` | libera http plaintext | idem |

Essas variáveis existem para fixtures locais de teste. Em produção o compose
não as define e o gate falha se os defaults deixarem de ser estritos. As
exceções `allowPlaintextHttp/allowPrivateNetwork` da **conexão** (API →
container, rede interna do compose) são válidas somente porque a classificação
é DEVELOPMENT — ver `README.md` ADR-6.
