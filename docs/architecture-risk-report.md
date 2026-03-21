# Relatorio de Riscos Arquiteturais

## Escala
- Severidade: baixa, media, alta.
- Probabilidade: baixa, media, alta.

## Riscos atuais

| ID | Risco | Severidade | Probabilidade | Evidencia | Mitigacao |
|---|---|---|---|---|---|
| RSK-001 | Regressao de rota na poda final da camada legada | media | baixa | `api/modules/*` ja nao importa `serverHandlers` e o diretorio `api/serverHandlers/*` foi removido | manter smoke HTTP + suites de wiring para impedir reintroducao do caminho legado |
| RSK-002 | Reacoplamento central via novos atalhos de wiring | media | baixa | `server.js` e `registerRoutes.js` ja foram reduzidos, mas ainda ha risco de recolocar atalhos centrais | manter guardrails de entrypoint/registry e evitar recolocar builders no centro |
| RSK-003 | Falha de bootstrap/runtime apos novas extracoes | media | baixa | boot foi redistribuido para `api/bootstrap/*` e `api/runtime/*` | manter testes de idempotencia, shutdown e startup no gate final |
| RSK-004 | Documentacao voltar a divergir do codigo | media | media | docs historicos declaravam backend fechado antes da hora | manter snapshot honesto e atualizar os 7 docs obrigatorios a cada onda |
| RSK-005 | Reintroducao de `buildDeps` inline em `registerRoutes.js` | baixa | baixa | guardrail estrutural agora cobre esse caso | manter teste `backendArchitectureGuardrails` |
| RSK-006 | Reintroducao silenciosa de bridge compartilhado de handlers | baixa | baixa | o bridge compartilhado foi removido e o risco restante e alguem recolocar adaptacao generica em vez de wiring local | manter guardrails com budget zero para `mountExpressHandler` / `createExpressHandlerMiddleware` |

## Atualizacao de risco deste ciclo
- Risco em `server.js` caiu de hotspot operacional para entrypoint fino.
- Risco em `registerRoutes.js` caiu de hotspot de wiring para registry declarativo.
- O risco principal deslocou-se para evitar a reintroducao de bridge compartilhado ou novo caminho concorrente de wiring fora dos modulos.
- O risco de bootstrap/runtime caiu mais um degrau com testes diretos de idempotencia de `startInitialization()` e de `registerShutdownHooks()`.
