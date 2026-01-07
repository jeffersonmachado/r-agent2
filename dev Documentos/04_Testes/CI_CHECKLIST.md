# Checklist de CI - Sistema de Testes

Este documento define o checklist obrigatório para integração contínua (CI) do sistema de testes.

## ✅ Checklist Obrigatório

### 1. Preparação do Ambiente

- [ ] Executar `npm install` para instalar dependências
- [ ] Verificar que diretório `/api/data/test` existe ou será criado
- [ ] Verificar que seeds estão presentes em `/tests/seeds/`

### 2. Pipeline de Testes (Ordem Obrigatória)

#### 2.1 Testes Unitários
```bash
npm run test:unit
```
- [ ] Todos os testes unitários passam
- [ ] **BLOQUEIO**: Se falhar, pipeline para aqui

#### 2.2 Validação Estrutural
```bash
npm run test:flow
```
- [ ] Validação estrutural de fluxos passa
- [ ] **BLOQUEIO**: Se falhar, dados e scripts não executam

#### 2.3 Seed de Dados
```bash
npm run seed:test
```
- [ ] Seeds são populados com sucesso
- [ ] Dados salvos em `/api/data/test/`
- [ ] **BLOQUEIO**: Se falhar, gate de dados falhará

#### 2.4 Gate de Dados (Validação de Dados)
```bash
npm run test:data
```
- [ ] Gate de dados passa (validação explícita)
- [ ] Verifica: departments, queues, agents, config
- [ ] Verifica coerência entre entidades
- [ ] **BLOQUEIO CRÍTICO**: Se falhar, scripts NÃO executam
- [ ] Mensagem de erro clara se gate falhar

#### 2.5 Scripts de Conversa
```bash
npm run test:scripts
```
- [ ] Scripts verificam gate antes de executar
- [ ] Scripts validam dependências declaradas
- [ ] Scripts executam apenas se gate passou
- [ ] **BLOQUEIO**: Se gate falhou, scripts não executam

### 3. Validações Específicas do Gate de Dados

- [ ] `tests/data/dataValidation.test.js` existe e executa
- [ ] Helper `tests/helpers/dataValidationHelper.js` está disponível
- [ ] Scripts em `tests/scripts/` verificam gate antes de executar
- [ ] Mensagens de erro do gate são claras e descritivas

### 4. Validação de Dependências

- [ ] Scripts JSON declaram `requires` com dependências
- [ ] Dependências incluem: departments, queues, agents, flows, config
- [ ] Validação de dependências funciona corretamente

### 5. Critérios de Sucesso

#### Pipeline Completo Passa Se:
- ✅ Todos os testes unitários passam
- ✅ Validação estrutural passa
- ✅ Seeds são populados
- ✅ **Gate de dados passa (OBRIGATÓRIO)**
- ✅ Scripts executam (se gate passou)

#### Pipeline Falha Se:
- ❌ Qualquer teste unitário falha
- ❌ Validação estrutural falha
- ❌ Seeds não podem ser populados
- ❌ **Gate de dados falha (BLOQUEIA SCRIPTS)**
- ❌ Scripts tentam executar sem gate passar

## 🔄 Fluxo de CI Recomendado

```yaml
# Exemplo de pipeline CI (GitHub Actions, GitLab CI, etc.)

stages:
  - unit
  - flow
  - seed
  - data_gate
  - scripts

unit_tests:
  stage: unit
  script:
    - npm install
    - npm run test:unit
  # Falha aqui = pipeline para

flow_validation:
  stage: flow
  script:
    - npm run test:flow
  # Falha aqui = dados e scripts não executam

seed_data:
  stage: seed
  script:
    - npm run seed:test
  # Falha aqui = gate de dados falhará

data_gate:
  stage: data_gate
  script:
    - npm run test:data
  # Falha aqui = scripts NÃO executam (BLOQUEIO CRÍTICO)

scripts:
  stage: scripts
  script:
    - npm run test:scripts
  # Só executa se gate de dados passou
  # Falha aqui = scripts não executaram ou falharam
```

## 📋 Comandos Rápidos

### Executar Pipeline Completo
```bash
npm test
```

### Executar Apenas Gate de Dados
```bash
npm run test:data
```

### Verificar se Gate Está Funcionando
```bash
# 1. Popular dados
npm run seed:test

# 2. Executar gate
npm run test:data

# 3. Se gate passar, scripts podem executar
npm run test:scripts
```

### Testar Bloqueio do Gate
```bash
# 1. Remover arquivo de dados (exemplo)
rm api/data/test/config.json

# 2. Executar gate (deve falhar)
npm run test:data

# 3. Tentar executar scripts (deve ser bloqueado)
npm run test:scripts
# Esperado: Erro claro indicando que gate falhou
```

## 🎯 Frase-guia do Sistema

> **"Sem dados, testamos estrutura. Com dados, testamos comportamento."**

Esta frase deve ser lembrada em todas as decisões de CI:
- Sem dados válidos → apenas testes estruturais
- Com dados válidos → testes de comportamento (scripts)

## 📝 Notas Importantes

1. **Gate de dados é OBRIGATÓRIO**: Scripts não podem executar sem validação de dados
2. **Ordem importa**: unit → flow → seed → data → scripts
3. **Mensagens claras**: Erros devem indicar claramente qual etapa falhou
4. **Isolamento**: Dados de teste não misturam com produção (`tenant-test`)

---

**Última atualização:** 2025-01-01
**Status:** ✅ Checklist completo e validado

