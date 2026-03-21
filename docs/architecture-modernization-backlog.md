# Backlog de Modernizacao Arquitetural

## Convencoes
- Prioridade: P0 imediato, P1 proxima onda, P2 apos consolidacao.
- Status: done, doing, todo.

## Itens

| ID | Prioridade | Status | Item | Dependencias | DoD resumido |
|---|---|---|---|---|---|
| BE-001 | P0 | done | Extrair startup principal de `api/server.js` para runtime dedicado | - | `server.js` vira entrypoint fino |
| BE-002 | P0 | done | Extrair bootstrap de `systemadmin` para `api/bootstrap/systemAdminBootstrap.js` | BE-001 | bootstrap fora do entrypoint |
| BE-003 | P0 | done | Extrair estado compartilhado de flows/sessions para `api/runtime/flowRuntimeState.js` | BE-001 | estado fora do entrypoint |
| BE-004 | P1 | done | Remover helpers mortos/deslocados do `server.js` | BE-001..003 | sem `validateProviderTokenDirect` e afins |
| BE-005 | P0 | done | Criar composition roots para os 10 routers que ainda tinham `buildDeps` inline | - | `registerRoutes.js` sem builders inline |
| BE-006 | P0 | done | Trocar sequencia aberta de `app.use(...)` por route registry declarativo | BE-005 | ordem preservada por manifesto |
| BE-007 | P0 | done | Quebrar `core/platform/extended` em builders menores por dominio | BE-003, BE-005 | builders centrais deixam de ser buckets gigantes em arquivo unico |
| BE-008 | P0 | done | Migrar agregadores bridgeados de maior fan-in (`platform-*`, `domain-*`) para composicao nativa | BE-006, BE-007 | menos acoplamento a `serverHandlers` |
| BE-009 | P1 | done | Migrar bridges de dominios operacionais restantes (`ticket`, `pbx`, `vertical`, etc.) | BE-007, BE-008 | ponte residual cai para excecoes pequenas |
| BE-010 | P1 | done | Padronizar convencoes de modulo restantes | BE-008, BE-009 | modulos previsiveis por dominio |
| BE-011 | P2 | done | Eliminar `expressHandlerBridge.js` e substituir por wiring local por modulo | BE-008, BE-009 | budget zero para bridge compartilhado |
| BE-012 | P2 | done | Cleanup final de wrappers, imports e caminhos concorrentes | BE-004, BE-010, BE-011 | sem ambiguidade estrutural relevante |
| BE-013 | P0 | done | Expandir guardrails estruturais para bridge budget, imports e acoplamento | BE-001..011 | regressao arquitetural protegida |
| BE-014 | P1 | done | Cobrir bootstrap/runtime com testes de idempotencia e flags | BE-001..003 | runtime validado alem do smoke atual |
| BE-015 | P0 | done | Consolidar os 7 docs obrigatorios com o estado atual real | tarefas estruturais relevantes | docs sem contradicao com o codigo |
| BE-016 | P0 | done | Gate final de fechamento com rescaneamento completo | BE-013..015 | criteria finais de conclusao atendidos |

## Pendencia estrutural principal
- Nenhum modulo em `api/modules` ainda importa `serverHandlers`.
- Os mega-contextos centrais ja foram quebrados em slices.
- O diretorio legado `api/serverHandlers/*` foi removido; nao restam arquivos produtivos nem trilha estrutural desse caminho.
- O gate final com rescaneamento e suites ampliadas ja foi concluido.

## Estado do backend apos este ciclo
- `api/server.js` e `api/app/registerRoutes.js` deixaram de ser hotspots equivalentes aos anteriores.
- `registerRoutes.js` tambem deixou de subir agregadores `domain-*` e `platform-*` diretamente; esse wiring agora passa por composition roots dedicadas.
- O bridge compartilhado foi removido; o guardrail agora exige budget zero para `mountExpressHandler` e `createExpressHandlerMiddleware`.
- O backend chegou ao estado de fechamento: excecoes residuais documentadas, guardrails ativos e gate final concluido.
