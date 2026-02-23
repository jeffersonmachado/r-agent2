# Dashboard CRM - Documentação

## 📊 Visão Geral

Dashboard CRM inspirado no modelo do **ChatHumanoDashboard**, oferecendo uma interface unificada para gerenciar todo o ciclo de vendas e relacionamento com clientes.

---

## 🚀 Acesso

**URL**: `/crm` ou `/crm-dashboard`

**Requisito**: Autenticação via token JWT

---

## 📈 Métricas em Tempo Real

O dashboard exibe 6 métricas principais que atualizam automaticamente a cada 60 segundos:

### 1. 🏢 **Contas**
- Total de empresas ativas no pipeline
- Fonte: `/api/crm/analytics/dashboard`

### 2. 👤 **Contatos**
- Pessoas cadastradas vinculadas às contas
- Permite navegação para gestão de contatos

### 3. 🎯 **Leads**
- Prospects em processo de qualificação
- Leads ativos no funil

### 4. 💼 **Oportunidades**
- Deals em negociação
- Total de oportunidades abertas

### 5. 💰 **Pipeline Value**
- Valor total do pipeline
- Formatação: R$ 2.5M, R$ 450k
- Soma de todas opportunities abertas

### 6. 📈 **Win Rate**
- Taxa de conversão (%)
- Calculado: (Ganhas / Total) × 100

---

## ⚡ Quick Actions

4 botões de ação rápida com gradiente para operações comuns:

1. **➕ Nova Conta** → `/crm/accounts`
2. **🎯 Novo Lead** → `/crm/leads`
3. **💼 Nova Oportunidade** → `/crm/opportunities`
4. **📞 Registrar Atividade** → `/crm/activities`

---

## 🔍 Sistema de Filtros

### Busca Textual
- Campo de texto para buscar módulos
- Filtra por nome OU descrição
- Case-insensitive

### Filtro por Categoria
- **Core CRM**: Contas, Contatos
- **Pipeline**: Leads, Oportunidades, Pipelines
- **Engajamento**: Atividades
- **Analytics**: Analytics, Relatórios
- **Marketing**: Campanhas
- **Integrações**: Webhooks
- **Governança**: Permissões, Auditoria

---

## 🧩 Módulos Disponíveis (12 Cards)

### 1. 🏢 **Contas (Accounts)**
- Empresas e organizações
- CRUD completo
- Categoria: Core CRM

### 2. 👤 **Contatos**
- Pessoas vinculadas às contas
- Informações de contato
- Categoria: Core CRM

### 3. 🎯 **Leads**
- Prospecção e qualificação
- Scoring automático
- Categoria: Pipeline

### 4. 💼 **Oportunidades**
- Gestão de negociações
- Tracking de deals
- Categoria: Pipeline

### 5. 📈 **Pipelines**
- Funis de vendas customizados
- Estágios configuráveis
- Categoria: Pipeline

### 6. 📝 **Atividades**
- Registro de chamadas, reuniões, emails
- Follow-ups e tarefas
- Categoria: Engajamento

### 7. 📊 **Analytics**
- Métricas de performance
- Conversão e receita
- Categoria: Analytics

### 8. 📈 **Relatórios**
- Dashboards de vendas
- Previsões de fechamento
- Categoria: Analytics

### 9. 📢 **Campanhas**
- Automação de marketing
- Nutrição de leads
- Categoria: Marketing

### 10. 🔗 **Webhooks**
- Integrações em tempo real
- Event-driven notifications
- Categoria: Integrações

### 11. 🔐 **Permissões (RBAC)**
- Controle de acesso granular
- Roles e policies
- Categoria: Governança

### 12. 📋 **Auditoria**
- Logs de ações
- Compliance e rastro
- Categoria: Governança

---

## 🎨 Design System

