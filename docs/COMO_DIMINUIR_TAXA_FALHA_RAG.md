# Como Diminuir a Taxa de Falha do RAG

Este guia apresenta estratégias práticas e acionáveis para reduzir a taxa de falha nas consultas RAG.

## 📊 Fatores que Influenciam a Taxa de Falha

### 1. **Nenhum Chunk Encontrado** (Principal Causa)
- **Causa**: Chunks com score abaixo do `minScore` (atualmente 0.5) são filtrados
- **Impacto**: Se nenhum chunk passar no filtro, a consulta falha

### 2. **Query Inválida**
- **Causa**: UUIDs ou queries muito curtas são rejeitadas
- **Impacto**: Comportamento esperado, mas pode ser melhorado com validação prévia

### 3. **Confiança Baixa**
- **Causa**: Mesmo com chunks encontrados, se `confidence < ragMinConfidence` (0.5), não é usado
- **Impacto**: Consultas válidas podem ser rejeitadas

### 4. **Resposta do LLM Muito Curta**
- **Causa**: Respostas < 20 caracteres são consideradas inválidas
- **Impacto**: Pode falhar mesmo com chunks relevantes

## 🎯 Estratégias para Reduzir a Taxa de Falha

### Estratégia 1: Ajustar Thresholds de Score

#### 1.1 Reduzir `minScore` Progressivamente

**Quando usar**: Se muitas consultas falham por falta de chunks

**Como fazer**:

```javascript
// No nó AI (engine/nodes/aiNode.js)
const filters = {
  topK: config.ragTopK || 5,
  minScore: 0.4,  // Reduzido de 0.5 para 0.4
  maxTokens: config.ragMaxTokens || 1000,
};
```

**Ou via configuração do nó**:
```json
{
  "config": {
    "ragMinConfidence": 0.4,
    "ragTopK": 7
  }
}
```

**⚠️ Atenção**: Reduzir muito pode trazer chunks irrelevantes. Teste incrementalmente:
- 0.5 → 0.4 → 0.3 (só se necessário)

#### 1.2 Aumentar `topK`

**Quando usar**: Se poucos chunks são encontrados

**Como fazer**:
```javascript
const filters = {
  topK: 7,  // Aumentado de 5 para 7
  minScore: 0.5,
  maxTokens: 1000,
};
```

**Benefício**: Mais chunks candidatos = maior chance de encontrar relevantes

### Estratégia 2: Melhorar Qualidade dos Documentos Indexados

#### 2.1 Revisar Estratégia de Chunking

**Arquivo**: `rag-service/config/settings.py`

```python
# Estratégias disponíveis:
chunk_strategy: str = "sentence"  # Melhor para preservar contexto
# Opções: fixed_size | sentence | paragraph | semantic
```

**Recomendações**:
- Use `sentence` para documentos técnicos
- Use `paragraph` para documentos narrativos
- Ajuste `chunk_size` (padrão: 500) e `chunk_overlap` (padrão: 50)

#### 2.2 Melhorar Conteúdo dos Documentos

**Checklist**:
- [ ] Documentos são descritivos e completos?
- [ ] Termos-chave importantes estão presentes?
- [ ] Sinônimos e variações estão incluídos?
- [ ] Exemplos práticos estão documentados?

**Exemplo de melhoria**:
```
❌ Ruim: "Planos disponíveis"
✅ Bom: "Nossos planos incluem: Plano Básico (R$ 29,90/mês), Plano Premium (R$ 59,90/mês) e Plano Empresarial (R$ 149,90/mês). Cada plano oferece diferentes recursos e limites de uso."
```

### Estratégia 3: Melhorar Processamento de Queries

#### 3.1 Expandir Queries com Sinônimos

O sistema já faz isso via NLP, mas você pode melhorar:

**Arquivo**: `rag-service/services/nlp_service.py`

Adicione sinônimos comuns:
```python
SYNONYMS = {
    "planos": ["planos", "pacotes", "planos de assinatura", "planos disponíveis"],
    "pagamento": ["pagamento", "pagar", "forma de pagamento", "método de pagamento"],
    # Adicione mais conforme necessário
}
```

#### 3.2 Melhorar Validação de Queries

**Arquivo**: `rag-service/api/routes/query.py`

Ajuste a função `is_uuid_or_meaningless_query` para ser menos restritiva:

```python
def is_uuid_or_meaningless_query(query: str) -> bool:
    # ... código existente ...
    
    # Permite queries curtas mas com sentido
    if len(query_clean) >= 3 and len(query_clean) < 10:
        # Verifica se tem pelo menos uma palavra significativa
        words = query_clean.split()
        if len(words) >= 1:
            return False  # Permite queries curtas mas válidas
    
    # ... resto do código ...
```

### Estratégia 4: Implementar Fallback Inteligente

#### 4.1 Fallback com Chunks Parciais

O sistema já tem fallback, mas você pode melhorar:

**Arquivo**: `rag-service/api/routes/query.py`

