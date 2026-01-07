# Política de QA - Testes e Qualidade

## 📋 Visão Geral

Este documento define a política de qualidade e testes do projeto r-agent2, incluindo regras de bloqueio, SLAs e responsabilidades.

---

## 🎯 Tipos de Teste Obrigatórios

Conforme `contracts/qa/qa.contract.json`, os seguintes tipos de teste são obrigatórios:

1. **Unit Tests** (`test:unit`)
   - Testes unitários de componentes isolados
   - Cobertura mínima: 80%

2. **Flow Tests** (`test:flow`)
   - Testes de integração de fluxos
   - Validação de execução end-to-end

3. **Stress Tests** (`test:stress`)
   - Testes de carga e performance
   - Validação de limites do sistema

4. **RPA Tests** (`test:rpa`)
   - Testes automatizados de interface
   - Validação de fluxos através de replay
   - **OBRIGATÓRIO para: frontend, chatbot-flows**

---

## 🚫 Regras de Bloqueio

### Quando RPA Bloqueia Deploy

**RPA bloqueia deploy quando:**

1. ✅ **Falha crítica em teste RPA obrigatório**
   - Teste RPA de fluxo funcional falha
   - Teste RPA de componente frontend falha
   - Falha impede validação básica do fluxo

2. ✅ **Falha em múltiplos testes RPA**
   - Mais de 50% dos testes RPA falham
   - Falhas indicam problema sistêmico

3. ✅ **Falha em teste RPA de regressão**
   - Teste RPA que passava anteriormente falha
   - Indica quebra de funcionalidade existente

**RPA NÃO bloqueia deploy quando:**

1. ⚠️ **Avisos (WARN) não críticos**
   - Avisos de performance
   - Avisos de depreciação
   - Avisos de estilo

2. ⚠️ **Falha em teste RPA opcional**
   - Teste RPA não marcado como obrigatório
   - Teste RPA experimental

3. ⚠️ **Falha temporária de infraestrutura**
   - Timeout de rede
   - Serviço externo indisponível
   - Problema conhecido e documentado

---

## 👥 Quem Pode Ignorar WARN

### Níveis de Autorização

1. **Desenvolvedor (Developer)**
   - ❌ NÃO pode ignorar WARN de RPA
   - ❌ NÃO pode ignorar WARN de validação de fluxo
   - ✅ Pode ignorar WARN de estilo/linting (não críticos)

2. **Tech Lead / Senior Developer**
   - ✅ Pode ignorar WARN de performance (com justificativa)
   - ✅ Pode ignorar WARN de depreciação (com plano de migração)
   - ❌ NÃO pode ignorar WARN de RPA crítico
   - ❌ NÃO pode ignorar WARN de segurança

3. **QA Lead / QA Manager**
   - ✅ Pode ignorar WARN de RPA não crítico (com justificativa)
   - ✅ Pode aprovar bypass temporário de teste RPA
   - ❌ NÃO pode ignorar WARN de segurança
   - ❌ NÃO pode ignorar WARN de validação estrutural

4. **Engineering Manager / CTO**
   - ✅ Pode ignorar qualquer WARN (com justificativa documentada)
   - ✅ Pode aprovar bypass de bloqueio de deploy
   - ⚠️ Deve documentar decisão e plano de correção

### Processo de Ignorar WARN

1. **Justificativa obrigatória**
   - Documentar motivo do bypass
   - Definir prazo de correção
   - Criar issue/ticket de acompanhamento

2. **Aprovação necessária**
   - WARN crítico: aprovação de Tech Lead ou superior
   - WARN de RPA: aprovação de QA Lead ou superior
   - WARN de segurança: aprovação de CTO

3. **Rastreabilidade**
   - Todas as decisões são registradas em auditoria
   - Histórico disponível em `governance/audit/`

---

## ⏱️ SLA de Correção

### Prazos Máximos para Correção

1. **Falha Crítica de RPA**
   - **Prazo:** 24 horas
   - **Escalação:** Após 12 horas sem correção
   - **Bloqueio:** Deploy bloqueado até correção

