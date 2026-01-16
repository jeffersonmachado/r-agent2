# 📹 Como Ver o Replay dos Testes RPA

## 🎯 Formas de Visualizar Replays

### 1. 📸 Screenshots Automáticos

Os testes RPA capturam screenshots automaticamente em:
```
tests/rpa/screenshots/
```

**Listar screenshots:**
```bash
ls -lh tests/rpa/screenshots/
```

**Ver screenshot mais recente:**
```bash
ls -t tests/rpa/screenshots/ | head -1 | xargs -I {} open tests/rpa/screenshots/{}
# ou no Linux:
ls -t tests/rpa/screenshots/ | head -1 | xargs -I {} xdg-open tests/rpa/screenshots/{}
```

### 2. 📊 Relatórios de Replay

**Ver replay do seed mais recente:**
```bash
node tests/rpa/verReplaySeed.js
```

**Gerar replay detalhado:**
```bash
node tests/rpa/gerarReplayDetalhado.js
```

### 3. 🎬 Executar Teste em Modo Visual

**Ver o teste executando em tempo real:**
```bash
# Modo visual (abre navegador)
HEADLESS=false node tests/rpa/login.test.js

# Com velocidade reduzida para ver melhor
HEADLESS=false node tests/rpa/login.test.js
```

### 4. 📁 Arquivos de Replay JSON

Os replays são salvos em:
```
tests/rpa/replay/
```

**Listar replays:**
```bash
ls -lh tests/rpa/replay/
```

**Ver conteúdo de um replay:**
```bash
cat tests/rpa/replay/replay-*.json | jq .
# ou sem jq:
cat tests/rpa/replay/replay-*.json
```

### 5. 🔍 Ver Seeds Gravados

**Listar seeds disponíveis:**
```bash
node tests/rpa/ver-seed-rpa.js
```

**Ver e executar um seed específico:**
```bash
node tests/rpa/ver-seed-rpa.js <nome-do-seed>
```

## 🚀 Exemplos Práticos

### Ver Screenshots do Teste de Login

```bash
# Listar screenshots do teste de login
ls -lh tests/rpa/screenshots/login-*.png

# Ver o mais recente
ls -t tests/rpa/screenshots/login-*.png | head -1 | xargs xdg-open
```

### Executar Teste e Ver em Tempo Real

```bash
# Executa teste abrindo navegador
HEADLESS=false node tests/rpa/login.test.js
```

### Ver Relatório Completo

```bash
# Ver replay do seed mais recente
node tests/rpa/verReplaySeed.js

# Gerar replay detalhado
node tests/rpa/gerarReplayDetalhado.js
```

## 📋 Estrutura de um Replay

Um replay JSON contém:

```json
{
  "id": "replay-id",
  "recordingId": "seed-name",
  "startTime": "2024-01-10T14:30:00.000Z",
  "endTime": "2024-01-10T14:30:30.000Z",
  "screens": [
    {
      "step": 1,
      "signature": "abc123",
      "signatureData": { ... },
      "timestamp": "2024-01-10T14:30:00.000Z"
    }
  ],
  "actions": [
    {
      "step": 1,
      "type": "navigate",
      "url": "http://localhost:5173/login",
      "timestamp": "2024-01-10T14:30:00.000Z"
    }
  ],
  "timings": {
    "total": 30000,
    "steps": [1000, 2000, ...]
  },
  "errors": []
}
```

## 🎯 Para o Teste de Login Específico

O teste de login (`login.test.js`) gera:

1. **Screenshots** em `tests/rpa/screenshots/`:
   - `login-test-{timestamp}.png` - Screenshot do teste básico
   - `login-provider-check-{timestamp}.png` - Screenshot do teste com provider

2. **Logs detalhados** no console durante execução

3. **Replays** (se habilitado no código)

## 💡 Dicas

- Use `HEADLESS=false` para ver o teste executando
- Screenshots são salvos automaticamente em caso de erro
- Replays JSON podem ser analisados com `jq` ou editores de texto
- Use `slowMo` no código para reduzir velocidade de execução

## 🔧 Habilitar Replay no Teste de Login

Para gerar replays automáticos, o teste precisa usar o `ReplaySystem`. 
Veja o arquivo `login.test.js` para ver como está implementado.
