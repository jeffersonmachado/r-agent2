1-# 🤖 Sistema RPA para Testes Automatizados

Sistema completo de RPA (Robotic Process Automation) para testes automatizados de interface.

## 📋 Funcionalidades

- ✅ **Gravação de Ações**: Captura ações do usuário na interface
- ✅ **Reprodução de Ações**: Executa ações gravadas automaticamente
- ✅ **Digitação Caractere a Caractere**: Digitação visível e controlável
- ✅ **Replay Obrigatório**: Sempre gera replay de execuções
- ✅ **Controle de Velocidade**: Config controla velocidade, não o seed
- ✅ **Seeds Neutros**: Seeds não contêm delays ou velocidade
- ✅ **Detecção de Erros**: Detecta e classifica erros durante execução
- ✅ **Correção Automática**: Tenta recuperar automaticamente de erros
- ✅ **População de Dados**: Preenche formulários com dados de teste
- ✅ **Screenshots**: Captura screenshots em caso de erros
- ✅ **Relatórios**: Gera relatórios detalhados de execução
- ✅ **Modo CI**: Execução headless e rápida para CI/CD

## 🚀 Instalação

```bash
# Instalar dependências
npm install

# Instalar browsers do Playwright
npx playwright install chromium
```

## 📖 Uso Básico

### 🎯 Forma Mais Simples (Recomendado)

#### Ver e Executar Seeds Visualmente
```bash
# Listar seeds disponíveis
node tests/rpa/ver-seed-rpa.js

# Executar seed visualmente (com detalhes)
node tests/rpa/ver-seed-rpa.js example-login
```

#### Gravar Nova Seed
```bash
# Gravar nova seed (com detalhes)
node tests/rpa/gravar-seed-rpa.js meu-login http://localhost:5173
```

### 🔧 CLI Completo

#### Gravar Seed
```bash
node tests/rpa/cli.js record meu-seed http://localhost:5173
```

#### Executar Seed Visualmente
```bash
node tests/rpa/cli.js playback example-login
```

#### Executar Seed em Modo CI (Rápido)
```bash
node tests/rpa/cli.js ci example-login
```

### 1. Executar Gravação Existente (Programático)

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

### 2. Criar Nova Gravação Programaticamente

```javascript
const { ActionRecorder } = require('./tests/rpa/actionRecorder');

const recorder = new ActionRecorder();
recorder.start({ name: 'minha-gravacao' });

// Durante execução manual, registrar ações:
recorder.recordNavigate('http://localhost:5173/login');
recorder.recordFill('input[type="email"]', 'test@example.com');
recorder.recordFill('input[type="password"]', 'test123');
recorder.recordClick('button[type="submit"]');
recorder.recordAssert('.dashboard', { exists: true });

recorder.stop();
recorder.save('minha-gravacao', {
  testUser: {
    email: 'test@example.com',
    password: 'test123',
  },
});
```

### 3. Usar Variáveis em Gravações

```json
{
  "steps": [
    {
      "type": "fill",
      "selector": "input[type='email']",
      "value": "{{testUser.email}}"
    }
  ],
  "data": {
    "testUser": {
      "email": "test@example.com"
    }
  }
}
```

### 4. Usar Dados de Seeds

```json
{
  "steps": [
    {
      "type": "fill",
      "selector": "input[name='agentEmail']",
      "value": "{{seed.agents.0.email}}"
    }
  ]
}
```

## 📁 Estrutura

```
/tests/rpa/
  /recordings/          # Seeds gravados (JSON)
  /seeds/               # Seeds adicionais
  /replay/              # Replays gerados (obrigatório)
  /screenshots/         # Screenshots de erros
  /reports/             # Relatórios de execução
  /player/              # Player RPA
    rpaPlayer.js        # Executor de seeds
  /recorder/            # Recorder RPA
    rpaRecorder.js      # Gravador visual
  actionRecorder.js     # Gravador de ações (programático)
  actionExecutor.js     # Executor de ações
  errorDetection.js     # Detecção de erros
  errorRecovery.js      # Recuperação de erros
  dataPopulation.js     # População de dados
  replaySystem.js       # Sistema de replay
  rpaTestRunner.js      # Runner principal
  rpaConfig.js          # Configurações (contrato explícito)
  rpa.config.json       # Config personalizável
  cli.js                # CLI principal
  ver-seed-rpa.js       # Ver seed com detalhes (NOVO)
  gravar-seed-rpa.js    # Gravar seed com detalhes (NOVO)
  rpa.test.js           # Testes do sistema
```

## 🔧 Configuração

### Contrato de Configuração

O sistema usa um **contrato explícito** de configuração. Edite `rpa.config.json` para personalizar:

