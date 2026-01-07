# 🚀 Como Acessar Todas as Funcionalidades

Este guia mostra como acessar e usar todas as funcionalidades implementadas no sistema.

## 📍 Acesso Principal

### 1. Dashboard (Página Inicial)
**URL:** `http://localhost:5173/` ou `http://localhost:5173/dashboard`

Após fazer login, você será redirecionado para o **Dashboard**, que é o hub central com todas as funcionalidades organizadas em cards clicáveis.

### 2. Menu do Usuário
No canto superior direito, clique no seu avatar para ver o menu com links rápidos para todas as funcionalidades.

---

## 🎯 Funcionalidades Disponíveis

### 💬 Atendimento
**URL:** `/support`
- Gerenciar tickets e conversas
- Enviar mensagens para clientes
- Atribuir tickets
- Ver histórico de mensagens

### 🔀 Editor de Fluxos
**URL:** `/editor`
- Criar e editar fluxos de conversação
- Visualizar fluxos com Rete.js
- Testar fluxos

### ⚡ Respostas Rápidas
**URL:** `/quick-replies`
- Criar mensagens pré-definidas
- Organizar por categorias e tags
- Buscar respostas por contexto
- Usar em atendimentos

### 🏢 Departamentos
**URL:** `/departments`
- Criar e gerenciar departamentos
- Associar agentes a departamentos
- Organizar filas por departamento

### 📢 Disparos em Massa
**URL:** `/bulk-messaging`
- Criar campanhas de disparo
- Enviar mensagens para múltiplos contatos
- Controlar taxa de envio
- Rastrear status de envio

### 📊 Analytics & Métricas
**URL:** `/analytics`
- Ver métricas gerais do sistema
- Métricas por agente
- Métricas por departamento
- Métricas por fila
- Tendências ao longo do tempo

### 📥 Exportação
**URL:** `/export`
- Exportar tickets em CSV
- Exportar métricas em CSV
- Exportar conversas em JSON
- Gerar relatórios completos

### 🤖 Ferramentas de IA
**URL:** `/ai-tools`
- Sugestão de respostas baseadas no contexto
- Reescrita inteligente de mensagens
- Melhorar tom e clareza

### 🏷️ Segmentação
**URL:** `/segmentation`
- Adicionar tags a tickets
- Categorizar tickets
- Filtrar por múltiplos critérios
- Ver estatísticas de segmentação

### 📋 Templates WhatsApp
**URL:** `/whatsapp-templates`
- Listar templates aprovados
- Criar novos templates
- Enviar mensagens usando templates

### 👥 Agentes
**URL:** `/agents`
- Gerenciar agentes
- Definir permissões
- Ver perfis

### 📝 Auditoria
**URL:** `/audit`
- Ver logs de ações
- Filtrar por agente, ação, recurso
- Estatísticas de auditoria

### ⚙️ Configurações
**URL:** `/config`
- Configurar sistema
- Configurar WhatsApp
- Configurar IA

---

## 🔐 Permissões

As funcionalidades visíveis dependem do seu papel:

- **Admin:** Acesso total a todas as funcionalidades
- **Supervisor:** Acesso a leitura e algumas operações
- **Agent:** Acesso básico a atendimento e respostas rápidas

---

## 📱 Integrações

### WhatsApp
- Webhook: `POST /webhooks/whatsapp`
- Envio de mensagens automático
- Recebimento de mensagens

### Facebook Messenger
- Webhook: `POST /webhooks/messenger`
- Envio via API

### Instagram Direct
- Webhook: `POST /webhooks/instagram`
- Envio via API

---

## 🎨 Interface

Todas as funcionalidades estão acessíveis através de:

1. **Dashboard** - Cards clicáveis na página inicial
2. **Menu do Usuário** - Dropdown no canto superior direito
3. **URLs diretas** - Acesse diretamente pela URL

---

## 📚 Documentação da API

Para ver todos os endpoints disponíveis, consulte:
`docs/API_DOCUMENTATION.md`

---

## 💡 Dicas

- Use o Dashboard como ponto de partida
- O menu do usuário mostra apenas funcionalidades que você tem permissão
- Todas as funcionalidades estão integradas e compartilham dados
- Use tags e categorias para organizar melhor os atendimentos

