# AUDITORIA ESTRUTURAL - ETAPA 1

**Data**: 11 de março de 2026  
**Objetivo**: Mapear arquitetura existente antes de implementar verticais bakery, pizzeria, clinic, market

---

## 1. CORE OPERACIONAL EXISTENTE

### 1.1 ServiceOperationsKernel (Núcleo Orquestrador)
**Localização**: `api/core/service-operations-kernel/ServiceOperationsKernel.js`

**Responsabilidades**:
- Coordena toda operação da plataforma
- Integra eventos, sinais, recomendações, decisões e ações
- Gerencia estado operacional e outcomes
- Interface única para operações autonômicas

**Componentes Integrados**:
```
evento           → ingestEvent() / observeEvent()
sinais           → generateTenantSignals() / generateForContact()
recomendações    → generateTenantRecommendations()
decisões         → decisionEngine (fazer query)
ações            → actionsService (executar)
outcomes         → outcomesService (registrar resultado)
memória          → memoryService (aprendizado)
estado           → stateReadService / stateSnapshotService
context          → contextService (assembler)
OCC queries      → occQueryService (projeções)
```

### 1.2 Camadas Operacionais Canônicas

| Camada | Módulo | Status | Responsabilidade |
|--------|--------|--------|------------------|
| **Evento** | `operational-events` | ✅ Existente | Ingerir eventos, auditoria, broadcast |
| **Sinal** | `operational-signals` | ✅ Existente | Detectar padrões, gerar alertas |
| **Recomendação** | `operational-recommendations` | ✅ Existente | Sugerir ações baseado em sinais |
| **Decisão** | `operational-decision` | ✅ Existente | Engine de decisão com registro de OCC |
| **Ação** | `operational-actions` | ✅ Existente | Executar playbooks, quick actions |
| **Outcome** | `operational-outcomes` | ✅ Existente | Registrar resultados, learning |
| **Memória** | `operational-memory` | ✅ Existente | Memory/state for learning |
| **Estado** | `operational-state` | ✅ Existente | Snapshots, projeções, queries |
| **Context** | `operational-context` | ✅ Existente | Assembly de contexto |
| **Playbooks** | `operational-playbooks` | ✅ Existente | Orquestração de fluxos |
| **Quick Actions** | `operational-quick-actions` | ✅ Existente | Ações rápidas e recomendadas |

---

## 2. TEMPLATES VERTICAIS EXISTENTES

### 2.1 VerticalTemplateRegistry
**Localização**: `api/core/autonomous-scheduling/VerticalTemplateRegistry.js`

**Verticais Atuais (com presets)**:

#### Beauty
- policyDefaults: janelas preferenciais, gap mínimo, recorrência
- runtimeDefaults: intervalo de execução, limites de campanhas
- rankingWeights: priorização de waitlist, afinidade, lealdade
- predictiveThresholds: risco de inatividade, no-show
- revenueDefaults: ticket médio, foco de receita

#### Fitness
- policyDefaults: horários prime (6-9, 17-21), recorrência semanal
- runtimeDefaults: kiosk habilitado
- rankingWeights: priorização de lead, capacidade
- predictiveThresholds: risco de dropout, attendance

#### Food (parcial)
- policyDefaults: horários de refeição, recorrência curta
- runtimeDefaults: configuração básica

---

## 3. INTEGRAÇÕES EXISTENTES

### 3.1 CRM Operacional
**Localização**: `api/core/crm/`

**Responsabilidades**:
- Gerenciar contatos/clientes
- Histórico de interações
- Event writer para eventos operacionais

### 3.2 Conversations
**Localização**: `engine/`

**Responsabilidades**:
- Orquestração de diálogos/flows
- Nós: business_entry, fallback, ai_task, etc
- State machine para conversa

### 3.3 Tickets/Support
**Localização**: `api/core/support/` (parcial em `api/routes/support/`)

**Responsabilidades**:
- Gestão de tickets
- Fila de suporte
- Escalação

### 3.4 Queue
**Localização**: `api/core/queue/` (implícito via scheduling)

**Responsabilidades**:
- Gestão de filas
- Chamada de clientes

### 3.5 Orders
**Localização**: `api/services/` (implícito via operações)

**Responsabilidades**:
- Criação e tracking de pedidos
- Payment integration

### 3.6 Scheduling/Autonomous Scheduling
**Localização**: `api/core/autonomous-scheduling/`

**Responsabilidades**:
- Agendamento autônomo
- Campanhas
- Previsões

### 3.7 Automation Runtime
**Localização**: `engine/` + `api/core/operational-playbooks/`

**Responsabilidades**:
- Execução de fluxos
- Playbooks
- Quick actions

### 3.8 AI Layer
**Localização**: `api/services/`, `rag/`

**Responsabilidades**:
- Geração de conteúdo
- RAG / context
- Intent classification

### 3.9 Outcomes/Memory
**Localização**: `api/core/operational-outcomes/`, `api/core/operational-memory/`

**Responsabilidades**:
- Registrar decisões
- Learning / outcome reuse
- Historical patterns

---

## 4. FRONTNEND EXISTENTE

### 4.1 Páginas Principais
- `frontend/src/pages/AutonomousSchedulingPage.jsx` - Dashboard de agendamento
- `frontend/src/pages/SupportPage.jsx` - Dashboard de suporte
- `frontend/src/pages/TicketMaintenancePage.jsx` - Gestão de tickets

### 4.2 Módulos Operacionais
- `frontend/src/modules/support-workspace/` - UI de suporte
- `frontend/src/modules/recommendations/` - Dashboard de recomendações

---

## 5. DOCUMENTAÇÃO ARQUITETURAL EXISTENTE

