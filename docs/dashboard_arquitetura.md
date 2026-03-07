
# Arquitetura de Dashboards – Plataforma r-agent2

Este documento descreve a análise das telas de dashboard atualmente existentes no projeto **r-agent2** e propõe uma organização arquitetural para padronização, reutilização e evolução futura da interface.

---

# 1. Tipos de dashboards identificados no sistema

Durante a análise das telas existentes, foi identificado que o termo **“dashboard”** está sendo usado para diferentes tipos de páginas. Na prática existem quatro categorias distintas.

| Categoria | Descrição | Exemplos atuais |
|---|---|---|
| Hub Operacional | Página de entrada com cards de navegação e visão rápida da operação | DashboardPage, ChatHumanoDashboardPage, QueuePhysicalDashboardPage, CrmDashboardPage |
| Dashboard Analítico | Painéis com métricas, KPIs, gráficos e análise de dados | AnalyticsPage, crm/AnalyticsDashboard, SupervisorPage |
| Workspace Vertical | Mistura de operação, cadastros e métricas de um domínio específico | BeautyDashboard, FitnessDashboard |
| Dashboard Técnico | Painéis de monitoramento do sistema e infraestrutura | SystemStatusPage, DevDashboardPage |

---

# 2. Dashboards existentes identificados

- DashboardPage — hub central da aplicação
- AnalyticsPage — painel analítico principal da plataforma
- BeautyDashboard — workspace vertical do módulo de beleza
- FitnessDashboard — workspace vertical do módulo fitness
- ChatHumanoDashboardPage — hub do atendimento humano
- QueuePhysicalDashboardPage — hub operacional de filas físicas
- DevDashboardPage — dashboard técnico de desenvolvimento
- SystemStatusPage — monitoramento da saúde do sistema
- CrmDashboardPage — hub do CRM
- crm/AnalyticsDashboard — dashboard analítico do CRM

---

# 3. Problema arquitetural identificado

Atualmente diferentes conceitos estão sendo chamados de **dashboard**, mas na prática representam funcionalidades diferentes:

- hubs de navegação
- dashboards analíticos
- workspaces operacionais
- monitoramento técnico

Isso dificulta:

- padronização visual
- reutilização de componentes
- evolução da arquitetura
- manutenção do frontend

---

# 4. Proposta de arquitetura

A proposta é dividir a arquitetura de interface em três módulos principais reutilizáveis.

## PlatformGrid
Componente padrão para:

- listas
- tabelas
- filtros
- paginação
- ordenação
- ações por linha
- seleção de registros

Usado principalmente em:

- `/support`
- listas administrativas
- CRM
- documentos
- auditoria
- cadastros

---

## PlatformDashboard

Base para dashboards analíticos.

Responsável por:

- KPIs
- gráficos
- filtros globais
- seções analíticas
- widgets

Pode conter blocos tabulares usando **PlatformGrid**.

---

## PlatformHub

Estrutura para páginas de navegação operacional baseadas em cards.

Usado para:

- hubs de módulos
- cockpit operacional
- atalhos para funcionalidades

---

# 5. Classificação recomendada das telas atuais

| Tela | Categoria recomendada |
|---|---|
| DashboardPage | PlatformHub |
| ChatHumanoDashboardPage | PlatformHub |
| QueuePhysicalDashboardPage | PlatformHub |
| CrmDashboardPage | PlatformHub |
| AnalyticsPage | PlatformDashboard |
| crm/AnalyticsDashboard | PlatformDashboard |
| SystemStatusPage | PlatformDashboard (variante técnica) |
| DevDashboardPage | Dashboard técnico |
| BeautyDashboard | Workspace vertical usando PlatformDashboard + PlatformGrid |
| FitnessDashboard | Workspace vertical usando PlatformDashboard + PlatformGrid |

---

# 6. Ordem recomendada de implementação

1. Implementar **lazy loading das páginas no main.jsx**
2. Criar o módulo reutilizável **PlatformGrid**
3. Migrar telas de listagem como `/support` e listas administrativas
4. Criar a base **PlatformDashboard** para métricas e KPIs
5. Padronizar dashboards analíticos existentes
6. Criar base **PlatformHub** para hubs operacionais
7. Adaptar dashboards verticais (Beauty e Fitness) gradualmente

---

# 7. Benefícios esperados

- redução de código duplicado
- padronização visual
- maior consistência entre telas
- criação mais rápida de novas telas
- melhor organização arquitetural
- melhor desempenho com lazy loading
- manutenção mais simples
- maior escalabilidade da plataforma

---

# Resumo da arquitetura futura

Frontend da plataforma passará a ter três pilares principais:

```
PlatformGrid
    ↓
Listas operacionais

PlatformDashboard
    ↓
KPIs, gráficos e análise

PlatformHub
    ↓
Entrada operacional dos módulos
```

Essa separação permite que cada tipo de interface evolua de forma independente, mantendo consistência visual e arquitetural em toda a plataforma.
