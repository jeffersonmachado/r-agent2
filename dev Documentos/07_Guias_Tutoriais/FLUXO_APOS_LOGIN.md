# Fluxo Após Login

## O que acontece quando você faz login

### 1. **Requisição de Login**
- Frontend envia `POST /auth/login` com username e senha
- Backend valida credenciais
- Backend gera token de sessão (válido por 24 horas)
- Backend retorna token + dados do agente

### 2. **Armazenamento Local**
- Token é salvo no `localStorage` (chave: `auth_token`)
- Dados do agente são armazenados no contexto React (`AuthContext`)
- Estado `isAuthenticated` é definido como `true`

### 3. **Redirecionamento Automático**
- Após login bem-sucedido, você é **redirecionado automaticamente** para `/support`
- Toast de sucesso é exibido: "Login realizado com sucesso!"
- A página de atendimento é carregada

### 4. **Acesso às Funcionalidades**

#### **Todas as rotas protegidas ficam acessíveis:**
- `/support` - Página de atendimento (tickets e filas)
- `/maintenance` - Manutenção de tickets
- `/config` - Configuração do sistema
- `/agents` - Gerenciamento de agentes (apenas admin/supervisor)
- `/audit` - Logs de auditoria (apenas admin/supervisor)

#### **Header da página mostra:**
- Nome do agente logado
- Papel do agente (admin, supervisor, agent)
- Botão "Sair" para logout
- Links de navegação (condicionais por permissão)

### 5. **Todas as Requisições Incluem Token**
- O `api/client.js` adiciona automaticamente o header `Authorization: Bearer <token>`
- Todas as chamadas de API são autenticadas
- O backend valida o token em cada requisição

### 6. **Sessão Persistente**
- Token permanece válido por **24 horas**
- Se você fechar e reabrir o navegador, ainda estará logado (token no localStorage)
- Última atividade é atualizada automaticamente

## Fluxo Visual

```
1. Usuário preenche login
   ↓
2. Clica em "Entrar"
   ↓
3. Backend valida credenciais
   ↓
4. Token + dados do agente retornados
   ↓
5. Token salvo no localStorage
   ↓
6. Contexto atualizado (isAuthenticated = true)
   ↓
7. Toast de sucesso exibido
   ↓
8. Redirecionamento para /support
   ↓
9. Página de atendimento carregada
   ↓
10. Header mostra informações do agente
```

## Comportamento por Papel

### **Admin**
- Acesso total a todas as funcionalidades
- Pode gerenciar agentes
- Pode ver auditoria
- Pode acessar/modificar qualquer ticket

### **Supervisor**
- Pode gerenciar agentes (criar, editar)
- Pode ver auditoria
- Pode acessar/modificar qualquer ticket
- Não pode deletar agentes

### **Agent**
- Acesso apenas a tickets atribuídos a si ou não atribuídos
- Pode atribuir tickets para si mesmo
- Pode fechar tickets atribuídos a si
- Não pode ver gerenciamento de agentes
- Não pode ver auditoria

## Proteção de Rotas

### **Rotas Públicas** (não requerem login):
- `/editor` - Editor de fluxos
- `/` - Redireciona para editor

### **Rotas Protegidas** (requerem login):
- Todas as outras rotas
- Se não autenticado, redireciona para `/login`

## Logout

Quando você clica em "Sair":
1. Requisição `POST /auth/logout` é enviada
2. Token é removido do servidor
3. Token é removido do localStorage
4. Contexto é limpo (isAuthenticated = false)
5. Redirecionamento para `/login`

## Tratamento de Erros

### **Token Expirado**
- Se o token expirar (24h), próxima requisição retornará 401
- Sistema detecta e redireciona para login
- Token é removido automaticamente

### **Token Inválido**
- Se o token for inválido, sistema redireciona para login
- Mensagem de erro é exibida se necessário

## Persistência

- **Token**: Armazenado no `localStorage` do navegador
- **Sessão no Backend**: Armazenada em `api/data/sessions.json`
- **Dados do Agente**: Carregados do `api/data/agents.json`

## Segurança

- Tokens são únicos e aleatórios (64 caracteres hexadecimais)
- Tokens expiram após 24 horas
- Sessões expiradas são limpas automaticamente
- Senhas são hasheadas (SHA256 + salt)
- Todas as ações são registradas na auditoria