### Cores por Categoria
- **Core CRM**: Blue (#3B82F6)
- **Pipeline**: Purple (#A855F7), Orange (#F97316), Indigo (#6366F1)
- **Engajamento**: Cyan (#06B6D4)
- **Analytics**: Rose (#F43F5E), Amber (#F59E0B)
- **Marketing**: Pink (#EC4899)
- **Integrações**: Teal (#14B8A6)
- **Governança**: Slate (#64748B), Gray (#6B7280)

### Layout
- Grid responsivo: 1 col (mobile) → 4 cols (desktop)
- Cards com hover effect (shadow-lg)
- Badge de categoria no canto superior direito
- Ícone emoji + título + descrição

### Métricas
- Grid: 1 col (mobile) → 6 cols (desktop)
- Background: bg-bg-elevated
- Border: border-border-default
- Shadow: shadow-lg

---

## 📦 Páginas Criadas

### Páginas Completas
1. ✅ **CrmDashboardPage.jsx** - Dashboard principal
2. ✅ **AccountsPage.jsx** - Gestão de contas
3. ✅ **ContactsPage.jsx** - Gestão de contatos
4. ✅ **LeadsPage.jsx** - Gestão de leads
5. ✅ **OpportunitiesPage.jsx** - Gestão de oportunidades
6. ✅ **PipelinesPage.jsx** - Gestão de pipelines
7. ✅ **ActivitiesPage.jsx** - Registro de atividades
8. ✅ **AnalyticsPage.jsx** - Analytics (wrapper)
9. ✅ **AnalyticsDashboard.jsx** - Dashboard de métricas
10. ✅ **ReportsPage.jsx** - Relatórios e previsões
11. ✅ **CampaignsPage.jsx** - Campanhas de marketing
12. ✅ **WebhooksPage.jsx** - Webhooks e integrações
13. ✅ **RbacPage.jsx** - Permissões RBAC
14. ✅ **AuditPage.jsx** - Auditoria e logs

---

## 🔌 Integração com Backend

### API Endpoint Principal
```javascript
GET /api/crm/analytics/dashboard
```

**Resposta Esperada**:
```json
{
  "ok": true,
  "dashboard": {
    "summary": {
      "totalAccounts": 24,
      "totalContacts": 127,
      "totalLeads": 18,
      "totalOpportunities": 42,
      "totalActivities": 385
    },
    "opportunity": {
      "totalValue": 2500000,
      "closedWonValue": 850000,
      "avgDealSize": 59523,
      "winRate": "34%",
      "stageDistribution": {
        "qualification": 12,
        "proposal": 18,
        "negotiation": 8,
        "closed_won": 4
      }
    },
    "activity": {
      "breakdown": {
        "calls": 145,
        "meetings": 89,
        "emails": 151
      }
    }
  }
}
```

### Atualização Automática
- **Intervalo**: 60 segundos
- **Método**: setInterval + fetch
- **Cleanup**: clearInterval on unmount

---

## 🛠️ Componentes Utilizados

### Hooks
- `useRouter()` - Navegação
- `useState()` - Estado local
- `useEffect()` - Side effects
- `useMemo()` - Otimização de filtros

### Utilitários
- `formatCurrency()` - Formata valores (R$ 2.5M, R$ 450k)
- `localStorage.getItem('authToken')` - Autenticação

---

## 📱 Responsividade

### Breakpoints
- **Mobile**: 1 coluna (padrão)
- **Tablet (md)**: 2-3 colunas
- **Desktop (lg)**: 3 colunas
- **Wide (xl)**: 4 colunas

### Grid de Métricas
- Mobile: 1 col
- Tablet: 3 cols
- Desktop: 6 cols (1 métrica por coluna)

---

## 💡 Footer Informativo

Seção final com 3 colunas explicativas:

### Core CRM
- Gestão de contas e contatos
- Qualificação de leads
- Pipeline de oportunidades

### Analytics
- Métricas de vendas em tempo real
- Relatórios customizados
- Previsões de receita

### Integrações
- Webhooks para automação
- API REST completa
- RBAC e auditoria

---

## 🚀 Como Usar

### 1. Acessar o Dashboard
```
http://localhost:3001/crm
```

### 2. Visualizar Métricas
As métricas carregam automaticamente ao abrir a página.

### 3. Navegar entre Módulos
Clique em qualquer card para acessar o módulo específico.

### 4. Usar Quick Actions
Use os 4 botões no topo para actions rápidas.

### 5. Filtrar Módulos
- Digite no campo de busca OU
- Selecione uma categoria no dropdown

---

## ⚙️ Configuração no Sistema

### 1. Rota Configurada
```javascript
// frontend/src/main.jsx
const isCrmDashboard = isRoute('/crm') || isRoute('/crm-dashboard');
```

### 2. Renderização
```javascript
{isCrmDashboard ? <CrmDashboardPage /> : ...}
```

### 3. Import
```javascript
import { CrmDashboardPage } from './pages/crm/CrmDashboardPage';
```

---

## 🎯 Features Implementadas

✅ Dashboard com 6 métricas em tempo real  
✅ 4 quick actions com gradiente  
✅ 12 módulos organizados por categoria  
✅ Sistema de busca e filtros  
✅ Auto-refresh a cada 60s  
✅ Responsivo (mobile-first)  
✅ Loading states  
✅ Error handling  
✅ Footer informativo  
✅ Navegação via useRouter  
✅ Autenticação via JWT  

---

## 📊 Status

**✅ IMPLEMENTADO E PRONTO PARA USO**

- Dashboard principal: `/crm`
- 14 páginas CRM criadas
- Integração com backend via API
- Sistema de navegação completo
- Design consistente com ChatHumanoDashboard

---

## 🔜 Próximos Passos (Sugestões)

1. **Adicionar permissões RBAC** no backend
2. **Implementar gráficos** (Chart.js ou Recharts)
3. **Adicionar paginação** nas tabelas
4. **Export CSV/Excel** dos relatórios
5. **Notificações push** para novas atividades
6. **Drag & drop** no pipeline kanban
7. **Filtros avançados** por data, status, owner
8. **Bulk actions** (edição em massa)
9. **Timeline visual** de atividades
10. **Integração com WhatsApp** para follow-ups

---

**Criado em**: 21/02/2026  
**Baseado em**: ChatHumanoDashboardPage  
**Framework**: React + Tailwind CSS
