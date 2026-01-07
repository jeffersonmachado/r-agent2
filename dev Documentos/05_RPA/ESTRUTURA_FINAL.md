# 📁 Estrutura Final de Diretórios RPA

## Diretórios Necessários

### ✅ Diretórios de Dados

| Diretório | Propósito | Conteúdo | Obrigatório |
|-----------|-----------|----------|-------------|
| **`/seeds/`** | Seeds unificados | Todos os seeds (manuais e automáticos) | ✅ Sim |
| **`/flows/`** | Testes gerados | Testes RPA gerados automaticamente de fluxos | ✅ Sim |
| **`/replay/`** | Replays determinísticos | Replays JSON de execuções | ✅ Sim |
| **`/reports/`** | Relatórios | Relatórios de execução em JSON | ✅ Sim |
| **`/screenshots/`** | Screenshots de erros | Imagens PNG de falhas | ✅ Sim |

### ✅ Diretórios de Código

| Diretório | Propósito | Arquivos |
|-----------|-----------|----------|
| **`/player/`** | Executor de seeds | `rpaPlayer.js` |
| **`/recorder/`** | Gravador visual | `rpaRecorder.js` |
| **`/utils/`** | Utilitários | `authHelper.js`, `rpaTokenManager.js`, etc |
| **`/config/`** | Configurações | `rpa-token.json`, `README.md` |

### ⚠️ Diretórios Opcionais

| Diretório | Propósito | Status |
|-----------|-----------|--------|
| **`/examples/`** | Exemplos de uso | Opcional (útil para documentação) |

## ❌ Diretórios Removidos

| Diretório | Razão |
|-----------|-------|
| **`/replays/`** | Duplicado de `/replay/` (vazio) |
| **`/screens/`** | Não implementado (vazio) |
| **`/recordings/`** | Obsoleto (migrado para `/seeds/`) |

## 📊 Estrutura Completa

```
/tests/rpa/
  /seeds/               # ✅ Seeds unificados (manuais e automáticos)
  /flows/               # ✅ Testes RPA gerados de fluxos
  /replay/              # ✅ Replays determinísticos (obrigatório)
  /reports/             # ✅ Relatórios de execução
  /screenshots/         # ✅ Screenshots de erros
  /player/              # ✅ Código: Executor de seeds
  /recorder/            # ✅ Código: Gravador visual
  /utils/               # ✅ Código: Utilitários
  /config/              # ✅ Configurações e tokens
  /examples/            # ⚠️  Opcional: Exemplos
  *.js                  # Código fonte principal
```

## 🎯 Regras de Uso

### Seeds e Flows

- **`/seeds/`**: Todos os seeds, independente da origem
  - Flag `source: "manual"` para seeds gravados manualmente
  - Flag `source: "automatic"` para seeds gerados automaticamente
  
- **`/flows/`**: Testes RPA gerados automaticamente de fluxos
  - Formato específico para testes de fluxos
  - Gerado por `generationOrchestrator` e `pipelineOrchestrator`

### Artefatos de Execução

- **`/replay/`**: Replays determinísticos (obrigatório)
  - Gerado automaticamente em toda execução
  - Formato: `replay-{id}-{timestamp}.json`
  
- **`/reports/`**: Relatórios de execução
  - Formato: `rpa-report-{timestamp}.json`
  - Inclui resumo, erros, screenshots
  
- **`/screenshots/`**: Screenshots de erros
  - Capturados automaticamente em falhas
  - Formato: `error-step-{n}-{timestamp}.png`

## 🔄 Migração

### Diretórios Removidos

- **`/replays/`**: Removido (duplicado de `/replay/`)
- **`/screens/`**: Removido (não implementado)
- **`/recordings/`**: Removido (migrado para `/seeds/`)

### Código Atualizado

- `tests/runner.js`: Atualizado para usar `/seeds/` e `/flows/`
- Documentação: Atualizada para refletir estrutura final

## ✅ Validação

Todos os diretórios necessários estão presentes e sendo usados:
- ✅ `/seeds/` - Unificado e funcional
- ✅ `/flows/` - Usado para testes gerados
- ✅ `/replay/` - Replays obrigatórios
- ✅ `/reports/` - Relatórios funcionais
- ✅ `/screenshots/` - Screenshots de erros
- ✅ Diretórios de código organizados

