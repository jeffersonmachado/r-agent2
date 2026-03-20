# Relatorio de Riscos Arquiteturais

## Escala
- Severidade: baixa, media, alta.
- Probabilidade: baixa, media, alta.

## Riscos identificados

| ID | Risco | Severidade | Probabilidade | Evidencia | Mitigacao |
|---|---|---|---|---|---|
| RSK-001 | Regressao de rota ao extrair `api/server.js` | alta | media | 66 handlers encadeados manualmente em `server.js` | Criar registry de handlers + testes de contrato HTTP por rota critica |
| RSK-002 | Falha de bootstrap em producao | alta | media | `startInitialization` concentra DB connect, migrate, seed e inicializacoes | Extrair bootstrap com testes de inicializacao e fallback controlado |
| RSK-003 | Worker nao inicializa apos refactor | media | media | startup de workers distribuido no bloco final do `server.js` | Encapsular startup em modulo unico com logs e asserts por worker |
| RSK-004 | Custo alto para dividir handlers gigantes | media | alta | `pbxRoutes.js` (2043 linhas), `ticketRoutes.js` (1526), `ragDocumentsRoutes.js` (1442) | Decompor por subdominio e congelar contratos antes de dividir |
| RSK-005 | Divergencia frontend por coexistencia de grid | media | alta | `DataGrid` com uso amplo em paginas PBX; `platform-grid` ainda com baixa adocao externa | Definir grid canonico + adapter e plano de migracao por pagina |
| RSK-006 | Duplicacao de dashboard e confusao de versao | media | media | `DevDashboardPage.jsx`, `.refactored.jsx` e `.jsx.backup` coexistem | Declarar arquivo canonico e remover variantes por fase |
| RSK-007 | Codigo morto/wrapper reduz rastreabilidade | baixa | baixa | risco residual em aliases sem consumidor real | manter limpeza continua e remover wrappers redundantes assim que identificados |
| RSK-008 | Regressao silenciosa por processo antigo rodando | media | media | observacao operacional recorrente em roteamento | Reiniciar processo e validar `/health` em toda verificacao de rota |
| RSK-009 | Lacunas de cobertura em alteracao de dispatcher | alta | media | concentracao de risco em entrypoint e handlers | Adicionar testes focados em wiring e contrato (HTTP real) |

## Riscos prioritarios (ordem de ataque)
1. RSK-001 (roteamento principal).
2. RSK-002 (bootstrap).
3. RSK-009 (cobertura de contrato).
4. RSK-003 (workers).

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
