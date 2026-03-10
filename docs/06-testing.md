# 06 — Testing

## Estratégia de testes

A estratégia combina cobertura em camadas:

1. **Unitário**: regras de domínio e utilitários.
2. **Contrato/API**: handlers e respostas HTTP.
3. **Integração**: fluxos entre módulos backend.
4. **Frontend**: componentes, hooks e páginas operacionais.
5. **Regressão**: suíte full backend + frontend.

## Comandos principais

### Testes gerais (raiz)

```bash
npm test
npm run test:all
```

### Backend

```bash
npm run test:backend:full
npm run test:backend:full:no-rpa
npm run test:websocket
```

### Frontend

```bash
npm run test:frontend:full
```

### Regressão completa

```bash
npm run test:regression:full
npm run test:regression:full:no-rpa
```

## Cobertura operacional prioritária

### Backend (quick actions e rotas)

- `api/core/operational-quick-actions/__tests__/OperationalQuickActionRegistry.test.js`
- `api/core/operational-quick-actions/__tests__/QuickActionExecutor.test.js`
- `api/core/operational-quick-actions/__tests__/QuickActionAccess.test.js`
- `api/core/operational-quick-actions/__tests__/QuickActionContextGuard.test.js`
- `api/core/operational-quick-actions/__tests__/QuickActionsAPI.test.js`
- `api/core/operational-recommendations/__tests__/OutcomeTrackingService.test.js`
- `api/core/operational-outcomes/__tests__/OperationalOutcomeEngine.test.js`
- `api/server.test.js` (rotas operacionais, auth e guardas)
- `api/core/operational-agent/__tests__/OperationalSignalRegistry.v2.test.js`
- `api/core/operational-state/__tests__/featureGates.test.js`

### Frontend (OCC e recomendações)

- `frontend/src/pages/OperationalControlCenter.test.jsx`
- `frontend/src/modules/recommendations/hooks/__tests__/useQuickActions.test.js`
- `frontend/src/modules/recommendations/components/__tests__/QuickActionsBar.test.jsx`
- `frontend/src/modules/recommendations/components/__tests__/QuickActionButton.test.jsx`
- `frontend/src/modules/recommendations/components/__tests__/QuickActionDialog.test.jsx`

## Boas práticas

- Rodar primeiro o escopo afetado pela mudança (rápido), depois regressão mais ampla.
- Para alterações de quick actions, validar sempre:
  - listagem por origem (signal/recommendation),
  - execução com payload válido,
  - criação automática de outcome + ligação com memória operacional,
  - rejeição de ação inválida,
  - bloqueio por permissão/contexto.
- Não aprovar mudanças operacionais sem cobertura mínima de backend + frontend.

## Critério de pronto para mudanças operacionais

Uma mudança em operação é considerada pronta quando:

- Fluxo funcional validado no escopo alterado.
- Testes automatizados relevantes passam.
- Erros retornam códigos e mensagens consistentes.
- Não há regressão de autorização no escopo admin/contato.

## Validação de consistência de migração (v1 ↔ v2)

Executar após migrações e durante rollout:

```bash
npm run check:operational-state-v2
node scripts/check-operational-state-v2-consistency.js --tenant=<tenantKey>
```

- Exit code `0`: consistente (ou divergência permitida com `--allow-mismatch`).
- Exit code `2`: divergência encontrada entre IDs v1 e v2.
