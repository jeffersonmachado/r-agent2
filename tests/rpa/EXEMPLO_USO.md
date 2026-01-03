# 🎯 Exemplo Prático de Uso do RPA

## ✅ Sistema Funcionando!

O sistema RPA foi testado e está funcionando. Veja abaixo exemplos práticos.

## 📹 Exemplo 1: Gravação Criada

Uma gravação de exemplo foi criada automaticamente:

```json
{
  "id": "demo-login-completo",
  "name": "demo-login-completo",
  "version": "1.0.0",
  "steps": [
    {
      "type": "navigate",
      "url": "http://localhost:5173/login",
      "waitFor": "input[type=\"email\"]"
    },
    {
      "type": "fill",
      "selector": "input[type=\"email\"]",
      "value": "{{testUser.email}}"
    },
    {
      "type": "fill",
      "selector": "input[type=\"password\"]",
      "value": "{{testUser.password}}"
    },
    {
      "type": "click",
      "selector": "button[type=\"submit\"]",
      "waitFor": ".dashboard"
    },
    {
      "type": "assert",
      "selector": ".dashboard",
      "exists": true,
      "visible": true
    }
  ],
  "data": {
    "testUser": {
      "email": "test@example.com",
      "password": "test123"
    }
  }
}
```

## 🚀 Como Usar

### 1. Executar Demonstração Simples

```bash
node tests/rpa/demo-simples.js
```

**Saída esperada:**
```
🤖 Sistema RPA - Demonstração Simples
============================================================

📹 1. Criando gravação de exemplo...
✅ Gravação criada: /path/to/demo-login-completo.json
   - 6 ações gravadas

📂 2. Carregando gravação salva...
✅ Gravação carregada com sucesso!
   - Total de steps: 6

📁 3. Listando todas as gravações...
✅ 2 gravação(ões) encontrada(s)
```

### 2. Criar Sua Própria Gravação

```javascript
const { ActionRecorder } = require('./tests/rpa/actionRecorder');

const recorder = new ActionRecorder();
recorder.start({ name: 'minha-gravacao' });

// Registrar ações
recorder.recordNavigate('http://localhost:5173/login');
recorder.recordFill('input[type="email"]', 'usuario@teste.com');
recorder.recordFill('input[type="password"]', 'senha123');
recorder.recordClick('button[type="submit"]');
recorder.recordAssert('.dashboard', { exists: true });

recorder.stop();
recorder.save('minha-gravacao');
```

### 3. Executar Gravação (com Playwright instalado)

```javascript
const { RpaTestRunner } = require('./tests/rpa/rpaTestRunner');

const runner = new RpaTestRunner();
await runner.init();

const result = await runner.playback('demo-login-completo', {
  testUser: {
    email: 'test@example.com',
    password: 'test123',
  },
});

console.log('Sucesso:', result.success);
console.log('Erros:', result.errors.length);

await runner.close();
```

## 📊 Funcionalidades Demonstradas

### ✅ Gravação de Ações
- ✅ Criar gravações programaticamente
- ✅ Salvar em formato JSON
- ✅ Carregar gravações existentes
- ✅ Listar todas as gravações

### ✅ Substituição de Variáveis
- ✅ Usar `{{variavel}}` em valores
- ✅ Substituir com dados dinâmicos
- ✅ Suportar caminhos aninhados (`{{testUser.email}}`)

### ✅ Estrutura de Dados
- ✅ Metadados da gravação (id, nome, versão)
- ✅ Steps com timestamps
- ✅ Dados para substituição de variáveis

## 🔍 Gravações Criadas

Execute a demonstração para ver as gravações criadas:

```bash
ls tests/rpa/recordings/
```

Você verá:
- `demo-login-completo.json` - Login completo
- `demo-fluxo-completo.json` - Fluxo completo de criação
- `example-login.json` - Exemplo de login

## 📝 Próximos Passos

1. **Instalar Playwright** (para execução real):
   ```bash
   npx playwright install chromium
   ```

2. **Executar testes RPA**:
   ```bash
   npm run test:rpa
   ```

3. **Criar suas próprias gravações** usando `ActionRecorder`

4. **Executar gravações** usando `RpaTestRunner`

## 🎯 Exemplo Completo

Veja `tests/rpa/demo-simples.js` para um exemplo completo funcionando!

---

**Status**: ✅ **Sistema Funcionando e Testado**

