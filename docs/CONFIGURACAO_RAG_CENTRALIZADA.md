# Configuração RAG Centralizada

## 📋 Visão Geral

O serviço RAG Python (`rag-service`) agora lê suas configurações do `config.json` do Node.js, centralizando toda a configuração em um único arquivo.

## 🔄 Como Funciona

### Prioridade de Configuração

1. **Variáveis de ambiente** (precedência mais alta)
   - Prefixo: `RAG_*`
   - Exemplo: `RAG_PORT=8000`, `RAG_DEFAULT_TOP_K=7`

2. **config.json** (api/data/config.json)
   - Seção: `rag.service`
   - Lido automaticamente na inicialização

3. **Valores padrão** (fallback)
   - Usados se nenhuma das opções acima estiver disponível

## 📝 Estrutura no config.json

```json
{
  "rag": {
    "serviceUrl": "http://localhost:9000",
    "timeout": 5000,
    "service": {
      "host": "0.0.0.0",
      "port": 9000,
      "debug": false,
      "embedding": {
        "model": "sentence-transformers/all-MiniLM-L6-v2",
        "dimension": 384
      },
      "chunking": {
        "size": 500,
        "overlap": 50,
        "strategy": "sentence"
      },
      "vectorStore": {
        "type": "postgres"
      },
      "llm": {
        "provider": "openai",
        "model": "gpt-4o-mini",
        "maxTokens": 1000,
        "temperature": 0.7
      },
      "defaults": {
        "topK": 6,
        "minScore": 0.45
      }
    },
    "tenants": {
      "tenant-acme": {
        "serviceUrl": "http://localhost:9000",
        "timeout": 5000,
        "domains": {
          "chatbot": {
            "sources": ["knowledge_base", "product_docs", "chat_upload"],
            "defaultCategory": "general",
            "enabled": true
          }
        }
      }
    }
  }
}
```

## 🔍 Caminhos de Busca

O `settings.py` tenta encontrar o `config.json` nos seguintes caminhos (em ordem):

1. `../api/data/config.json` (desenvolvimento local)
2. `../../api/data/config.json` (docker/compose)
3. `./api/data/config.json` (alternativo)
4. `/opt/results/ria/r-agent2/api/data/config.json` (caminho absoluto)

## ⚙️ Configurações Disponíveis

### Servidor
- `host`: Endereço do servidor (padrão: "0.0.0.0")
- `port`: Porta do servidor (padrão: 9000)
- `debug`: Modo debug (padrão: false)

### Embeddings
- `embedding.model`: Modelo de embedding (padrão: "sentence-transformers/all-MiniLM-L6-v2")
- `embedding.dimension`: Dimensão do embedding (padrão: 384)

### Chunking
- `chunking.size`: Tamanho do chunk (padrão: 500)
- `chunking.overlap`: Sobreposição entre chunks (padrão: 50)
- `chunking.strategy`: Estratégia de chunking (padrão: "sentence")
  - Opções: "fixed_size", "sentence", "paragraph", "semantic"

### Vector Store
- `vectorStore.type`: Tipo de vector store (padrão: "postgres")
  - Opções: "postgres"

### LLM
- `llm.provider`: Provedor LLM (padrão: "openai")
  - Opções: "openai", "anthropic"
- `llm.model`: Modelo LLM (padrão: "gpt-4o-mini")
- `llm.maxTokens`: Máximo de tokens (padrão: 1000)
- `llm.temperature`: Temperatura (padrão: 0.7)

### RAG Defaults
- `defaults.topK`: Número de chunks a buscar (padrão: 6)
- `defaults.minScore`: Score mínimo para chunks (padrão: 0.45)

## 🔧 Override via Variáveis de Ambiente

Você pode sobrescrever qualquer configuração usando variáveis de ambiente com prefixo `RAG_`:

```bash
# Exemplos
export RAG_PORT=8000
export RAG_DEFAULT_TOP_K=7
export RAG_DEFAULT_MIN_SCORE=0.4
export RAG_LLM_MODEL="gpt-4"
export RAG_LLM_MAX_TOKENS=2000
```

## 📝 Exemplo de Uso

### 1. Configurar via config.json

Edite `api/data/config.json`:

```json
{
  "rag": {
    "service": {
      "port": 8000,
      "defaults": {
        "topK": 7,
        "minScore": 0.4
      }
    }
  }
}
```

### 2. Configurar via Variáveis de Ambiente

```bash
export RAG_PORT=8000
export RAG_DEFAULT_TOP_K=7
export RAG_DEFAULT_MIN_SCORE=0.4
```

### 3. Docker Compose

```yaml
rag-service:
  environment:
    RAG_PORT: 8000
    RAG_DEFAULT_TOP_K: 7
    RAG_DEFAULT_MIN_SCORE: 0.4
```

## ✅ Benefícios

1. **Configuração Centralizada**: Tudo em um único arquivo (`config.json`)
2. **Consistência**: Mesmas configurações para Node.js e Python
3. **Flexibilidade**: Override via variáveis de ambiente quando necessário
4. **Manutenção**: Mais fácil de gerenciar e versionar

## 🔄 Migração

Se você tinha configurações hardcoded no `settings.py`, elas agora devem estar no `config.json`:

**Antes** (settings.py):
```python
default_top_k: int = 6
default_min_score: float = 0.45
```

**Depois** (config.json):
```json
{
  "rag": {
    "service": {
      "defaults": {
        "topK": 6,
        "minScore": 0.45
      }
    }
  }
}
```

## ⚠️ Notas Importantes

1. **API Key**: A chave da OpenAI continua sendo lida de `OPENAI_API_KEY` (variável de ambiente) por segurança
2. **Fallback**: Se o `config.json` não for encontrado, valores padrão são usados
3. **Logs**: O sistema loga a fonte de configuração na inicialização
4. **Hot Reload**: Mudanças no `config.json` requerem reinicialização do serviço

## 📚 Documentação Relacionada

- [RAG para Desenvolvimento](./RAG_PARA_DEV.md)
- [Como Diminuir Taxa de Falha](./COMO_DIMINUIR_TAXA_FALHA_RAG.md)
- [Otimizações RAG Aplicadas](./OTIMIZACOES_RAG_APLICADAS.md)

---

**Última atualização**: 2026-01-05
