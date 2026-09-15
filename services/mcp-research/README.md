# MCP Research container

Container MCP real que atende as capabilities governadas `research.*`
(`api/services/benchmark/researchCapabilities.js`) via protocolo MCP
(Streamable HTTP, SDK oficial `@modelcontextprotocol/sdk@1.30.0`), reutilizando
o engine provado de `api/services/research/nativeResearchProvider.js`.

A documentação canônica (arquitetura, modelo de segurança, operação) vive em
`docs/mcp-research/`.

## Resumo operacional

- Endpoint MCP: `POST /mcp` (stateless, bearer obrigatório).
- `GET /health` e `GET /readiness` (não autenticados, sem dado sensível).
- Auth: `Authorization: Bearer $MCP_RESEARCH_TOKEN` — o mesmo valor configurado
  na API; o MCP Client Hub envia o header resolvendo a referência de credencial
  (`authRef`/`credentialRef` = nome da env, nunca o valor persistido).
- `MCP_RESEARCH_MODE=ONLINE` (default): egress real sob a política de endpoint
  de `src/core/mcp/endpoint-policy.js` (loopback/privado/metadata bloqueados,
  DNS revalidado antes de conectar e a cada redirect, TLS verificado, tetos de
  tamanho/timeout).
- `MCP_RESEARCH_MODE=OFFLINE`: zero egress; `research_fetch`/`research_search`
  leem o snapshot em `MCP_RESEARCH_SNAPSHOT_DIR` (`index.json` +
  `documents/<sha256(url)>.json`); ausência é erro tipado
  `research_offline_snapshot_miss`.
- Todo conteúdo buscado é neutralizado como DADO
  (`api/services/askAi/injectionGuard.js`) antes de sair; o `contentHash`
  devolvido é o hash do conteúdo efetivamente devolvido, mantendo a ligação
  fetch → inspect → evidence.
- `MCP_RESEARCH_ALLOW_PRIVATE_NETWORK` / `MCP_RESEARCH_ALLOW_PLAINTEXT_HTTP`
  são **TEST-ONLY** (fixtures locais); o default é a política estrita e o gate
  `scripts/governance/validate-mcp-research.js` verifica isso.

## Registro na plataforma

Com `MCP_RESEARCH_ENDPOINT` configurado na API (ex.:
`http://mcp-research:8080/mcp` no compose), o bootstrap idempotente
`api/services/mcp/registerMcpResearchConnection.js` persiste a conexão
`system/mcp-research` (classificação DEVELOPMENT, toolCapabilityMap
`research_* → research.*`, delegatedCapabilities = as 5 capabilities de
pesquisa) no startup do MCP Client — sem clique manual.
