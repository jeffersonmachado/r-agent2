# AI_MEMORY — api-performance.md

Arquitetura de eficiência da API Node (auditoria de 2026-08-03, commits `788b34f8`, `b5580c12`, `4c2d6468`, `8f45a9a7`).

## Caminho de request

- **Tenant**: `getTenant` (`api/services/tenantService.js`) tem cache TTL 15s chaveado pelo identifier exato; invalidação em `createTenant`/`updateTenant`/`deleteTenant` e no signup de landing (`invalidateTenantCache`). Hit retorna `structuredClone`. `validateTenantStatus(tenantId, preloadedTenant)` aceita o tenant já carregado — `requireTenant` não re-busca.
- **Auth**: `validateToken` persiste `last_activity_at` no Postgres no máximo 1x/min por sessão (`lastActivityPersistedAt` na sessão em memória); o `lastActivityAt` em memória continua atualizado a cada chamada (timeout de inatividade intacto). `requireAuth` (`api/middleware/auth.js`) faz short-circuit quando `req.token === token do header && req.agent && req.session` (token era validado 2x por request).
- **Rate limit por tenant é REAL** (não mais no-op): políticas `TENANT_API_PLAN_LIMITS`/`TENANT_USER_API_PLAN_LIMITS` em `infra/rate-limit/policies.js` (free 100/20, basic/trial 500/100, pro 2000/500, enterprise 10000/2000 por 60s); `getPolicy` parseia nomes dinâmicos `TENANT_(USER_)API_<plano>_<pontos>_<dur>` e limites customizados via `tenant.settings`.
- **Auditoria de rate limit**: append-only NDJSON em `reports/rate-limit-events.json`, fire-and-forget (`auditEventAsync`) — nunca awaited no caminho do request. Não é array JSON.
- **WebSocket**: broadcasts serializam UMA vez (`JSON.stringify` fora do loop) e `broadcastToTenant` usa índice `tenantClients: Map<tenantKey, Set<client>>` (manter em connect/auth/`removeClient`; chave `null` = não autenticados).
- **Frontend-fallback**: `index.html` cacheado em memória com revalidação por mtime (TTL 5s).
- **config.get**: lookup de env pré-computado (`CONFIG_PATH_TO_ENV_VARS`, lista por path — colisões preservam ordem de declaração).

## Banco de dados (N+1 eliminados)

- Webhook de status WhatsApp (`channelGatewayService`): 2 leituras em lote por batch (`external_message_id IN`), updates por item.
- Learning-core drift (`adaptiveService`): 1 query `actor_id IN` + janela (era 1 por certificação, até 500).
- Métricas de tenants (`tenantService.getTenantUsageBatch`): 5 `GROUP BY tenant_key` + 1 JOIN, fixas para qualquer N.
- `getAIConfig` (`tenantAIService`): cache TTL 60s + `invalidateAIConfigCache` em `saveAIConfig`.
- Dashboards (ai-governance, beauty): agregações SQL (`GROUP BY`/`SUM`/`COUNT`), nunca `findAll` + reduce em JS.
- Campanhas marketing: `bulkCreate` chunks de 500 `ignoreDuplicates` (constraint `tenant_key+campaign_id+lead_id`).

## Ciclo de vida / memória

- `messageProcessor.sessions`: delete ao fim da conversa + sweeper 24h de inatividade.
- Boot de tickets (`queueTicketPersistenceRuntime`): só ativos + fechados < 7 dias (alinhado à retention horária).
- Sweepers unref'd: sessões auth expiradas (1h), campanhas completed > 24h (nunca com pacing ativo), execuções pipeline terminais > 1h, prune channelHealth 24h.
- Cache de screenshots QA Waves: cap FIFO de 20.
- Serviços stateless são singletons module-level (WorkspaceLinkAutomationService, 5 do durableProcessService).
- Shutdown gracioso: `registerShutdownHooks` aceita `stopWorkers`/`getServer` — para workers, `server.close()`, force exit em 10s.

## Lição de ambiente (2026-08-03)

- `validate:runtime` falhou com `ERR_ABORTED` em `/system/status` porque o rag-service dev (uvicorn --reload) estava **travado após reinstall do venv com o processo vivo** — o probe de health batia no timeout de 2s e a página abortava na navegação. Reiniciar o processo resolveu (4,2s → 48ms). Após mexer no venv do rag-service, sempre reiniciar o uvicorn dev.