```python
# Se não encontrar chunks suficientes, tenta com minScore menor
if not chunks and min_score > 0.3:
    logger.info(f"Tentando busca com minScore reduzido: {min_score * 0.8}")
    chunks = vector_store.search(query_embedding, top_k=top_k, filters=filters)
    chunks = [chunk for chunk in chunks if chunk.score and chunk.score >= (min_score * 0.8)]
```

#### 4.2 Fallback para Consultas Similares

```python
# Se falhar, tenta buscar por termos-chave extraídos
if not chunks:
    # Extrai termos-chave da query
    keywords = extract_keywords(request.query)
    # Tenta busca por termos individuais
    for keyword in keywords:
        keyword_chunks = vector_store.search(
            generate_embedding(keyword), 
            top_k=3, 
            filters=filters
        )
        if keyword_chunks:
            chunks.extend(keyword_chunks)
            break
```

### Estratégia 5: Monitoramento e Ajuste Contínuo

#### 5.1 Usar o Script de Análise

Execute regularmente:
```bash
npm run analyze:rag-logs < logs.txt
```

**Foque em**:
- Consultas que falham consistentemente
- Padrões de queries que não encontram chunks
- Taxa de confiança média

#### 5.2 Ajustar Baseado em Métricas

**Se taxa de falha > 30%**:
1. Reduza `minScore` para 0.4
2. Aumente `topK` para 7
3. Revise qualidade dos documentos

**Se taxa de falha entre 15-30%**:
1. Melhore conteúdo dos documentos
2. Adicione sinônimos
3. Ajuste estratégia de chunking

**Se taxa de falha < 15%**:
1. Mantenha configurações atuais
2. Foque em melhorar confiança média

## 🔧 Configurações Recomendadas por Cenário

### Cenário 1: Alta Taxa de Falha (> 30%)

```javascript
// Configuração agressiva
{
  ragTopK: 7,
  ragMinConfidence: 0.4,
  minScore: 0.4,
  ragMaxTokens: 1000
}
```

### Cenário 2: Taxa de Falha Média (15-30%)

```javascript
// Configuração balanceada
{
  ragTopK: 6,
  ragMinConfidence: 0.45,
  minScore: 0.45,
  ragMaxTokens: 1000
}
```

### Cenário 3: Taxa de Falha Baixa (< 15%)

```javascript
// Configuração conservadora (melhor qualidade)
{
  ragTopK: 5,
  ragMinConfidence: 0.5,
  minScore: 0.5,
  ragMaxTokens: 1000
}
```

## 📝 Checklist de Implementação

### Fase 1: Diagnóstico
- [ ] Executar `npm run analyze:rag-logs` nos logs recentes
- [ ] Identificar principais causas de falha
- [ ] Listar queries que falham consistentemente

### Fase 2: Ajustes Rápidos
- [ ] Reduzir `minScore` se muitas falhas por falta de chunks
- [ ] Aumentar `topK` se poucos chunks encontrados
- [ ] Ajustar `ragMinConfidence` se muitas rejeições por confiança baixa

### Fase 3: Melhorias de Conteúdo
- [ ] Revisar documentos indexados
- [ ] Adicionar sinônimos e variações
- [ ] Melhorar descrições e exemplos

### Fase 4: Otimizações Avançadas
- [ ] Implementar fallback inteligente
- [ ] Melhorar processamento de queries
- [ ] Ajustar estratégia de chunking

### Fase 5: Monitoramento
- [ ] Estabelecer baseline de métricas
- [ ] Monitorar taxa de falha semanalmente
- [ ] Ajustar baseado em tendências

## 🎯 Meta de Performance

**Objetivo**: Taxa de sucesso ≥ 85%

**Indicadores**:
- Taxa de sucesso: ≥ 85%
- Confiança média: ≥ 0.7
- Chunks médios encontrados: ≥ 4

**Como medir**:
```bash
npm run analyze:rag-logs < logs.txt | grep "Taxa de sucesso"
```

## ⚠️ Avisos Importantes

1. **Não reduza `minScore` abaixo de 0.3**: Pode trazer muito ruído
2. **Não aumente `topK` acima de 10**: Pode degradar performance
3. **Monitore confiança média**: Se cair muito, você está aceitando chunks ruins
4. **Teste incrementalmente**: Faça uma mudança por vez e meça o impacto

## 📚 Recursos Adicionais

- [Documentação RAG](./RAG_PARA_DEV.md)
- [Como Testar RAG](./COMO_TESTAR_RAG.md)
- Script de análise: `scripts/analyze-rag-logs.js`

## 🔄 Processo de Otimização Contínua

1. **Medir**: Use `analyze-rag-logs.js` regularmente
2. **Identificar**: Encontre padrões de falha
3. **Ajustar**: Implemente uma estratégia por vez
4. **Validar**: Meça o impacto da mudança
5. **Iterar**: Repita o processo

---

**Última atualização**: 2026-01-05
**Versão**: 1.0

