# AI_MEMORY — api-performance.md

Arquitetura de eficiência da plataforma. API Node: auditoria de 2026-08-03 (commits `788b34f8`, `b5580c12`, `4c2d6468`, `8f45a9a7`). Frontend: auditoria de 2026-08-06 (commits `68c40fee`, `df844b3e`, `1a07907f`, `a757f64c`) — ver seção ao final.

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

## Frontend (2026-08-06)

- **Code splitting total**: `main.jsx` carrega 104 páginas via `React.lazy` (helper `lazyPage(loader, exportName)` para named exports) + `Suspense` (`shared/PageLoadingFallback.jsx`); estáticos só `Login`/`SaasPublicPage`/shell. Entry: 5.188 kB/1.342 kB gzip → **311 kB/86 kB gzip**. Vendors isolados via `manualChunks` (react/rete/bpmn/pdf) em `vite.config.mjs`; `chunkSizeWarningLimit` 1500 (rete-vendor ~1,5 MB é legítimo, só rota /editor); `preserveEntrySignatures: 'exports-only'`.
- **PWA**: pré-cache restrito ao shell (735 KiB; era ~5,9 MB) + `runtimeCaching` SWR para `/assets/`; `devOptions.enabled: false`.
- **Tailwind 4**: `@import "tailwindcss"` já inclui as camadas — as 3 diretivas `@tailwind *` foram removidas do `index.css`.
- **WebSocketContext**: `value` memoizado; `registerHandler`/`unregisterHandler` estáveis (leem `authenticatedRef`); `useWebSocketContext` registra 1x por componentId com callbacks em refs (re-registro só quando o CONTEÚDO de subscribeEvents muda — compare por `join('|')`). Padrão a seguir em todo consumidor novo: pode passar callback inline, o hook cuida.
- **Renders quentes**: estado de composer vive no componente do composer (não no controller raiz — digitação não re-renderiza listas); `React.memo` em `SupportTicketList`/`SupportConversationPane`/`SupportTicketCard`; filtros de texto com debounce 400ms + guarda de resposta por sequência; `value` de TODO contexto em `useMemo`.
- **Rules of hooks**: early returns de auth SEMPRE depois de todos os hooks (padrão InboxPage; FlowEditorPage tinha o bug — tela branca em sessão expirada).
- **Ruído**: `client.js` e `Login.jsx` com zero `console.*` — `logger.debug` gated por DEV; nunca logar token (nem preview), objeto agent ou JSON de onboarding.
- **Polling**: guarda de overlap (`inFlightRef`) obrigatória; toggles de auto-refresh seguem o padrão visual de `SystemStatusPage.jsx`; `useDevDashboard` default OFF; ChannelHealthPage subscreve `channel.health.alert` via WS (poll 120s só fallback). Follow-up: substituir polls de campanhas/verticais/fila física por eventos WS (exige emissão no backend).
- **validate:runtime**: isenta `ERR_ABORTED` de chunks `/src/pages/*.jsx` — page.goto aborta imports em voo da rota anterior (ruído de navegação, mesma classe de /auth/me).

## Engine de fluxos (2026-08-06, commit `f1a19a0d`)

- **Invalidação obrigatória**: qualquer mutação de flow DEVE chamar `invalidateCompiledFlow(tenantId, flowId)` (`engine/compiledFlowCache.js`) — cobertos PUT/DELETE/environment (`handleFlowCrudRoutes.js`) e import com overwrite (`handleConfigAdminRoutes.js`). Marketplace só cria ids novos (seguro). Cache: cap 200, eviction FIFO.
- **Hot path O(1)**: `CompiledFlow.nodeIndex` (Map congelado) usado por `findNode`/`resolveNodeType` com fallback linear para flows crus; `defaultNodeRegistry` singleton no messageProcessor.
- **Revalidação de flows de IA**: só em cache miss (o compilado é deep-frozen).
- **Timeout de IA**: todo provider de `getAiProviderForTenant` sai com `generate` envolvido em timeout de 30s (`ENGINE_AI_TIMEOUT_MS`), erro `code: 'ai_timeout'` por tentativa (fallback secundário intacto); provider memoizado por tenant, invalidado em `setTenantAiConfig`/`registerAiProvider`/`clearAiProviderConfig`.
- **Caps de crescimento**: 500 eventos/sessão (`MAX_SESSION_EVENTS`), 100 itens de `state.history` (`MAX_HISTORY_ITEMS`), ledger trunca `history` nos últimos 20 em stateBefore/stateAfter (replay preservado — demais campos completos).
- **persistenceServices**: `getFlow` via findByPk; `getQueueInfo` = 1 query filtrada (era 3 varreduras globais da tabela de tickets).
