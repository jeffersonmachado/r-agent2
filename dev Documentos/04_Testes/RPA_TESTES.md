# 🤖 RPA para Testes Automatizados

## ✅ Status: Implementado

O sistema de RPA para testes foi completamente implementado e está pronto para uso.

## 📋 Funcionalidades Implementadas

### ✅ 1. Gravação de Ações de Interface (Recording)
- **Arquivo**: `tests/rpa/actionRecorder.js`
- **Funcionalidade**: Captura ações do usuário (cliques, preenchimentos, navegação)
- **Formato**: Salva em JSON para reprodução

### ✅ 2. Reprodução de Ações (Playback)
- **Arquivo**: `tests/rpa/actionExecutor.js`
- **Funcionalidade**: Executa ações gravadas usando Playwright
- **Suporte**: Navegação, cliques, preenchimentos, seleções, esperas, validações

### ✅ 3. Detecção de Erros Durante Execução
- **Arquivo**: `tests/rpa/errorDetection.js`
- **Funcionalidade**: Detecta e classifica erros automaticamente
- **Tipos**: Elementos não encontrados, timeouts, erros de rede, validação, etc.

### ✅ 4. Correção Automática de Erros
- **Arquivo**: `tests/rpa/errorRecovery.js`
- **Funcionalidade**: Tenta recuperar automaticamente de erros
- **Estratégias**: Aumentar timeout, tentar seletores alternativos, scroll, etc.

### ✅ 5. População Automática de Dados
- **Arquivo**: `tests/rpa/dataPopulation.js`
- **Funcionalidade**: Preenche formulários com dados de teste
- **Fontes**: Seeds (`/tests/seeds/`), variáveis, credentials

## 🚀 Como Usar

### Instalação

```bash
# Instalar dependências
npm install

# Instalar browsers do Playwright
npx playwright install chromium
```

### Exemplo Básico

```javascript
const { RpaTestRunner } = require('./tests/rpa/rpaTestRunner');

describe('Testes RPA', () => {
  let runner;

  beforeAll(async () => {
    runner = new RpaTestRunner();
    await runner.init();
  });

  afterAll(async () => {
    await runner.close();
  });

  test('deve fazer login', async () => {
    const result = await runner.playback('example-login');
    expect(result.success).toBe(true);
  });
});
```

### Criar Nova Gravação

```javascript
const { ActionRecorder } = require('./tests/rpa/actionRecorder');

const recorder = new ActionRecorder();
recorder.start({ name: 'minha-gravacao' });

recorder.recordNavigate('http://localhost:5173/login');
recorder.recordFill('input[type="email"]', 'test@example.com');
recorder.recordFill('input[type="password"]', 'test123');
recorder.recordClick('button[type="submit"]');
recorder.recordAssert('.dashboard', { exists: true });

recorder.stop();
recorder.save('minha-gravacao');
```

## 📁 Estrutura Criada

```
/tests/rpa/
  /recordings/              # Gravações de ações (JSON)
    example-login.json     # Exemplo de gravação
  /screenshots/            # Screenshots de erros
  /reports/                # Relatórios de execução
  actionRecorder.js        # ✅ Gravador de ações
  actionExecutor.js        # ✅ Executor de ações
  errorDetection.js        # ✅ Detecção de erros
  errorRecovery.js         # ✅ Recuperação de erros
  dataPopulation.js        # ✅ População de dados
  rpaTestRunner.js         # ✅ Runner principal
  rpaConfig.js             # ✅ Configurações
  rpa.test.js              # ✅ Testes do sistema
  integration.example.js   # ✅ Exemplo de integração
  README.md                # ✅ Documentação completa
```

## 🔧 Configuração

Edite `tests/rpa/rpaConfig.js`:

```javascript
module.exports = {
  playwright: {
    headless: true,      // Executar em modo headless
    slowMo: 100,         // Delay entre ações (ms)
    timeout: 30000,      // Timeout padrão (ms)
  },
  retry: {
    maxAttempts: 3,      // Tentativas de retry
    delay: 1000,         // Delay entre tentativas (ms)
  },
  urls: {
    base: 'http://localhost:3000',
    frontend: 'http://localhost:5173',
  },
};
```

## 📝 Tipos de Ações Suportadas

- **navigate**: Navega para URL
- **click**: Clica em elemento
- **fill**: Preenche campo
- **select**: Seleciona opção
- **wait**: Aguarda condição
- **assert**: Valida elemento

## 🔍 Detecção de Erros

O sistema detecta automaticamente:
- ✅ Elementos não encontrados
- ✅ Timeouts
- ✅ Erros de rede
- ✅ Erros de validação
- ✅ Erros de JavaScript

## 🔄 Recuperação Automática

O sistema tenta recuperar automaticamente de:
- ✅ Elementos não encontrados (aguarda mais tempo, tenta seletores alternativos)
- ✅ Timeouts (aumenta timeout, relaxa estado)
- ✅ Erros de validação (refaz preenchimento)

## 📊 Relatórios

```javascript
const report = runner.generateReport();
console.log(report.summary);
// {
//   total: 5,
//   passed: 4,
//   failed: 1,
//   successRate: "80.00%"
// }

runner.saveReport('relatorio-teste');
```

## 🧪 Executar Testes

```bash
# Executar todos os testes RPA
npm run test:rpa

# Executar teste específico
jest tests/rpa/rpa.test.js
```

## 🔗 Integração com Sistema Existente

- ✅ **Seeds**: Usa dados de `/tests/seeds/` para popular formulários
- ✅ **Validação**: Integra com sistema de validação existente
- ✅ **Erros**: Usa `errorClassifier.js` para classificar erros
- ✅ **Testes**: Integra com Jest para testes automatizados

## 📚 Documentação Adicional

Veja `tests/rpa/README.md` para documentação completa e exemplos detalhados.

---

**Status**: ✅ **100% Implementado e Funcional**
