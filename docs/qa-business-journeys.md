# QA de Jornadas de Negócio

Esta camada amplia o QA/RPA já existente com foco em negócio real, mantendo compatibilidade com a base atual de `tests/rpa`, `system:validate`, `system-autotest-stack` e `release-gate`.

## Arquitetura

- Nível A: `screen`
  Valida telas críticas com carregamento, interação básica, feedback e screenshot.
- Nível B: `flow`
  Valida fluxos intermediários de 2 a 4 passos, com assertivas de regra de negócio.
- Nível C: `journey`
  Valida jornadas ponta a ponta com evidência por etapa e checagem via estado do sistema.

Implementação principal:

- `tests/rpa/business/catalog.js`
- `tests/rpa/business/runtime.js`
- `tests/rpa/business/reporting.js`
- `tests/rpa/business/run.js`

## Catálogo Oficial

Gere o catálogo versionado:

```bash
npm run test:business-qa:catalog
```

Saídas:

- `tests/rpa/reports/business-qa-catalog.json`
- `tests/rpa/reports/business-qa-catalog.md`

Inclui:

- telas críticas fitness e beauty
- fluxos intermediários fitness e beauty
- jornadas F1, F2, B1 e B2

## Massa de Dados Controlada

Baseline idempotente:

```bash
npm run test:business-qa:seed
```

Reset seguro para baseline:

```bash
npm run test:business-qa:seed:reset
```

O reset reaplica o baseline determinístico em vez de apagar dados arbitrariamente. Isso evita quebrar outros testes e mantém compatibilidade com a stack atual.

Baseline criada:

- tenant de teste: `system` por padrão
- aluno fitness baseline
- membership fitness baseline
- campanha beauty baseline
- lead beauty baseline
- cliente beauty baseline
- billing sandbox habilitável por `BILLING_SANDBOX=1`

## Execução

Telas fitness e beauty:

```bash
npm run test:business-qa:screens
```

Fluxos intermediários:

```bash
npm run test:business-qa:flows
```

Jornadas completas:

```bash
npm run test:business-qa:journeys
```

Apenas fitness:

```bash
npm run test:business-qa:journeys -- --vertical=fitness
```

Apenas beauty:

```bash
npm run test:business-qa:journeys -- --vertical=beauty
```

Apenas F1:

```bash
npm run test:business-qa:journeys -- --code=F1
```

Apenas B1:

```bash
npm run test:business-qa:journeys -- --code=B1
```

Perfil PR/homolog/release:

```bash
npm run test:business-qa:pr
npm run test:business-qa:homolog
npm run test:business-qa:release
```

## Relatórios e Evidências

Arquivos gerados:

- `tests/rpa/reports/business-qa-*.json`
- `tests/rpa/reports/business-qa-*.md`
- `tests/rpa/reports/business-qa-latest.json`
- `tests/rpa/reports/business-qa-latest.md`
- `tests/rpa/screenshots/business-qa/*.png`

Formato principal por cenário:

- `status`
- `vertical`
- `type`
- `codigo`
- `etapas[]`
- `artefatos[]`
- `ids`
- `resumo`

## Integração com Pipeline

Integrações realizadas:

- `system:validate`
  Pode incluir Business QA PR quando `BUSINESS_QA_VALIDATE=1`.
- `scripts/system-autotest-stack.sh`
  Executa Business QA após a validação oficial.
- `.github/workflows/stack-test.yml`
  Executa stack com `BUSINESS_QA_MODE=pr`.
- `.github/workflows/release-window.yml`
  Executa stack com `BUSINESS_QA_MODE=release`.

Estratégia:

- PR: `test:business-qa:pr`
- Homologação: `test:business-qa:homolog`
- Release: `test:business-qa:release`

## Como Adicionar Nova Jornada

1. Adicione metadados em `tests/rpa/business/catalog.js`.
2. Implemente a execução em `tests/rpa/business/runtime.js`.
3. Garanta evidência por etapa e ids de negócio.
4. Reexecute:

```bash
npm run test:business-qa:catalog
npm run test:business-qa:journeys -- --code=SEU_CODIGO
```

## Observações

- A camada usa a infraestrutura real de autenticação RPA, Playwright, relatórios e screenshots já presentes no projeto.
- Para pagamento previsível, a recomendação é usar `BILLING_SANDBOX=1`.
- As jornadas validam UI quando faz sentido e estado do sistema/API para reduzir falso positivo.
