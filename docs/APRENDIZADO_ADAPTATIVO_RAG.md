# Aprendizado Adaptativo para RAG

## 📋 Visão Geral

O sistema de **Aprendizado Adaptativo** melhora dinamicamente a acurácia do RAG por tenant, aprendendo com cada consulta e ajustando automaticamente:

- **Sinônimos**: Extraídos dinamicamente dos documentos indexados
- **Configurações**: Otimizadas baseadas em métricas de sucesso/falha
- **Prompts**: Ajustados baseados em padrões de queries bem-sucedidas
- **Métricas**: Monitoradas continuamente para feedback loop

## 🎯 Como Funciona

### 1. **Extração Dinâmica de Sinônimos**

O sistema analisa os documentos indexados de cada tenant para encontrar termos que aparecem juntos frequentemente, criando grupos de sinônimos automaticamente.

**Exemplo**:
- Se "planos" e "pacotes" aparecem frequentemente nos mesmos documentos
- O sistema aprende que são sinônimos
- Queries com "planos" também buscam por "pacotes"

### 2. **Registro de Resultados**

Cada consulta RAG é registrada com:
- Query realizada
- Sucesso/falha
- Confiança
- Número de chunks encontrados

### 3. **Otimização de Configurações**

Baseado nas métricas, o sistema ajusta automaticamente:
- `minScore`: Reduzido se taxa de sucesso < 70%, aumentado se > 85%
- `topK`: Ajustado baseado em número médio de chunks encontrados
- `chunkOverlap`: Otimizado para melhor contexto

### 4. **Ajuste de Prompts**

O prompt do LLM é ajustado dinamicamente:
- Se há muitas falhas recentes: Prompt mais permissivo
- Se há muitas sucessos: Prompt mais focado em qualidade

## 🔄 Fluxo de Aprendizado

```
1. Documentos Indexados
   ↓
2. Análise de Documentos (extrai sinônimos)
   ↓
3. Consultas RAG (registra resultados)
   ↓
4. Análise de Métricas
   ↓
5. Otimização Automática
   ↓
6. Melhoria Contínua
```

## 📊 Métricas Monitoradas

- **Taxa de Sucesso**: % de queries que geram respostas
- **Confiança Média**: Score médio de confiança
- **Chunks Encontrados**: Número médio de chunks por query
- **Status**: `good` (≥85%), `needs_improvement` (70-85%), `poor` (<70%)

## 🚀 Como Usar

### 1. Análise Automática de Documentos

Quando você usa a funcionalidade "📊 Analisar Documentos" na página `/rag-documents`:

1. O sistema testa perguntas baseadas nos documentos
2. **Automaticamente** atualiza sinônimos aprendidos
3. **Automaticamente** dispara otimização de configurações
4. Melhora a acurácia para próximas consultas

### 2. Consultas Normais

Toda consulta RAG é automaticamente:
- Registrada para aprendizado
- Usa sinônimos aprendidos do tenant
- Usa configurações otimizadas
- Usa prompts otimizados

### 3. Verificar Métricas

```javascript
// No frontend
import { getLearningMetrics } from '../api/ragDocuments';

const metrics = await getLearningMetrics(tenantId);
console.log(metrics);
// {
//   totalQueries: 150,
//   successfulQueries: 135,
//   failedQueries: 15,
//   successRate: 0.900,
//   avgConfidence: 0.75,
//   status: "good"
// }
```

### 4. Disparar Aprendizado Manualmente

```javascript
// No frontend
import { triggerLearning } from '../api/ragDocuments';

const result = await triggerLearning(tenantId);
// Otimiza configurações e analisa padrões
```

## 📁 Estrutura de Dados

Os dados de aprendizado são armazenados em:
```
rag-service/data/adaptive_learning/
  ├── tenant-abc_learning.json
  ├── tenant-xyz_learning.json
  └── ...
```

**Estrutura do arquivo**:
```json
{
  "tenantId": "tenant-abc",
  "synonyms": {
    "planos": ["pacotes", "assinaturas"],
    "pagamento": ["pagar", "checkout"]
  },
  "queryPatterns": {
    "successful": [...],
    "failed": [...]
  },
  "metrics": {
    "totalQueries": 150,
    "successfulQueries": 135,
    "failedQueries": 15,
    "avgConfidence": 0.75
  },
  "config": {
    "minScore": 0.45,
    "topK": 6,
    "chunkOverlap": 75
  }
}
```

## 🔧 API Endpoints

### Python (FastAPI)

- `POST /rag/learning/update-synonyms` - Atualiza sinônimos
- `GET /rag/learning/metrics/{tenantId}` - Obtém métricas
- `POST /rag/learning/trigger-learning/{tenantId}` - Dispara aprendizado

### Node.js (Proxy)

- `POST /rag/learning/update-synonyms` - Atualiza sinônimos
- `GET /rag/learning/metrics/{tenantId}` - Obtém métricas
- `POST /rag/learning/trigger-learning/{tenantId}` - Dispara aprendizado

## ⚙️ Configuração Automática

O sistema ajusta automaticamente:

### Taxa de Sucesso < 70%
- Reduz `minScore` em 0.05
- Aumenta `topK` se necessário
- Torna prompt mais permissivo

### Taxa de Sucesso 70-85%
- Mantém configurações atuais
- Foca em melhorar qualidade dos documentos

### Taxa de Sucesso > 85%
- Aumenta `minScore` em 0.05 (melhor qualidade)
- Mantém `topK` otimizado
- Prompt focado em qualidade

## 📈 Melhorias Contínuas

O sistema aprende continuamente:

1. **A cada consulta**: Registra resultado
2. **A cada análise**: Atualiza sinônimos
3. **Periodicamente**: Otimiza configurações
4. **Baseado em métricas**: Ajusta prompts

## 🎯 Meta de Performance

**Objetivo**: Taxa de sucesso ≥ 85% com confiança média ≥ 0.70

O sistema trabalha automaticamente para atingir essa meta através de:
- Aprendizado de sinônimos
- Otimização de configurações
- Ajuste de prompts
- Feedback loop contínuo

## ⚠️ Notas Importantes

1. **Dados por Tenant**: Cada tenant tem seu próprio aprendizado isolado
2. **Mínimo de Dados**: Precisa de pelo menos 10 queries para otimizar
3. **Reindexação**: Após mudanças significativas, reindexe documentos
4. **Monitoramento**: Verifique métricas regularmente

## 🔍 Debugging

### Ver Sinônimos Aprendidos

```python
from services.adaptive_learning import get_adaptive_learning_service

service = get_adaptive_learning_service()
synonyms = service.get_synonyms("tenant-abc")
print(synonyms)
```

### Ver Configurações Otimizadas

```python
config = service.optimize_config("tenant-abc")
print(config)
```

### Ver Métricas

```python
metrics = service.get_metrics("tenant-abc")
print(metrics)
```

## 📚 Recursos Relacionados

- [Como Melhorar Acurácia RAG](./COMO_MELHORAR_ACURACIA_RAG.md)
- [Como Diminuir Taxa de Falha RAG](./COMO_DIMINUIR_TAXA_FALHA_RAG.md)
- [Configuração RAG Centralizada](./CONFIGURACAO_RAG_CENTRALIZADA.md)

---

**Última atualização**: 2026-01-05
**Versão**: 1.0