| Arquivo | Cobertura |
|---------|-----------|
| `docs/02-architecture.md` | Overview da arquitetura, menção a operational core |
| `docs/04-architecture-overview.md` | Visão geral técnica |
| `docs/05-operational-brain.md` | Detalhes do operational core |
| `docs/09-autonomous-operations-architecture.md` | Operational + verticals |
| `docs/16-architectural-convergence-waves.md` | Ondas de refactor (9-19) |

---

## 6. CONFLITOS SEMÂNTICOS IDENTIFICADOS

### 6.1 Naming Duplicado
| Conceito | Variações | Problema |
|----------|-----------|---------|
| Modelo | operational-state, operational-state-v2 | Confusão de versão |
| Vertical | verticalTemplate, vertical templates | Falta de padronização |
| Evento | event types mistos em CRM, events | Falta de namespace claro |

### 6.2 Estruturas Paralelas Potenciais
- CRM operacional vs operational-events (possível duplicação)
- Scheduling vs operational-pipeline (similaridade)
- Quick actions vs actions service (pode consolidar)

---

## 7. CÓDIGO DUPLICADO / REAPROVEITAÇÃO

### 7.1 O que Deve ser Reutilizado

**Para todas as verticais**:
- ServiceOperationsKernel (orquestrador)
- operational-events (evento backbone)
- operational-signals (detecção de padrões)
- operational-decisions (engine de decisão)
- operational-recommendations (sugestões)
- operational-actions (execução)
- operational-outcomes (learning)
- operational-memory (memória)
- operational-playbooks (fluxos)
- operational-quick-actions (ações rápidas)
- automation runtime (engine)

**Parcialmente**:
- VerticalTemplateRegistry (estender com bakery, pizzeria, clinic, market)
- CRM operacional (adaptar por vertical)

### 7.2 O que Não Deve ser Criado em Paralelo

- ❌ Novo kernel/orquestrador
- ❌ Novo event backbone
- ❌ Novas decision engines
- ❌ Novos systems de actions/outcomes

---

## 8. PONTOS DE INTEGRAÇÃO PARA NOVAS VERTICAIS

### 8.1 Integração com ServiceOperationsKernel
Cada vertical deve invocar o kernel para:
- Ingerir eventos
- Consultar sinais
- Gerar recomendações
- Executar decisões
- Registrar outcomes

### 8.2 Integração com VerticalTemplateRegistry
Cada vertical deve ter presets para:
- policyDefaults
- runtimeDefaults
- rankingWeights
- predictiveThresholds
- revenueDefaults
- (+ customizações por vertical)

### 8.3 Integração com Plataforma
- Usar CRM existente (contatos)
- Usar queue existente (filas)
- Usar campaigns existentes (marketing)
- Usar automation runtime (fluxos)

---

## 9. DECISÕES ARQUITETURAIS OBRIGATÓRIAS

### 9.1 Padrão de Implementação
```
event → state → decision → action → outcome
```

Sem exceção. Cada vertical segue este padrão.

### 9.2 Sem Forks Arquiteturais
- Nenhuma vertical cria seu próprio kernel
- Nenhuma vertical cria seu próprio event backbone
- Nenhuma vertical cria seu próprio decision engine
- Todas são adaptações, não alternativas

### 9.3 VerticalAdapter vs VerticalTemplate
- **VerticalTemplate** = configuração/defaults
- **VerticalAdapter** = comportamento operacional especializado (NOVO)

---

## 10. PRÓXIMAS ETAPAS

### ETAPA 1 ✅ Concluída
Auditoria estrutural realizada.

### ETAPA 2 (PRÓXIMA)
Criar camada `api/core/verticals/` com:
- BakeryOperationsAdapter
- PizzeriaOperationsAdapter
- ClinicOperationsAdapter
- MarketOperationsAdapter

Cada adapter expõe:
- vocabulary
- operationalEntities
- eventMappings
- statePriorities
- decisionPolicies
- quickActions
- recommendedPlaybooks
- kpiDefinitions

### ETAPA 3 (APÓS ETAPA 2)
Integrar com VerticalTemplateRegistry:
- Adicionar presets para bakery
- Adicionar presets para pizzeria
- Adicionar presets para clinic
- Adicionar presets para market

---

## ANEXO A: FILE TREE RESUMIDO

```
api/core/
  ├── service-operations-kernel/          (KERNEL)
  ├── operational-events/                 (EVENTO)
  ├── operational-signals/                (SINAL)
  ├── operational-recommendations/        (RECOMENDAÇÃO)
  ├── operational-decision/               (DECISÃO)
  ├── operational-actions/                (AÇÃO)
  ├── operational-outcomes/               (OUTCOME)
  ├── operational-memory/                 (MEMÓRIA)
  ├── operational-state/                  (ESTADO)
  ├── operational-context/                (CONTEXT)
  ├── operational-playbooks/              (PLAYBOOKS)
  ├── operational-quick-actions/          (QUICK ACTIONS)
  ├── crm/                                (CRM)
  ├── autonomous-scheduling/              (TEMPLATES + SCHEDULING)
  └── verticals/                          (NOVA CAMADA - ETAPA 2)
      ├── bakery/
      ├── pizzeria/
      ├── clinic/
      └── market/

engine/
  ├── runner.js                           (EXECUTION)
  ├── nodes/                              (FLOW NODES)
  └── fallbackController.js               (FALLBACK)

frontend/
  ├── src/pages/                          (PAGES)
  ├── src/modules/                        (MODULES)
  └── src/components/                     (SHARED COMPONENTS)
```

---

**Conclusão**: A plataforma tem uma arquitetura sólida e bem estruturada com o ServiceOperationsKernel como orquestrador central. O caminho para adicionar novas verticais é criar adapters especializados que reutilizam completamente o core, sem criar forks ou estruturas paralelas.
