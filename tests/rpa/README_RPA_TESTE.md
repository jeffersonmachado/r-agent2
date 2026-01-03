# RPA de Teste - Record + Digitação Visível + Controle de Velocidade + Replay

Sistema RPA exclusivo para **TESTE/SEED**. O RPA NÃO é recurso do sistema, NÃO altera o core e NÃO interfere na engine.

## Estrutura

```
/tests/rpa/
  /recorder/      -> Gravação das ações
  /player/        -> Execução/replay
  /seeds/         -> Arquivos gravados
  /replay/        -> Artefatos de execução
  /screens/       -> Screenshots ou hashes
  rpa.config.json -> Configuração de velocidade
```

## Modos de Execução

### 1. RECORD - Gravação de Interação

Grava interação humana com digitação visível caractere a caractere.

```bash
node tests/rpa/cli.js record <seedName> [initialUrl]
```

**Exemplo:**
```bash
node tests/rpa/cli.js record login-flow http://localhost:5173
```

**Características:**
- Digitação visível caractere a caractere
- Cursor visível (se suportado)
- Registra duração real da digitação
- Permite ver erros de foco e problemas de máscara
- Seed salvo em `/tests/rpa/seeds/`

### 2. PLAYBACK - Reprodução Visual

Reproduz seed visualmente com digitação visível.

```bash
node tests/rpa/cli.js playback <seedName>
```

**Exemplo:**
```bash
node tests/rpa/cli.js playback login-flow
```

**Características:**
- Reproduz exatamente a sequência gravada
- Mostra digitação caractere a caractere
- Respeita velocidade configurada
- Destaque falhas de tela ou ação
- Gera logs claros
- Replay sempre gerado em `/tests/rpa/replay/`

### 3. CI - Execução Headless/Rápida

Reproduz seed em modo headless, no máximo de velocidade.

```bash
node tests/rpa/cli.js ci <seedName>
```

**Exemplo:**
```bash
node tests/rpa/cli.js ci login-flow
```

**Características:**
- Usa o MESMO seed do modo playback
- Ignora delays humanos
- Executa no máximo de velocidade
- Não exibe UI (headless)
- Gera replay (logs + screenshots)
- Replay sempre gerado em `/tests/rpa/replay/`

## Controle de Velocidade

Configuração em `rpa.config.json`:

```json
{
  "modes": {
    "record": {
      "headless": false,
      "showCursor": true,
      "typingSpeedMs": 50,
      "actionDelayMs": 300,
      "screenStabilizeMs": 500
    },
    "playback": {
      "headless": false,
      "showCursor": true,
      "typingSpeedMs": 50,
      "actionDelayMs": 300,
      "screenStabilizeMs": 500,
      "speedMultiplier": 1.0
    },
    "ci": {
      "headless": true,
      "showCursor": false,
      "typingSpeedMs": 0,
      "actionDelayMs": 0,
      "screenStabilizeMs": 100,
      "speedMultiplier": 10.0
    }
  }
}
```

**Parâmetros:**
- `typingSpeedMs`: Delay por caractere (ms)
- `actionDelayMs`: Delay entre ações (ms)
- `screenStabilizeMs`: Delay após mudança de tela (ms)
- `speedMultiplier`: Multiplicador de velocidade (1x, 2x, 5x, etc.)
- `showCursor`: Mostrar cursor (true/false)
- `headless`: Modo headless (true/false)

**Importante:**
- Valores NÃO ficam hardcoded no seed
- Podem ser alterados sem regravar
- Seed descreve O QUE foi feito, não COMO foi executado

## Formato do Seed

Seed gravado em `/tests/rpa/seeds/<seedName>.json`:

```json
{
  "id": "uuid",
  "name": "seed-name",
  "version": "1.0.0",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "url": "http://localhost:5173",
  "steps": [
    {
      "type": "navigate",
      "url": "http://localhost:5173/login",
      "timestamp": "2024-01-01T00:00:00.000Z"
    },
    {
      "type": "fill",
      "selector": "input[type='email']",
      "value": "admin@example.com",
      "timestamp": "2024-01-01T00:00:01.000Z"
    },
    {
      "type": "click",
      "selector": "button[type='submit']",
      "timestamp": "2024-01-01T00:00:02.000Z"
    }
  ]
}
```

**Características:**
- Tipo da ação (CLICK, TYPE, WAIT, SUBMIT, etc.)
- Seletor ou alvo
- Valor digitado (texto completo)
- Timestamp relativo
- Tela antes/depois (hash ou screenshot)
- **NÃO contém delays fixos**

## Replay Obrigatório

Para TODA execução (record, playback, ci), replay é salvo em `/tests/rpa/replay/`:

```json
{
  "id": "replay-<seedId>-<timestamp>",
  "recordingId": "seed-name",
  "startTime": "2024-01-01T00:00:00.000Z",
  "endTime": "2024-01-01T00:00:10.000Z",
  "mode": "playback",
  "screens": [
    {
      "step": "step-1",
      "timestamp": "2024-01-01T00:00:00.000Z",
      "signature": "hash-md5",
      "screenshot": "base64..."
    }
  ],
  "actions": [
    {
      "type": "fill",
      "selector": "input[type='email']",
      "value": "admin@example.com",
      "timestamp": "2024-01-01T00:00:01.000Z",
      "duration": 2500,
      "success": true
    }
  ],
  "timings": {
    "total": 10000,
    "steps": {
      "step-1": 1000,
      "step-2": 2500
    }
  },
  "errors": [],
  "result": "success"
}
```

**Conteúdo do Replay:**
- Seed utilizado
- Modo de execução
- Ações executadas
- Telas observadas
- Timestamps
- Resultado final (passou/falhou)
- Motivo da falha (se houver)

## Erros e Diagnóstico

Códigos de erro RPA:

- `RPA_ACTION_FAILED`: Ação falhou durante execução
- `RPA_ELEMENT_NOT_FOUND`: Elemento não encontrado na página
- `RPA_SCREEN_MISMATCH`: Tela não corresponde ao esperado
- `RPA_TIMEOUT`: Timeout na execução
- `RPA_E2E_FAILED`: Teste E2E falhou (caixa-preta)
- `RPA_REPLAY_FAILED`: Replay de execução falhou

**Comportamento:**
- Erros param a execução
- Replay é sempre gerado (mesmo em falha)
- Retorna código ≠ 0 em caso de erro

## Exemplos de Uso

### Gravar um novo seed

```bash
# Inicia gravação
node tests/rpa/cli.js record login-flow http://localhost:5173

# Interage com a página (digita, clica, etc.)
# Pressiona Ctrl+C para parar
```

### Reproduzir visualmente

```bash
node tests/rpa/cli.js playback login-flow
```

### Executar em CI

```bash
node tests/rpa/cli.js ci login-flow
```

### Ajustar velocidade

Edite `rpa.config.json`:

```json
{
  "modes": {
    "playback": {
      "typingSpeedMs": 100,  // Mais lento
      "actionDelayMs": 500,  // Mais delay
      "speedMultiplier": 0.5  // Metade da velocidade
    }
  }
}
```

## Critérios de Aceitação

✅ É possível gravar vendo a digitação acontecer  
✅ É possível ajustar velocidade sem regravar  
✅ É possível assistir ao replay completo  
✅ O mesmo seed roda em modo visual e CI  
✅ Replay sempre é gerado  
✅ Nenhum código do core é alterado  

## Frase-Guia

> **O seed descreve o que foi feito. A configuração decide como e quão rápido isso acontece.**

