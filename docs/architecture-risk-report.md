# Relatorio de Riscos Arquiteturais

## Escala
- Severidade: baixa, media, alta.
- Probabilidade: baixa, media, alta.

## Riscos identificados

| ID | Risco | Severidade | Probabilidade | Evidencia | Mitigacao |
|---|---|---|---|---|---|
| RSK-001 | Regressao de rota em ajustes finais do wiring Express | media | media | `server.js` estabilizado, mas `registerRoutes.js` ainda concentra a ordem de montagem dos routers | Manter suites de wiring, `api/server.test.js` e smoke de contrato por dominio |
| RSK-002 | Falha de bootstrap em producao apos mudancas de runtime | media | baixa | bootstrap/shutdown/workers ja foram extraidos, mas continuam criticos para deploy | Validar `/health`, startup e hooks de shutdown a cada alteracao estrutural |
| RSK-003 | Worker nao inicializa apos refactor | baixa | baixa | startup de workers centralizado em `api/runtime/startWorkers.js` | Monitorar heartbeat/logs e manter entrypoint unico com guardrails |
| RSK-004 | Custo alto para dividir hotspots especializados remanescentes | media | media | hotspots atuais estao em handlers especializados como `suggestDescriptionRoute.js` e `pbx-core/*` | Atacar somente quando houver ganho real, preservando contrato HTTP |
| RSK-005 | Reintroducao de grid paralelo no frontend | baixa | baixa | `PlatformGrid` e o unico grid ativo; `DataGrid` foi removido do frontend em 2026-03-20 | Guardrail de wiring + policy de imports canonicos em `modules/platform-grid` |
| RSK-006 | Divergencia de base compartilhada entre dashboards | baixa | baixa | dashboards compartilham `components/DashboardBase/*` expostos pelo barrel `modules/dashboard-base`; variantes de DevDashboard foram removidas | Manter barrel canonico e extrair hotspots sem criar novos shells paralelos |
| RSK-007 | Codigo morto/wrapper reduz rastreabilidade | baixa | baixa | risco residual em aliases sem consumidor real | manter limpeza continua e remover wrappers redundantes assim que identificados |
| RSK-008 | Regressao silenciosa por processo antigo rodando | media | media | observacao operacional recorrente em roteamento | Reiniciar processo e validar `/health` em toda verificacao de rota |
| RSK-009 | Lacunas de cobertura em alteracao de dispatcher | alta | media | concentracao de risco em entrypoint e handlers | Adicionar testes focados em wiring e contrato (HTTP real) |

## Riscos prioritarios (ordem de ataque)
1. RSK-001 (wiring principal de rotas).
2. RSK-009 (cobertura de contrato).
3. RSK-002 (bootstrap/runtime).
4. RSK-004 (hotspots especializados remanescentes).

## Atualizacao de risco (2026-03-20)
- `RSK-001` foi reduzido de "alta/media" para "media/media" no estado atual.
Motivo: dezessete dominios (`public-system`, `auth`, `pbx`, `vertical`, `webhooks`, `operations-dashboard`, `qa`, `voice`, `web-scraping`, `rpa-tests`, `dev-management`, `intelligence`, `market-intelligence`, `access-control`, `analytics`, `bulk-campaigns`, `quick-replies`) sairam do builder central de `registerRoutes.js` para composition roots dedicados com validacao de wiring e smoke de contrato.
- Risco operacional de duplicacao de helper `requireTenant` em composition roots foi mitigado.
Mitigacao aplicada: helper compartilhado `api/composition/shared/requireTenant.js` adotado por 11 composition roots (`core`, `rag`, `pbx`, `vertical`, `operations-dashboard`, `intelligence`, `market-intelligence`, `access-control`, `analytics`, `bulk-campaigns`, `quick-replies`) com validacao por `node --check`, suites de wiring e `api/server.test.js`.
- `RSK-005` caiu para "baixa/baixa": `DataGrid` foi removido e `PlatformGrid` tornou-se o unico grid ativo.
- `RSK-006` caiu para "baixa/baixa": variantes paralelas do DevDashboard ja nao existem e os dashboards compartilhados passaram a ter barrel canonico em `modules/dashboard-base`.

## Controles por onda
- ONDA 2: proteger bootstrap/shutdown/workers com extrações sem mudanca de comportamento.
- ONDA 3: garantir regressao zero em roteamento via testes de wiring.
- ONDA 5-6: reduzir divergencia de UI com componentes canonicos e migracao gradual.
- ONDA 7: remover legado somente apos validacao de uso e rollback documentado.

## Triggers de rollback
- Aumento de 4xx/5xx em rotas criticas apos deploy.
- Falha de inicializacao de DB/migrations/seed no boot.
- Worker core sem heartbeat apos startup.
- Falha de renderizacao em dashboard/grid em paginas canonicamente migradas.
