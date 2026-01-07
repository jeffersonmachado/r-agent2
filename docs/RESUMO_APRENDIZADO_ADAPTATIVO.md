# Resumo: Sistema de Aprendizado Adaptativo RAG

## 📋 Visão Geral

O sistema de aprendizado adaptativo RAG foi implementado para melhorar continuamente a acurácia do sistema através de:

1. **Validação dinâmica de queries** usando regras configuráveis em JSON
2. **Adaptação automática de regras** baseada no desempenho
3. **Aprendizado de sinônimos** extraídos dos documentos
4. **Otimização de configurações** (minScore, topK, chunkOverlap)
5. **Limpeza automática** de queries inválidas e duplicadas

## 🎯 Funcionalidades Implementadas

### 1. Regras de Validação em JSON

**Arquivo:** `api/data/rag_validation_rules.json`

- Todas as regras de validação estão em JSON (não no código)
- Regras configuráveis: comprimento, UUIDs, repetições, prefixos inválidos, etc.
- Pesos ajustáveis para cada regra
- Parâmetros adaptáveis (minLength, maxLength, etc.)

### 2. Adaptação Automática

- **Ciclos de adaptação:** Ajusta regras automaticamente até atingir acurácia alvo
- **Limite de ciclos:** Configurável (padrão: 50 ciclos)
- **Acurácia alvo:** Configurável (padrão: 85%)
- **Ajuste de pesos:** Aumenta/diminui pesos das regras baseado no desempenho
- **Ajuste de parâmetros:** Modifica limites e thresholds automaticamente

### 3. Validação de Queries

**Filtros implementados:**
- ✅ Repetições consecutivas (ex: "Studio Studio studio")
- ✅ Palavras repetidas após interrogação (ex: "O que é Studio? studio")
- ✅ Textos de OCR mal formatados (ex: "jpeg] Texto extraído")
- ✅ Placeholders de imagens (ex: "[Imagem: uuid imagem")
- ✅ UUIDs em textos curtos
- ✅ Perguntas genéricas demais
- ✅ Textos com muitos caracteres especiais
- ✅ Metadados e placeholders

### 4. Limpeza de Histórico

- Remove queries inválidas do histórico
- Remove duplicatas
- Mantém apenas queries válidas e únicas
- Botão no frontend para limpeza manual

### 5. Interface de Manutenção

**Modal de Aprendizado Adaptativo:**
- 📊 Estatísticas de aprendizado
- 🔄 Contador de ciclos realizados
- 📝 Lista de sinônimos aprendidos (editável)
- ✅ Perguntas bem-sucedidas
- ❌ Perguntas falhadas
- ⚙️ Configurações otimizadas
- 🧹 Botão para limpar queries inválidas

## 🔧 Configuração

### Arquivo de Regras

`api/data/rag_validation_rules.json`:

```json
{
  "version": "1.0.0",
  "maxCycles": 50,
  "targetAccuracy": 0.85,
  "rules": {
    "length": {
      "enabled": true,
      "minLength": 10,
      "maxLength": 200,
      "weight": 1.0
    },
    // ... outras regras
  },
  "adaptation": {
    "enabled": true,
    "adjustmentRate": 0.1,
    "minWeight": 0.1,
    "maxWeight": 2.0
  }
}
```

### Endpoints da API

- `GET /rag/learning/validation-rules` - Obtém regras atuais
- `POST /rag/learning/validation-rules/adapt/:tenantId` - Dispara adaptação
- `GET /rag/learning/full-data/:tenantId` - Dados completos de aprendizado
- `POST /rag/learning/clean-invalid-queries/:tenantId` - Limpa queries inválidas
- `PUT /rag/learning/synonyms` - Atualiza sinônimo específico
- `DELETE /rag/learning/synonyms/:tenantId/:term` - Remove sinônimo

## 🧪 Testes

### Executar Testes

```bash
# Testes de aprendizado adaptativo
npm run test:rag:adaptive

# Todos os testes
npm run test:complete
```

### Cobertura de Testes

- ✅ Validação de queries válidas e inválidas
- ✅ Registro de queries (ignora inválidas)
- ✅ Adaptação automática de regras
- ✅ Limpeza de queries inválidas
- ✅ Endpoints de aprendizado adaptativo
- ✅ Limites de ciclos e acurácia

## 📊 Como Funciona

### Fluxo de Adaptação

1. **Inicialização:** Carrega regras do JSON
2. **Validação:** Usa regras para validar queries
3. **Registro:** Registra apenas queries válidas
4. **Análise:** Após cada ciclo, analisa desempenho
5. **Adaptação:** Ajusta pesos e parâmetros das regras
6. **Parada:** Para quando atinge acurácia alvo ou limite de ciclos

### Ciclo de Aprendizado

```
Análise de Documentos
    ↓
Geração de Perguntas
    ↓
Validação (Regras JSON)
    ↓
Teste com RAG
    ↓
Registro de Resultados
    ↓
Adaptação de Regras (se necessário)
    ↓
Otimização de Configurações
```

## 🚀 Iniciar Serviços

Ver documentação completa em: [INICIAR_SERVICOS.md](./INICIAR_SERVICOS.md)

**Resumo rápido:**
```bash
# Terminal 1: RAG Service
cd rag-service
python3 -m uvicorn main:app --reload --host 0.0.0.0 --port 9000

# Terminal 2: API Node.js
node api/server.js

# Terminal 3: Frontend
cd frontend && npm start
```

## 📈 Métricas e Monitoramento

O sistema rastreia:
- Total de queries
- Taxa de sucesso
- Confiança média
- Número de ciclos de aprendizado
- Sinônimos aprendidos
- Queries bem-sucedidas e falhadas
- Configurações otimizadas

## 🔍 Troubleshooting

### Erro: "CONNECTION_REFUSED"

**Causa:** Serviço RAG não está rodando.

**Solução:** Inicie o serviço RAG na porta 9000.

### Erro: "API não acessível"

**Causa:** API Node.js não está rodando.

**Solução:** Inicie a API Node.js na porta 3000.

### Queries inválidas não sendo filtradas

**Verificar:**
1. Arquivo `rag_validation_rules.json` existe e é válido
2. Regras estão habilitadas (`"enabled": true`)
3. Serviço RAG está usando as regras corretas

### Adaptação não está funcionando

**Verificar:**
1. `adaptation.enabled` está `true` no JSON
2. Há dados suficientes (mínimo 10 queries)
3. Não atingiu limite de ciclos
4. Não atingiu acurácia alvo

## 📚 Arquivos Principais

- `api/data/rag_validation_rules.json` - Regras de validação
- `rag-service/services/adaptive_learning.py` - Lógica de aprendizado
- `rag-service/api/routes/learning.py` - Endpoints de aprendizado
- `frontend/src/pages/RAGDocumentsPage.jsx` - Interface de manutenção
- `scripts/test-rag-adaptive-learning.js` - Testes automatizados

## ✅ Status

- ✅ Regras em JSON (não no código)
- ✅ Adaptação automática implementada
- ✅ Validação de queries funcionando
- ✅ Limpeza de queries inválidas
- ✅ Interface de manutenção
- ✅ Testes automatizados
- ✅ Documentação completa

