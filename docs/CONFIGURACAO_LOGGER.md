# ⚙️ Configuração do Logger

## 📋 Configuração em `config.json`

O logger lê suas configurações de `api/data/config.json`:

```json
{
  "logging": {
    "level": "INFO",
    "format": "json"
  }
}
```

### Opções de Configuração

#### `level` (string ou número)

Nível de log desejado:

- `"DEBUG"` ou `0` - Todas as mensagens (debug, info, warn, error)
- `"INFO"` ou `1` - Informações, avisos e erros (padrão em produção)
- `"WARN"` ou `2` - Apenas avisos e erros
- `"ERROR"` ou `3` - Apenas erros
- `"NONE"` ou `4` - Nenhum log

**Exemplo:**
```json
{
  "logging": {
    "level": "DEBUG"
  }
}
```

#### `format` (string)

Formato de saída dos logs:

- `"json"` - Formato JSON estruturado (recomendado para produção)
- `"text"` - Formato texto legível (padrão)

**Exemplo JSON:**
```json
{"timestamp":"2025-12-30T11:07:12.289Z","level":"INFO","message":"Mensagem"}
```

**Exemplo Texto:**
```
[2025-12-30T11:07:12.289Z] [INFO] Mensagem
```

---

## 🔄 Ordem de Precedência

O logger verifica as configurações nesta ordem:

1. **Configuração em `config.json`** (`logging.level`)
2. **Variável de ambiente** (`LOG_LEVEL`)
3. **Padrão** (INFO em produção, DEBUG em desenvolvimento)

---

## 📝 Exemplo de Configuração Completa

```json
{
  "nodeEnv": "production",
  "api": {
    "port": 3000
  },
  "logging": {
    "level": "INFO",
    "format": "json"
  }
}
```

---

## 🧪 Testando a Configuração

```bash
# Verificar configuração atual
cat api/data/config.json | jq '.logging'

# Testar logger
node -e "const logger = require('./api/utils/logger'); logger.info('Teste');"
```

---

## 🔧 Mudando o Nível de Log

### Via Configuração (Recomendado)

Edite `api/data/config.json`:

```json
{
  "logging": {
    "level": "DEBUG"
  }
}
```

Reinicie o servidor para aplicar.

### Via Variável de Ambiente (Temporário)

```bash
export LOG_LEVEL=0  # DEBUG
node api/server.js
```

---

## 📊 Formatos de Saída

### Formato JSON (Recomendado)

```json
{
  "timestamp": "2025-12-30T11:07:12.289Z",
  "level": "INFO",
  "message": "Mensagem informativa"
}
```

Com erro:
```json
{
  "timestamp": "2025-12-30T11:07:12.289Z",
  "level": "ERROR",
  "message": "Mensagem de erro",
  "error": {
    "message": "Erro de teste",
    "stack": "Error: Erro de teste\n    at ..."
  }
}
```

### Formato Texto

```
[2025-12-30T11:07:12.289Z] [INFO] Mensagem informativa
```

Com erro:
```
[2025-12-30T11:07:12.289Z] [ERROR] Mensagem de erro
Error: Erro de teste
    at ...
```

---

## ✅ Status

- ✅ Logger lê configuração de `config.json`
- ✅ Suporta níveis: DEBUG, INFO, WARN, ERROR, NONE
- ✅ Suporta formatos: JSON, TEXT
- ✅ Fallback para variável de ambiente
- ✅ Configuração padrão sensata

---

**Última Atualização:** 2024