```json
{
  "modes": {
    "record": {
      "headless": false,
      "showCursor": true,
      "typingSpeedMs": 50,        // Delay entre caracteres
      "actionDelayMs": 300,       // Delay entre ações
      "screenStabilizeMs": 500,   // Estabilização da tela
      "speedMultiplier": 1.0
    },
    "playback": {
      "headless": false,
      "showCursor": true,
      "typingSpeedMs": 50,        // Digitação visível
      "actionDelayMs": 300,
      "screenStabilizeMs": 500,
      "speedMultiplier": 1.0      // 1x = normal
    },
    "ci": {
      "headless": true,
      "showCursor": false,
      "typingSpeedMs": 0,         // Instantâneo
      "actionDelayMs": 0,         // Sem delays
      "screenStabilizeMs": 100,
      "speedMultiplier": 10.0     // 10x mais rápido
    }
  }
}
```

### ⚡ Controle de Velocidade

**IMPORTANTE:** 
- A velocidade é controlada pelo **config**, não pelo seed
- Seeds são **neutros** (não contêm delays ou velocidade)
- Você pode alterar velocidade **sem regravar** seeds
- O seed descreve **O QUE** foi feito
- O config decide **COMO** é executado

### Modos Disponíveis

- **`record`**: Gravação visual com digitação visível
- **`playback`**: Execução visual (1x velocidade)
- **`ci`**: Execução headless e rápida (10x velocidade)

## 📝 Tipos de Ações Suportadas

### navigate
Navega para uma URL.

```json
{
  "type": "navigate",
  "url": "http://example.com",
  "waitFor": "selector",
  "timeout": 30000
}
```

### click
Clica em um elemento.

```json
{
  "type": "click",
  "selector": "button.submit",
  "waitFor": ".success",
  "force": false,
  "timeout": 30000
}
```

### fill
Preenche um campo.

```json
{
  "type": "fill",
  "selector": "input[name='email']",
  "value": "test@example.com",
  "clear": true,
  "validate": {
    "value": "test@example.com"
  },
  "timeout": 30000
}
```

### select
Seleciona uma opção.

```json
{
  "type": "select",
  "selector": "select[name='country']",
  "value": "BR",
  "timeout": 30000
}
```

### wait
Aguarda condição.

```json
{
  "type": "wait",
  "condition": "selector",
  "state": "visible",
  "timeout": 30000
}
```

### assert
Valida elemento ou página completa usando múltiplas estratégias.

#### Validação de Elemento (modo simples)
```json
{
  "type": "assert",
  "selector": ".dashboard",
  "exists": true,
  "visible": true,
  "text": "Bem-vindo",
  "value": "expected",
  "count": 1,
  "message": "Mensagem de erro",
  "timeout": 30000
}
```

#### Validação de Título da Página (modo simples)
```json
{
  "type": "assert",
  "title": "Example Domain",
  "message": "Título da página deve ser 'Example Domain'",
  "timeout": 30000
}
```

#### Validação de Página Completa (recomendado)
Identificação robusta usando múltiplas estratégias em camadas:

```json
{
  "type": "assert",
  "page": {
    "url": {
      "exact": "https://example.com/dashboard",
      "contains": "/dashboard",
      "pattern": "^https://.*/dashboard$"
    },
    "title": {
      "exact": "Dashboard - Sistema",
      "contains": "Dashboard",
      "pattern": "^Dashboard.*"
    },
    "meta": {
      "property": "og:title",
      "content": "Dashboard",
      "exact": true
    },
    "landmarks": [
      {
        "selector": "[data-testid='page-dashboard']",
        "exists": true,
        "visible": true
      },
      {
        "selector": "h1",
        "text": "Dashboard"
      }
    ]
  },
  "validationMode": "all",
  "message": "Página deve ser o Dashboard",
  "timeout": 30000
}
```

**Modos de Validação:**
- `"all"` (padrão): Todas as estratégias devem passar
- `"any"`: Qualquer estratégia pode passar

**Estratégias Disponíveis:**
1. **URL**: Validação por URL da página
   - `exact`: Correspondência exata
   - `contains`: Contém substring
   - `pattern`: Expressão regular

2. **Título**: Validação por título da página (`<title>`)
   - `exact`: Correspondência exata
   - `contains`: Contém substring
   - `pattern`: Expressão regular

3. **Meta Tags**: Validação por meta tags (útil para SPAs)
   - `property`: Nome da propriedade (ex: `og:title`)
   - `content`: Conteúdo esperado
   - `exact`: Se deve ser exato (padrão: `true`)

4. **Landmarks**: Elementos-chave da página
   - `selector`: Seletor CSS
   - `exists`: Se elemento existe
   - `visible`: Se elemento está visível
   - `text`: Texto esperado
   - `value`: Valor esperado (para inputs)

**Exemplos Práticos:**

```json
// Para páginas estáticas
{
  "type": "assert",
  "title": "Example Domain"
}

// Para SPAs (recomendado)
{
  "type": "assert",
  "page": {
    "url": { "contains": "/support" },
    "landmarks": [
      { "selector": ".support-page", "exists": true }
    ]
  }
}

// Validação flexível (qualquer estratégia passa)
{
  "type": "assert",
  "page": {
    "url": { "contains": "/dashboard" },
    "title": { "contains": "Dashboard" },
    "landmarks": [
      { "selector": "[data-page='dashboard']", "exists": true }
    ]
  },
  "validationMode": "any"
}
```

