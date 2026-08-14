# 🔐 Como Acessar como Super Admin

## 📋 Credenciais Padrão

O super admin já está criado no sistema com as seguintes credenciais:

```
Username: systemadmin
Email: systemadmin@exemplo.com
Senha: ***
Tenant: system
Role: owner
```

## 🚀 Passos para Acessar

### 1. Fazer Login

1. Acesse a página de login: `http://localhost:5173/login`
2. Use as credenciais acima:
   - **Username:** `systemadmin`
   - **Senha:** `***`

### 2. Acessar Área de Super Admin

Após fazer login, você pode acessar a área de Super Admin de duas formas:

#### Opção 1: Via Menu
- O menu lateral deve mostrar o item "Super Admin" (se você tiver permissão)
- Clique em "Super Admin"

#### Opção 2: Via URL Direta
- Acesse diretamente: `http://localhost:5173/super-admin`

## ✅ Verificação de Permissão

O sistema verifica se você é Super Admin através de:

1. **Role `super_admin`** OU
2. **Role `owner` do tenant `system`**

O usuário `systemadmin` tem role `owner` no tenant `system`, então tem acesso completo.

## 🛠️ Recriar Super Admin (se necessário)

Se você precisar recriar o super admin ou criar um novo:

```bash
node scripts/create-super-admin.js
```

Este script:
- Cria o tenant `system` (se não existir)
- Cria o agente `systemadmin` com role `owner`
- Exibe as credenciais

## 🔒 Funcionalidades do Super Admin

Como Super Admin, você pode:

1. **Listar todos os tenants** - Ver todos os tenants do sistema
2. **Visualizar métricas** - Ver estatísticas detalhadas por tenant
3. **Impersonar usuário** - Acessar como outro usuário para debug
4. **Bloquear/Desbloquear tenant** - Suspender ou reativar tenants
5. **Ajustar plano** - Alterar o plano de um tenant manualmente

## ⚠️ Importante

- O Super Admin tem acesso a **todos os tenants** do sistema
- Use com cuidado em produção
- Recomenda-se alterar a senha padrão após o primeiro acesso
- O tenant `system` é especial e não deve ser usado para operações normais

## 🔄 Alterar Senha

Para alterar a senha do super admin:

1. Faça login como `systemadmin`
2. Vá para a página de perfil/configurações
3. Ou altere diretamente no PostgreSQL (tabela `users`) via um script/admin tool (não recomendado em produção sem auditoria)

## 📝 Notas

- O Super Admin não precisa de `tenant_id` nas requisições (opera no nível global)
- As rotas `/super-admin/*` são protegidas e só aceitam Super Admins
- O middleware de validação de tenant não se aplica às rotas de Super Admin
