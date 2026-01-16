# Testes de Frontend

Este diretório contém testes de integração que verificam o fluxo completo do frontend, especialmente o comportamento dos componentes React e a interação com a API.

## 📁 Estrutura

```
tests/frontend/
├── README.md              # Este arquivo
└── login-flow.test.js    # Testes de integração do fluxo de login
```

## 🧪 Testes Disponíveis

### 1. Testes de Integração (`login-flow.test.js`)

Testes que simulam o fluxo completo do frontend fazendo requisições HTTP reais:

- **testLoginFlow**: Testa o fluxo completo de login e seleção de tenant
- **testRedirectFlow**: Testa o redirecionamento quando provider é inválido
- **testConfigSaveFlow**: Testa o salvamento de configuração

### 2. Testes de Componentes React (`frontend/src/__tests__/Login.flow.test.jsx`)

Testes unitários dos componentes React usando Vitest:

- Testa a lógica de atualização do agente
- Testa condições de exibição de campos
- Testa redirecionamentos

## 🚀 Como Executar

### Testes de Integração

```bash
# Executar todos os testes de frontend
node tests/frontend/login-flow.test.js

# Ou via npm (se adicionado ao package.json)
npm run test:frontend
```

### Testes de Componentes React

```bash
cd frontend
npm test
# ou
npm run test Login.flow
```

## 📊 O que os Testes Verificam

### Fluxo de Login e Seleção de Tenant

1. ✅ Login como super-admin
2. ✅ Obtenção da lista de tenants
3. ✅ Verificação de provider de IA
4. ✅ Atualização do agente com novo tenantId
5. ✅ Condições para exibição do campo de configuração

### Fluxo de Redirecionamento

1. ✅ Detecção de provider inválido
2. ✅ Atualização do agente antes de redirecionar
3. ✅ URL de redirecionamento correta (`/config?tab=ai&tenant=tenant-id`)
4. ✅ Comportamento esperado do frontend

### Fluxo de Salvamento de Configuração

1. ✅ Obtenção da configuração atual
2. ✅ Atualização da configuração com `ai.tenants[tenantId].primary`
3. ✅ Salvamento via PUT /config
4. ✅ Verificação de persistência no arquivo

## 🔍 Diferença dos Testes de API

| Aspecto | Testes de API | Testes de Frontend |
|---------|---------------|-------------------|
| **Foco** | Endpoints HTTP | Fluxo completo |
| **Cobertura** | Backend apenas | Frontend + Backend |
| **Verifica** | Respostas da API | Comportamento do usuário |
| **Inclui** | Chamadas HTTP | Lógica de componentes |

## 🎯 Cobertura Atual

- ✅ Fluxo de login e seleção de tenant
- ✅ Verificação de provider de IA
- ✅ Redirecionamento correto
- ✅ Atualização do estado do agente
- ✅ Salvamento de configuração
- ✅ Exibição condicional de campos

## 📝 Adicionando Novos Testes

Para adicionar novos testes de frontend:

1. Crie um arquivo `*.test.js` em `tests/frontend/`
2. Use a função `httpRequest` para simular chamadas HTTP
3. Exporte a função de teste
4. Adicione ao runner principal se necessário

Exemplo:

```javascript
async function testNovoFluxo() {
  // 1. Simula ação do usuário
  // 2. Verifica chamadas HTTP
  // 3. Verifica comportamento esperado
  return { success: true };
}

module.exports = { testNovoFluxo };
```

## ⚠️ Requisitos

- Servidor da API deve estar rodando em `http://localhost:3000`
- Credenciais de teste devem estar configuradas
- Para testes de componentes React, use Vitest no diretório `frontend/`

## 🔧 Configuração

Os testes usam a variável de ambiente `API_BASE_URL`:

```bash
# Usar URL padrão
node tests/frontend/login-flow.test.js

# Usar URL customizada
API_BASE_URL=http://localhost:8080 node tests/frontend/login-flow.test.js
```
