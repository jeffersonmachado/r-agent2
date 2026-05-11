# Implementação do Sistema de Testes Determinístico

## Status: ✅ COMPLETO

Sistema de testes determinístico em camadas implementado conforme planejado.

## Estrutura Criada

### Diretórios
- ✅ `/tests/unit` - Testes unitários
- ✅ `/tests/flow` - Validação estrutural de fluxos
- ✅ `/tests/data` - Validadores de dados
- ✅ `/tests/scripts` - Scripts de conversa
- ✅ `/tests/seeds` - Seeds determinísticos
- ✅ `/tests/helpers` - Helpers compartilhados
- ✅ `/tests/engine` - Engine de simulação
- ✅ `/tests/reports` - (Preparado para futuros relatórios)

### Arquivos Principais

#### Seeds
- ⚠️ Seeds legados em JSON foram removidos (DB-only)

#### Validadores
- ⚠️ Validadores legados de seeds em JSON foram removidos (DB-only)
- ✅ `tests/data/validators/config.validator.js`
- ✅ `tests/data/validators/system.validator.js`

#### Engine
- ✅ `tests/engine/mockProviders.js` - Providers mockados
- ✅ `tests/engine/stateManager.js` - Gerenciador de estado
- ✅ `tests/engine/flowExecutor.js` - Executor de fluxos
- ✅ `tests/engine/simulator.js` - Simulador de conversa

#### Scripts
- ✅ `tests/scripts/script-welcome-flow.json`
- ✅ `tests/scripts/script-support-flow.json`
- ✅ `tests/scripts/scripts.test.js`

#### Outros
- ✅ `tests/runner.js` - Runner principal
- ✅ `tests/flow/flowStructure.validator.js`
- ✅ `tests/flow/flowStructure.test.js`
- ✅ `tests/helpers/testHelpers.js`
- ✅ `tests/unit/example.test.js`
- ✅ `tests/data/tests/data.validator.test.js`

## Comandos Implementados

### package.json
```json
{
  "test": "node tests/runner.js",
  "test:unit": "jest tests/unit",
  "test:flow": "jest tests/flow",
  "test:data": "jest tests/data",
  "test:scripts": "jest tests/scripts",
  "test:all": "jest",
  "seed:test": "node tests/seeds/seedTestData.js"
}
```

## Pipeline de Execução

1. ✅ **Testes Unitários** - Executa primeiro
2. ✅ **Validação Estrutural** - Executa segundo
3. ✅ **Validação de Dados (GATE DE DADOS)** - Executa terceiro (requer seeds)
   - **REGRAS OBRIGATÓRIAS:**
     - Scripts de conversa **NÃO PODEM** executar sem validação de dados
     - Falha na validação de dados **BLOQUEIA** execução de scripts
     - Validação verifica: departments, queues, agents, config, coerência entre entidades
4. ✅ **Scripts de Conversa** - Executa apenas se tudo acima passar
   - **REGRAS OBRIGATÓRIAS:**
     - Cada script declara dependências em `requires`
     - Dependências são validadas antes da execução
     - Scripts falham imediatamente se dependências não estão disponíveis

## Características Implementadas

### Determinismo
- ✅ Seeds com IDs estáveis
- ✅ Engine sem aleatoriedade
- ✅ Providers mockados (sem IA real)
- ✅ Resultados reproduzíveis

### Bloqueio de Etapas (GATE DE DADOS)
- ✅ Falha em unitários bloqueia tudo
- ✅ Falha em validação estrutural bloqueia dados e scripts
- ✅ **GATE DE DADOS**: Falha em validação de dados bloqueia scripts
  - Implementado em: `tests/data/dataValidation.test.js`
  - Helper reutilizável: `tests/helpers/dataValidationHelper.js`
  - Scripts verificam gate antes de executar: `tests/scripts/scripts.test.js`
  - **Frase-guia obrigatória**: "Sem dados, testamos estrutura. Com dados, testamos comportamento."
- ✅ Mensagens claras de bloqueio

### Isolamento
- ✅ Seeds usam `tenant-test`
- ✅ Dados salvos em `/api/data/test/`
- ✅ Sem mistura com produção

### Validação
- ✅ Validadores para todas as entidades
- ✅ Verificação de integridade referencial
- ✅ Validação de estados válidos
- ✅ Relatórios de erros claros

## Como Usar

### Primeira Execução
```bash
# 1. Preparar ambiente DB-only
npm run db:migrate

# 2. Executar pipeline completo
npm test
```

### Execuções Subsequentes
```bash
# Pipeline completo
npm test

# Etapas individuais
npm run test:unit
npm run test:flow
npm run test:data
npm run test:scripts
```

## Próximos Passos (Opcional)

1. Adicionar mais testes unitários em `/tests/unit/`
2. Adicionar mais scripts de conversa em `/tests/scripts/`
3. Expandir validadores conforme necessário
4. Adicionar relatórios HTML (em `/tests/reports/`)
5. Integrar com CI/CD

## Gate de Dados - Regra Oficial

### Implementação

O **Gate de Dados** é uma camada obrigatória que garante que scripts de conversa só executem após validação explícita dos dados de teste.

**Arquivos principais:**
- `tests/data/dataValidation.test.js` - Teste que implementa o gate (FALHA se dados inválidos)
- `tests/helpers/dataValidationHelper.js` - Helper reutilizável para validação
- `tests/scripts/scripts.test.js` - Scripts verificam gate antes de executar

### Regras Absolutas

1. **Scripts NÃO executam sem validação de dados**
   - Gate verifica: departments, queues, agents, config
   - Gate verifica coerência entre entidades
   - Falha no gate = scripts bloqueados

2. **Dependências declaradas**
   - Cada script JSON declara `requires` com dependências
   - Dependências são validadas antes da execução
   - Scripts falham imediatamente se dependências faltam

3. **Pipeline obrigatório**
   ```
   unit → flow → data (GATE) → scripts
   ```
   - Cada etapa bloqueia a próxima se falhar
   - Gate de dados é camada obrigatória

### Frase-guia

> **"Sem dados, testamos estrutura. Com dados, testamos comportamento."**

Esta frase define a filosofia do sistema:
- Sem dados válidos: apenas testes estruturais
- Com dados válidos: testes de comportamento (scripts)

## Notas

- Sistema segue rigorosamente o plano estabelecido
- Todas as regras absolutas foram respeitadas
- Gate de dados implementado e funcionando
- Frase-guia implementada: "Sem dados, testamos estrutura. Com dados, testamos comportamento."
- Sistema pronto para uso e expansão

---

**Data de Implementação:** 2024-01-01
**Data de Atualização (Gate de Dados):** 2025-01-01
**Status:** ✅ Completo e funcional