## 🔍 Detecção de Erros

O sistema detecta automaticamente:
- Elementos não encontrados
- Timeouts
- Erros de rede
- Erros de validação
- Erros de JavaScript

## 🔄 Recuperação Automática

O sistema tenta recuperar automaticamente de:
- Elementos não encontrados (aguarda mais tempo, tenta seletores alternativos)
- Timeouts (aumenta timeout, relaxa estado)
- Erros de validação (refaz preenchimento)

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

// Salvar relatório
runner.saveReport('relatorio-teste');
```

## 🧪 Executar Testes

### Via NPM Scripts
```bash
# Executar todos os testes RPA
npm run test:rpa

# Executar teste específico
jest tests/rpa/rpa.test.js
```

### Via CLI
```bash
# Ver seeds disponíveis
node tests/rpa/ver-seed-rpa.js

# Executar seed visualmente
node tests/rpa/ver-seed-rpa.js example-login

# Gravar nova seed
node tests/rpa/gravar-seed-rpa.js meu-seed http://localhost:5173

# Executar em modo CI (rápido, headless)
node tests/rpa/cli.js ci example-login
```

### Via Programático
```javascript
const { RpaPlayer } = require('./tests/rpa/player/rpaPlayer');

const player = new RpaPlayer({ mode: 'playback' });
const result = await player.play('example-login');
console.log(result);
```

## 💡 Dicas

1. **Use seletores estáveis**: Prefira `data-testid` ou classes estáveis
2. **Aguarde elementos**: Use `waitFor` para aguardar elementos aparecerem
3. **Valide dados**: Use `validate` para garantir que dados foram preenchidos
4. **Capture screenshots**: Ative `screenshotOnFailure` para debug
5. **Use variáveis**: Use `{{var}}` para tornar gravações reutilizáveis
6. **Seeds neutros**: Seeds não contêm delays - velocidade vem do config
7. **Replay sempre gerado**: Toda execução gera replay em `tests/rpa/replay/`
8. **Modo CI**: Use `ci` para execução rápida em pipelines
9. **Digitação visível**: Durante gravação e playback, digitação é caractere a caractere
10. **Altere velocidade sem regravar**: Edite `rpa.config.json` e execute novamente

## 🔗 Integração com Sistema Existente

- **Seeds**: Usa dados de `/tests/seeds/` para popular formulários
- **Validação**: Integra com sistema de validação existente
- **Erros**: Usa `errorClassifier.js` para classificar erros
- **Testes**: Integra com Jest para testes automatizados
- **CI/CD**: Integrado com GitHub Actions (`.github/workflows/rpa-ci.yml`)

## 🎯 Recursos Principais

### ✨ Digitação Caractere a Caractere
- Durante gravação: digitação visível usando `typingSpeedMs`
- Durante playback: digitação visível controlada pelo config
- Modo CI: digitação instantânea (0ms)

### 📹 Replay Obrigatório
- **Sempre gerado** em todas as execuções (record, playback, ci)
- Contém: seed usado, config aplicada, ações, telas, timestamps
- Salvo em `tests/rpa/replay/`
- Permite debug e regressão

### ⚡ Controle de Velocidade
- **Config controla velocidade**, não o seed
- Altere `speedMultiplier` para acelerar/desacelerar
- Altere `typingSpeedMs` para velocidade de digitação
- **Não precisa regravar** seeds para mudar velocidade

### 🌱 Seeds Neutros
- Seeds **não contêm** delays ou velocidade
- Seeds descrevem apenas **O QUE** foi feito
- Config decide **COMO** é executado
- Compatibilidade mantida com seeds antigos

## 🚀 Exemplos Rápidos

### Ver seeds disponíveis
```bash
node tests/rpa/ver-seed-rpa.js
```

### Executar seed visualmente
```bash
node tests/rpa/ver-seed-rpa.js example-login
```

### Gravar nova seed
```bash
node tests/rpa/gravar-seed-rpa.js meu-login http://localhost:5173
```

### Executar em modo CI
```bash
node tests/rpa/cli.js ci example-login
```

### Ver replay gerado
```bash
ls -la tests/rpa/replay/
cat tests/rpa/replay/replay-*.json | jq '.config'
```

## 📚 Documentação Adicional

- `README_RPA_TESTE.md` - Guia de testes RPA
- `README_SEED.md` - Guia de seeds
- `CI_INTEGRATION.md` - Integração CI/CD
- `REPLAY_COMPLETO.md` - Sistema de replay
- `.github/README.md` - Workflows CI/CD

---

**Status**: ✅ Implementado e funcional
**Última atualização**: 2025-01-02