2. **Falha de Validação de Fluxo**
   - **Prazo:** 48 horas
   - **Escalação:** Após 24 horas sem correção
   - **Bloqueio:** Deploy bloqueado até correção

3. **Falha de Teste Unitário**
   - **Prazo:** 72 horas
   - **Escalação:** Após 48 horas sem correção
   - **Bloqueio:** Deploy bloqueado após prazo

4. **WARN de Performance**
   - **Prazo:** 1 semana
   - **Escalação:** Após 5 dias sem correção
   - **Bloqueio:** Não bloqueia deploy, mas requer acompanhamento

5. **WARN de Depreciação**
   - **Prazo:** 1 mês
   - **Escalação:** Após 3 semanas sem correção
   - **Bloqueio:** Não bloqueia deploy, mas requer plano de migração

### Processo de Escalação

1. **Alerta inicial:** Notificação ao responsável
2. **Primeira escalação:** Notificação ao Tech Lead
3. **Segunda escalação:** Notificação ao Engineering Manager
4. **Escalação final:** Notificação ao CTO

---

## 🔄 Quando QA Runtime Vira Bloqueante

### Condições para Bloqueio em Runtime

1. **Falha em teste RPA obrigatório**
   - Teste RPA de fluxo funcional falha em produção
   - Teste RPA de componente crítico falha
   - **Ação:** Rollback automático (se configurado)

2. **Falha em múltiplos testes consecutivos**
   - 3 ou mais testes RPA falham consecutivamente
   - Indica problema sistêmico
   - **Ação:** Pausa de deploy até investigação

3. **Falha em teste de regressão**
   - Teste que passava anteriormente falha
   - Indica quebra de funcionalidade
   - **Ação:** Bloqueio de novas features até correção

4. **Falha crítica de validação**
   - Validação estrutural de fluxo falha
   - Validação de contrato falha
   - **Ação:** Bloqueio imediato de deploy

### Processo de Desbloqueio

1. **Correção do problema**
   - Desenvolvedor corrige o problema
   - Testes passam localmente

2. **Validação em ambiente de staging**
   - Testes RPA passam em staging
   - Validação de fluxo passa

3. **Aprovação de QA**
   - QA Lead valida correção
   - Aprova desbloqueio

4. **Desbloqueio automático**
   - Sistema desbloqueia após aprovação
   - Deploy pode prosseguir

---

## 📊 Métricas e Monitoramento

### Métricas Obrigatórias

1. **Cobertura de Testes**
   - Unit: mínimo 80%
   - Flow: mínimo 70%
   - RPA: mínimo 60% (fluxos críticos)

2. **Taxa de Sucesso**
   - Testes RPA: mínimo 95%
   - Testes Unit: mínimo 98%
   - Testes Flow: mínimo 90%

3. **Tempo de Execução**
   - Testes RPA: máximo 10 minutos
   - Testes Unit: máximo 5 minutos
   - Testes Flow: máximo 15 minutos

### Relatórios

- **Diário:** Resumo de falhas e WARNs
- **Semanal:** Relatório de cobertura e métricas
- **Mensal:** Análise de tendências e melhorias

---

## 🔐 Segurança e Compliance

### Regras de Segurança

1. **Nenhum teste pode expor dados sensíveis**
   - Dados de produção não podem ser usados em testes
   - Credenciais devem ser mockadas ou isoladas

2. **Testes RPA não podem modificar produção**
   - Testes devem usar ambiente isolado
   - Rollback automático em caso de falha

3. **Auditoria obrigatória**
   - Todas as decisões de bypass são auditadas
   - Histórico completo em `governance/audit/`

---

## 📝 Documentação

### Documentos Relacionados

- `contracts/qa/qa.contract.json` - Contrato formal de QA
- `contracts/generation.interface.json` - Interface de geração
- `PROJECT_RULES.md` - Regras do projeto (seção Testes RPA)
- `governance/audit/` - Registros de auditoria

### Atualizações

Este documento deve ser revisado:
- **Trimestralmente:** Revisão de políticas e SLAs
- **Quando necessário:** Mudanças significativas no processo
- **Após incidentes:** Ajustes baseados em lições aprendidas

---

**Última atualização:** 2025-01-03

