# Relatorio de Legado e Duplicacao

## Atualizacao de consolidacao (2026-03-21)
- `api/server.js` foi reduzido para 212 linhas e deixou de concentrar bootstrap/startup/estado compartilhado.
- `api/app/registerRoutes.js` foi reduzido para 210 linhas e deixou de conter `buildDeps` inline.
- A referencia documental antiga a `api/modules/shared/legacyExpressBridge.js` estava errada; o arquivo real era `api/modules/shared/expressHandlerBridge.js`, ja removido.

## Legado residual relevante

### 1) Bridge Express residual
- Arquivo real anterior: `api/modules/shared/expressHandlerBridge.js`
- Situacao atual: removido; o backend nao mantem mais bridge compartilhado de handlers.
- Risco: manter a ponte como padrao e bloquear a consolidacao final dos dominios.
- Acao canonica: manter allowlist explicita, sem reintroduzir `serverHandlers` no caminho produtivo.

### 2) Mega-contextos compartilhados
- `api/composition/core/buildCoreRoutingContext.js`
- `api/composition/platform/buildPlatformRoutingContext.js`
- `api/composition/extended/buildExtendedRoutingContext.js`
- Risco: buckets de dependencias dificultam ownership por dominio e escondem acoplamentos.
- Acao canonica: manter os slices atuais e evitar regressao para buckets centralizados.

### 3) Duplicacao historica ja removida neste ciclo
- startup em `server.js`
- `buildDeps` inline em `registerRoutes.js`
- helper de process manager no entrypoint
- helper morto `validateProviderTokenDirect` no entrypoint

## Conclusao
- O legado estrutural principal nao esta mais no entrypoint nem no registrador central.
- O passivo restante esta concentrado em:
  - 0 wrappers de compatibilidade no antigo caminho `api/serverHandlers/*`
  - 0 arquivos produtivos ainda canonicamente implementados, porque a pasta legada foi removida
  - reintroducao acidental de bridge compartilhado em vez de wiring local por modulo
- A remocao do caminho legado agora ficou congelada por guardrail em `tests/unit/backendArchitectureGuardrails.test.js`.

## Atualizacao 2026-03-22
- Duplicacao eliminada nesta onda:
  - helpers de coercao defensiva duplicados em hotspots de service passaram para `api/utils/defensiveCoercion.js`.
- Duplicacao residual relevante ainda aberta:
  - padroes `handle*Routes` de grande porte com responsabilidade mista em varios modulos `api/modules/*`;
  - concentracao de responsabilidades em `api/services/queueService.js` (orquestracao principal ainda no arquivo base, apesar das extrações de persistence/index/messaging/query/mode/lifecycle/order-incident).
- Proximo cleanup canonico:
  - reduzir `handle*Routes` por subdominio;
  - concluir decomposicao de `queueService` e manter composicao por colaboradores coesos.
