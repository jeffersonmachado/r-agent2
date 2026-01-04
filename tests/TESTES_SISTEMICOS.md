# Testes Sistêmicos - Guia de Execução

Este documento descreve os testes sistêmicos criados para auditoria completa do sistema.

## 📋 Categorias de Testes

### 1. Contratos (IA + QA + Governança)
**Arquivo:** `tests/contracts/contractValidation.test.js`

Valida que schemas de contratos rejeitam payloads inválidos.

**Executar:**
```bash
npm run test:contracts
```

### 2. Governança (Policy, WARN, SLA)
**Arquivo:** `tests/governance/governancePolicy.test.js`

Testa policyEvaluator, warnApprovalValidator, timeEvaluator.

**Executar:**
```bash
npm run test:governance
```

### 3. CI - Anti-bypass
**Arquivo:** `tests/ci/antiBypass.test.js`

Garante que wrappers são obrigatórios e gate não pode ser chamado diretamente.

**Executar:**
```bash
npm run test:ci
```

### 4. Runtime - Escalonamento
**Arquivo:** `tests/runtime/runtimeEscalation.test.js`

Valida escalonamento de falhas recorrentes e geração de QaResult.

**Executar:**
```bash
npm run test:runtime
```

### 5. Organizacional - Papéis e Aprovação
**Arquivo:** `tests/organizational/organizationalRoles.test.js`

Valida papéis, aprovações WARN e escalonamento de SLA.

**Executar:**
```bash
npm run test:organizational
```

### 6. Stress Test Sistêmico
**Arquivo:** `tests/stress/systemStress.test.js`

Testa bloqueio sem quebrar e prevenção de ações perigosas.

**Executar:**
```bash
npm run test:stress
```

### 7. Rate Limiting
**Arquivo:** `tests/rate-limit/rateLimit.test.js` e `tests/rate-limit/integration.test.js`

Testa sistema de rate limiting:
- Políticas de rate limiting (DRY_RUN, GENERATION_REAL, BOOTSTRAP, SCRAPING)
- Rate limiting por domínio e execução (scraping)
- Integração com Redis
- Bloqueio de execuções quando limite é excedido
- Auditoria de eventos

**Executar:**
```bash
npm run test:rate-limit
```

## 🚀 Executar Todos os Testes Sistêmicos

Para executar todas as categorias de testes sistêmicos de uma vez:

```bash
npm run test:system
```

## 📊 Executar Todos os Testes (Incluindo Sistêmicos)

Para executar TODOS os testes do projeto (unitários, funcionais, sistêmicos):

```bash
npm run test:all
```

## 🔄 Integração com Pipeline Principal

O pipeline principal (`npm test`) executa testes funcionais em ordem:
1. Testes unitários
2. Validação estrutural de fluxos
3. Validação de dados
4. Scripts de conversa
5. Testes RPA E2E

Os testes sistêmicos são **complementares** e podem ser executados:
- Separadamente por categoria
- Todos juntos via `npm run test:system`
- Junto com todos os testes via `npm run test:all`

## ✅ Verificação de Cobertura

Após executar os testes, verifique o relatório em:
```
qa/test-report.json
```

Este relatório contém:
- Categorias testadas
- Testes reutilizados
- Novos testes criados
- Gaps de cobertura
- Status do sistema

## 📝 Notas

- Todos os testes seguem o padrão Jest existente
- Testes reutilizam helpers e padrões do projeto
- Nenhum teste foi duplicado
- Cobertura aumentada apenas onde faltava

