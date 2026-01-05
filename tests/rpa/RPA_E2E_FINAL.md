# RPA como Teste E2E Final

## Princípio Fundamental

**"O sistema deve ser correto sem RPA. O RPA existe apenas para provar que ele continua correto."**

## Posicionamento no Pipeline

RPA é **SEMPRE a última etapa** do pipeline obrigatório:

```
unit → flow → data → scripts → rpa
```

### Regras Absolutas

1. **RPA NÃO é recurso do sistema**
   - RPA existe APENAS em `/tests/rpa`
   - RPA NÃO cria nós, contratos ou regras no core
   - RPA NÃO altera engine, flow validator ou router

2. **RPA executa SOMENTE se todas as etapas anteriores passarem**
   - Se unit falhar → RPA não executa
   - Se flow falhar → RPA não executa
   - Se data falhar → RPA não executa
   - Se scripts falhar → RPA não executa

3. **RPA testa o sistema como CAIXA-PRETA**
   - Interage apenas via UI / endpoints públicos
   - Não acessa engine nem flow internamente
   - Não conhece estrutura interna do sistema
   - Valida UX + integrações no nível E2E

4. **RPA pode falhar o pipeline**
   - Falha em RPA indica problema em UX ou integração
   - RPA é a última validação antes de produção

## Estrutura de Testes RPA

```
/tests/rpa/
  /seeds/           # Todos os seeds (manuais e automáticos)
  /flows/           # Testes RPA gerados de fluxos
  /replay/          # Sistema de replay determinístico (obrigatório)
  /reports/         # Relatórios de execução
  /screenshots/     # Screenshots de erros
  /player/          # Player RPA (código)
  /recorder/        # Recorder RPA (código)
  /utils/           # Utilitários
  /config/          # Configurações e tokens
  rpaTestRunner.js  # Runner principal
  rpaConfig.js      # Configurações
```

## Contrato de Testes RPA

Cada teste RPA deve declarar:

```json
{
  "id": "test-login-flow",
  "name": "Teste E2E: Fluxo de Login",
  "preconditions": [
    "Sistema iniciado",
    "Frontend acessível em http://localhost:5173",
    "API acessível em http://localhost:3000"
  ],
  "expectedScreens": [
    "login-page",
    "dashboard-page"
  ],
  "actions": [
    {
      "type": "navigate",
      "url": "http://localhost:5173/login"
    },
    {
      "type": "fill",
      "selector": "input[type='email']",
      "value": "admin@example.com"
    },
    {
      "type": "click",
      "selector": "button[type='submit']"
    },
    {
      "type": "assert",
      "selector": ".dashboard",
      "exists": true
    }
  ],
  "maxDuration": 30000
}
```

## Replay Determinístico ✅

O sistema de replay determinístico está implementado em `replaySystem.js`.

### Funcionalidades Implementadas

1. **Registro durante execução:**
   - ✅ Telas (assinaturas baseadas em elementos visíveis)
   - ✅ Ações executadas (com timestamps e duração)
   - ✅ Tempos (por step e total)
   - ✅ Estados intermediários
   - ✅ Screenshots (opcional)

2. **Replay da execução:**
   - ✅ Salva replay em JSON (`/tests/rpa/replay/`)
   - ✅ Carrega replay para análise
   - ✅ Gera relatório formatado

3. **Geração de diff:**
   - ✅ Compara replays (baseline vs. atual)
   - ✅ Detecta diferenças em telas, ações e timings
   - ✅ Gera relatório de diff em texto
   - ✅ Salva diff para análise posterior

4. **Diagnóstico claro:**
   - ✅ Onde falhou (tela, ação, tempo)
   - ✅ O que esperava vs. o que encontrou
   - ✅ Screenshots de erro
   - ✅ Stack traces completos

### Uso

#### Executar com Replay Automático
```javascript
const runner = new RpaTestRunner({
  enableReplay: true, // Ativado por padrão
});

await runner.init();
const result = await runner.playback('my-recording');

// Replay salvo automaticamente em:
// /tests/rpa/replay/replay-{recordingId}-{timestamp}.json
console.log(result.replayId);
console.log(result.replayPath);
```

#### Visualizar Replay
```javascript
const { ReplaySystem } = require('./replaySystem');

const replay = ReplaySystem.load('replay-123-4567890');
const report = ReplaySystem.generateReport(replay);
console.log(report);
```

#### Comparar Replays (Diff)
```bash
node tests/rpa/replayDiff.js replay-baseline replay-atual
```

#### Gerar Relatório de Replay
```javascript
const { ReplaySystem } = require('./replaySystem');

const replay = ReplaySystem.load('replay-123');
const report = ReplaySystem.generateReport(replay);
fs.writeFileSync('replay-report.txt', report);
```

## Execução

### Pipeline Completo (inclui RPA)
```bash
npm test  # Executa: unit → flow → data → scripts → (rpa opcional)
```

### Apenas RPA (após pipeline passar)
```bash
npm run test:rpa  # Executa testes RPA E2E
```

### Replay de Execução
```bash
npm run rpa:replay:ver  # Visualiza replay
npm run rpa:replay:gerar  # Gera replay detalhado

# Comparar replays (diff)
node tests/rpa/replayDiff.js <baseline> <actual>
```

## Classificação de Erros RPA

Erros RPA são classificados como:

- **FALHA_E2E**: Problema em UX ou integração
- Código: `RPA_E2E_FAILED`
- Tipo: `FALHA_E2E`

## Integração com Sistema de Erros

RPA usa o sistema centralizado de códigos de erro:

```javascript
const { ERROR_CODES } = require('../../engine/errorCodes');

// Erro RPA
const error = new Error('Teste E2E falhou: elemento não encontrado');
error.code = ERROR_CODES.RPA_E2E_FAILED.code;
error.type = 'FALHA_E2E';
```

## Critérios de Aceitação

RPA está correto quando:

- ✅ Executa SOMENTE após todas as etapas anteriores passarem
- ✅ Testa o sistema como caixa-preta (sem acesso interno)
- ✅ Falha corretamente quando UX ou integração quebrar
- ✅ Replay permite diagnóstico claro
- ✅ Não influencia design do core
- ✅ Pipeline: unit → flow → data → scripts → rpa é imutável

---

**Status**: ✅ Implementado conforme especificação

