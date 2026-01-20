# Hardening multi-tenant — Remoção de `tenant-demo` em runtime

Este documento lista ocorrências de `tenant-demo` e padrões de fallback no repositório, como base para remover qualquer comportamento “silencioso” em produção.

## Objetivo

- Em **runtime** (ex.: `api/server.js`, `api/services/*`, `api/db/models/*`) **não pode existir** fallback automático para `tenant-demo`.
- `tenant-demo` deve permanecer **apenas** em:
  - seeds/dev
  - testes
  - documentação local

## Padrões varridos (grep)

- `tenant-demo`
- `|| 'tenant-demo'`
- `= 'tenant-demo'`
- `defaultValue: 'tenant-demo'`

## Resultados — `tenant-demo`

### Runtime (`api/`)

> **Status**: Não foram encontradas ocorrências em código runtime. As ocorrências abaixo dentro de `api/` são **testes**.

- `api/server.test.js`
  - linha 199
  - linha 264
  - linha 277
  - linha 299
  - linha 362 (descrição do teste)
  - linha 376
  - linha 382
  - linha 402
  - linha 413
  - linha 430
  - linha 454
  - linha 505
  - linha 524

- `api/services/__tests__/authService.test.js`
  - linha 14 (comentário sobre remoção de fallback)

### Testes / RPA / Docs (permitido)

- `tests/frontend/login-flow.test.js`
  - linha 54
  - linha 209
  - linha 294

- `tests/rpa/createTenantByAI.test.js`
  - linha 295

- `tests/rpa/executar-replay-login.js`
  - linha 185

- `tests/rpa/login.test.js`
  - linha 22

- `tests/seeds/tenants.json`
  - linha 3

- `tests/seeds/tenant_contexts.json`
  - linha 3

- `tests/endpoints/tenants.test.js`
  - linha 46

- `tests/endpoints/EXPLICACAO_TESTES.md`
  - linha 31
  - linha 42
  - linha 44
  - linha 46

- `tests/rpa/README_LOGIN.md`
  - linha 40

- `tests/rpa/SUMMARY_LOGIN.md`
  - linha 64

- `tests/config.test.js`
  - linha 211
  - linha 250
  - linha 251
  - linha 253
  - linha 277
  - linha 289
  - linha 320

- `tests/tenant/aiProviderStatus.test.js`
  - linha 150
  - linha 151
  - linha 152
  - linha 176
  - linha 193
  - linha 251
  - linha 252
  - linha 253
  - linha 286
  - linha 290

- `tests/tenant/saasSecurity.test.js`
  - linha 37 (comentário sobre fallback)

- `frontend/src/__tests__/Login.flow.test.jsx`
  - linha 71
  - linha 76
  - linha 80
  - linha 94
  - linha 97
  - linha 123
  - linha 128
  - linha 132
  - linha 151
  - linha 159
  - linha 169
  - linha 175

## Resultados — `|| 'tenant-demo'`

- `tests/rpa/executar-replay-login.js`
  - linha 185

- `tests/rpa/login.test.js`
  - linha 22

## Resultados — `= 'tenant-demo'`

- `tests/endpoints/tenants.test.js`
  - linha 46

- `tests/frontend/login-flow.test.js`
  - linha 54
  - linha 209
  - linha 294

- `frontend/src/__tests__/Login.flow.test.jsx`
  - linha 169

## Resultados — `defaultValue: 'tenant-demo'`

> **Status**: Nenhuma ocorrência encontrada por este padrão.

## Próximos passos (implementação)

- Remover qualquer **fallback implícito** de tenant em runtime (mesmo que não use literal `tenant-demo`).
- Endpoints autenticados: sem tenant → **403** (`tenant_required`).
- Webhooks: sem tenant resolvido por canal → **200 OK + warn** e **não persistir** nada.

