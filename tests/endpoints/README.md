# Testes de Endpoints por Categoria

Este diretório contém testes organizados por categoria para os endpoints da API.

## 📋 Categorias Disponíveis

- **auth** - Autenticação (login, logout, agents, etc.)
- **tenants** - Gerenciamento de tenants
- **tickets** - Gerenciamento de tickets
- **config** - Configuração do sistema
- **ai-provider-status** - Status de providers de IA

## 🚀 Como Usar

### Executar todos os testes

```bash
node tests/endpoints/run-all.js
```

### Executar uma categoria específica

```bash
# Testes de autenticação
node tests/endpoints/run-all.js auth

# Testes de tenants
node tests/endpoints/run-all.js tenants

# Testes de tickets
node tests/endpoints/run-all.js tickets

# Testes de configuração
node tests/endpoints/run-all.js config

# Testes de AI Provider Status
node tests/endpoints/run-all.js ai-provider-status
```

### Listar categorias disponíveis

```bash
node tests/endpoints/run-all.js --list
# ou
node tests/endpoints/run-all.js -l
```

### Executar um teste individual

```bash
# Teste de autenticação
node tests/endpoints/auth.test.js

# Teste de tenants
node tests/endpoints/tenants.test.js

# Teste de tickets
node tests/endpoints/tickets.test.js
```

## 📁 Estrutura de Arquivos

```
tests/endpoints/
├── README.md              # Este arquivo
├── run-all.js             # Runner principal
├── auth.test.js           # Testes de autenticação
├── tenants.test.js        # Testes de tenants
└── tickets.test.js        # Testes de tickets
```

## 🧪 Adicionando Novos Testes

Para adicionar uma nova categoria de testes:

1. Crie um arquivo `nova-categoria.test.js` neste diretório
2. Exporte uma função `testNovaCategoriaEndpoints()` que retorna `{ success: boolean, error?: string }`
3. Adicione a categoria em `run-all.js` no objeto `TEST_CATEGORIES`:

```javascript
const TEST_CATEGORIES = {
  // ... categorias existentes
  'nova-categoria': {
    name: 'Nova Categoria',
    file: path.join(__dirname, 'nova-categoria.test.js'),
    module: 'testNovaCategoriaEndpoints'
  }
};
```

## 📊 Exemplo de Estrutura de Teste

```javascript
/**
 * Testes para endpoints de Nova Categoria
 */

const http = require('http');

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

function httpRequest(options, body = null) {
  // ... implementação
}

async function testNovaCategoriaEndpoints() {
  console.log('\n🧪 Testando endpoints de Nova Categoria...\n');
  
  try {
    // 1. Login (se necessário)
    // 2. Teste endpoint 1
    // 3. Teste endpoint 2
    // ...
    
    console.log('\n✅ Testes concluídos!\n');
    return { success: true };
  } catch (error) {
    console.error('❌ Erro nos testes:', error.message);
    return { success: false, error: error.message };
  }
}

// Executa se for chamado diretamente
if (require.main === module) {
  testNovaCategoriaEndpoints()
    .then((result) => {
      process.exit(result.success ? 0 : 1);
    })
    .catch((error) => {
      console.error('❌ Erro ao executar testes:', error);
      process.exit(1);
    });
}

module.exports = { testNovaCategoriaEndpoints };
```

## 🔧 Configuração

Os testes usam a variável de ambiente `API_BASE_URL` para determinar a URL base da API:

```bash
# Usar URL padrão (http://localhost:3000)
node tests/endpoints/run-all.js

# Usar URL customizada
API_BASE_URL=http://localhost:8080 node tests/endpoints/run-all.js
```

## 📝 Notas

- Os testes fazem requisições HTTP reais para a API
- Certifique-se de que o servidor está rodando antes de executar os testes
- Alguns testes podem falhar se não houver dados de teste no sistema
- Os testes são independentes e podem ser executados em qualquer ordem

## 🎯 Próximos Passos

Categorias planejadas para adicionar:

- [ ] flows - Testes de fluxos
- [ ] rag - Testes de RAG
- [ ] rpa - Testes de RPA
- [ ] webhooks - Testes de webhooks
- [ ] queues - Testes de filas
- [ ] departments - Testes de departamentos
- [ ] quick-replies - Testes de respostas rápidas
