# Como Melhorar a Acurácia do RAG

Este guia apresenta estratégias práticas e acionáveis para melhorar a acurácia das respostas do sistema RAG na página `/rag-documents`.

## 📊 Fatores que Afetam a Acurácia

### 1. **Configurações de Busca**
- `minScore`: Threshold mínimo de similaridade (atualmente 0.45)
- `topK`: Número de chunks a buscar (atualmente 6)
- `maxTokens`: Limite de tokens na resposta (atualmente 1000)

### 2. **Estratégia de Chunking**
- `chunk_strategy`: Método de divisão (sentence, paragraph, fixed_size)
- `chunk_size`: Tamanho do chunk (atualmente 500 caracteres)
- `chunk_overlap`: Sobreposição entre chunks (atualmente 50 caracteres)

### 3. **Modelo de Embedding**
- Modelo atual: `sentence-transformers/all-MiniLM-L6-v2` (384 dimensões)
- Pode ser melhorado com modelos mais avançados

### 4. **Qualidade dos Documentos**
- Completude e clareza do conteúdo
- Presença de termos-chave e sinônimos
- Estrutura e organização

### 5. **Processamento de Queries**
- Expansão de queries com NLP
- Melhoria de queries para RAG
- Validação e normalização

## 🎯 Estratégias para Melhorar Acurácia

### Estratégia 1: Otimizar Configurações de Busca

#### 1.1 Ajustar `minScore` Baseado em Análise

**Como fazer**:
1. Use a funcionalidade "Analisar Documentos" na página `/rag-documents`
2. Observe a taxa de sucesso e a confiança média
3. Ajuste `minScore` incrementalmente:

```json
// api/data/config.json
{
  "rag": {
    "service": {
      "defaults": {
        "topK": 6,
        "minScore": 0.40  // Reduzido de 0.45 para capturar mais chunks relevantes
      }
    }
  }
}
```

**Recomendações**:
- Se taxa de sucesso < 70%: Reduza para 0.40
- Se taxa de sucesso 70-85%: Mantenha 0.45
- Se taxa de sucesso > 85%: Aumente para 0.50 (melhor qualidade)

#### 1.2 Aumentar `topK` para Melhor Cobertura

**Quando usar**: Se poucos chunks são encontrados ou documentos relevantes não aparecem

```json
{
  "rag": {
    "service": {
      "defaults": {
        "topK": 8,  // Aumentado de 6 para 8
        "minScore": 0.45
      }
    }
  }
}
```

**Benefício**: Mais chunks candidatos = maior chance de encontrar informação relevante

**⚠️ Atenção**: Não aumente acima de 10 para evitar degradação de performance

### Estratégia 2: Melhorar Estratégia de Chunking

#### 2.1 Escolher Estratégia Adequada

**Arquivo**: `api/data/config.json`

```json
{
  "rag": {
    "service": {
      "chunking": {
        "strategy": "sentence",  // Melhor para documentos técnicos
        "size": 500,
        "overlap": 100  // Aumentado de 50 para 100 para melhor contexto
      }
    }
  }
}
```

**Recomendações por tipo de documento**:
- **Documentos técnicos/manuais**: Use `"sentence"` (preserva contexto)
- **Documentos narrativos**: Use `"paragraph"` (preserva fluxo)
- **Documentos estruturados**: Use `"fixed_size"` (consistência)

#### 2.2 Ajustar Tamanho e Overlap

**Para melhor contexto**:
```json
{
  "chunking": {
    "size": 600,      // Aumentado de 500 para 600
    "overlap": 100,   // Aumentado de 50 para 100
    "strategy": "sentence"
  }
}
```

**Para mais precisão**:
```json
{
  "chunking": {
    "size": 400,      // Reduzido para chunks mais focados
    "overlap": 80,    // Overlap proporcional
    "strategy": "sentence"
  }
}
```

**⚠️ Trade-offs**:
- Chunks maiores = mais contexto, mas podem incluir informação irrelevante
- Chunks menores = mais precisos, mas podem perder contexto
- Overlap maior = melhor continuidade, mas mais chunks duplicados

### Estratégia 3: Melhorar Modelo de Embedding

#### 3.1 Usar Modelo Mais Avançado

**Arquivo**: `api/data/config.json`

```json
{
  "rag": {
    "service": {
      "embedding": {
        "model": "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
        "dimension": 384
      }
    }
  }
}
```

**Modelos recomendados** (em ordem de qualidade/custo):
1. `paraphrase-multilingual-MiniLM-L12-v2` - Melhor para português
2. `all-mpnet-base-v2` - Melhor qualidade geral (768 dimensões)
3. `all-MiniLM-L6-v2` - Atual (mais rápido, menor qualidade)

**⚠️ Nota**: Modelos maiores requerem mais memória e são mais lentos

#### 3.2 Reindexar Documentos Após Mudança

Após mudar o modelo de embedding, **reindexe todos os documentos**:
1. Na página `/rag-documents`, clique em "🔄 Reindexar Todos"
2. Ou reindexe individualmente cada documento

### Estratégia 4: Melhorar Qualidade dos Documentos

#### 4.1 Checklist de Qualidade

Antes de indexar, verifique:
- [ ] Documento é descritivo e completo?
- [ ] Termos-chave importantes estão presentes?
- [ ] Sinônimos e variações estão incluídos?
- [ ] Exemplos práticos estão documentados?
- [ ] Título é descritivo e específico?

#### 4.2 Exemplo de Melhoria

**❌ Ruim**:
```
Título: "Planos"
Conteúdo: "Planos disponíveis."
```

**✅ Bom**:
```
Título: "Planos de Assinatura Disponíveis"
Conteúdo: "Nossos planos incluem: Plano Básico (R$ 29,90/mês) com recursos básicos, Plano Premium (R$ 59,90/mês) com recursos avançados e Plano Empresarial (R$ 149,90/mês) com recursos completos. Cada plano oferece diferentes recursos e limites de uso. Também conhecidos como pacotes ou planos de assinatura."
```

**Melhorias aplicadas**:
- Título mais descritivo
- Conteúdo completo com detalhes
- Inclusão de sinônimos ("pacotes", "planos de assinatura")
- Informações específicas (preços, recursos)

### Estratégia 5: Otimizar Processamento de Queries

#### 5.1 Melhorar Expansão de Queries

O sistema já faz expansão via NLP, mas você pode melhorar adicionando sinônimos específicos do domínio.

**Arquivo**: `rag-service/services/nlp_service.py`

Adicione sinônimos comuns do seu domínio:
```python
DOMAIN_SYNONYMS = {
    "planos": ["planos", "pacotes", "planos de assinatura", "planos disponíveis"],
    "pagamento": ["pagamento", "pagar", "forma de pagamento", "método de pagamento", "como pagar"],
    "suporte": ["suporte", "ajuda", "atendimento", "assistência", "contato"],
    # Adicione mais conforme necessário
}
```

#### 5.2 Melhorar Prompt do LLM

**Arquivo**: `rag-service/api/routes/query.py` (função `build_rag_prompt`)

**Prompt atual** já é bom, mas pode ser melhorado:

```python
def build_rag_prompt(query: str, chunks: list) -> str:
    context_parts = []
    for i, chunk in enumerate(chunks, 1):
        # Adiciona score de relevância ao contexto
        score_str = f" (Relevância: {chunk.score:.2f})" if chunk.score else ""
        context_parts.append(f"[Fonte {i}{score_str}]\n{chunk.content}")
    
    context = "\n\n".join(context_parts)
    
    prompt = f"""Você é um assistente especializado em atendimento ao cliente, prestativo e informativo.

Contexto relevante extraído da base de conhecimento (ordenado por relevância):
{context}

Pergunta do usuário: {query}

Instruções:
- Analise cuidadosamente o contexto fornecido e responda baseado nele
- Priorize informações das fontes com maior relevância (score mais alto)
- Se encontrar informação relevante no contexto, forneça uma resposta útil e completa
- Use as informações das fontes para construir uma resposta coerente e bem estruturada
- Se o contexto contém informação parcial mas útil, forneça o que puder e mencione que pode haver mais detalhes disponíveis
- Apenas se o contexto realmente não contiver NENHUMA informação relevante sobre a pergunta, então diga: "Não tenho informação suficiente sobre isso. Posso transferir você para um atendente humano?"
- Seja claro, objetivo, amigável e prestativo
- Cite as fontes quando relevante (ex: "De acordo com a Fonte 1...")
- Evite respostas genéricas quando houver informação útil no contexto
- Se houver múltiplas fontes, combine as informações de forma coerente
"""
    
    return prompt
```

### Estratégia 6: Implementar Reranking (Opcional - Avançado)

Reranking melhora a ordem dos chunks retornados usando um modelo mais sofisticado.

**Implementação básica**:
1. Busca inicial com embedding (como atualmente)
2. Reranking dos top-K chunks com modelo de reranking
3. Seleção dos melhores chunks após reranking

**Modelos de reranking recomendados**:
- `cross-encoder/ms-marco-MiniLM-L-6-v2` (rápido)
- `cross-encoder/ms-marco-MiniLM-L-12-v2` (melhor qualidade)

### Estratégia 7: Monitoramento e Ajuste Contínuo

#### 7.1 Usar Análise de Documentos

1. Na página `/rag-documents`, clique em "📊 Analisar Documentos"
2. Observe:
   - Taxa de sucesso geral
   - Taxa de sucesso por documento
   - Confiança média
   - Perguntas que falham consistentemente

#### 7.2 Métricas a Monitorar

- **Taxa de sucesso**: % de perguntas que geram respostas
- **Confiança média**: Score médio de confiança
- **Chunks encontrados**: Número médio de chunks por query
- **Documento encontrado**: % de vezes que o documento correto é encontrado

#### 7.3 Ajustar Baseado em Métricas

**Se taxa de sucesso < 70%**:
1. Reduza `minScore` para 0.40
2. Aumente `topK` para 8
3. Revise qualidade dos documentos
4. Considere melhorar modelo de embedding

**Se taxa de sucesso 70-85%**:
1. Mantenha configurações atuais
2. Foque em melhorar qualidade dos documentos
3. Ajuste estratégia de chunking se necessário

**Se taxa de sucesso > 85%**:
1. Foque em melhorar confiança média
2. Considere aumentar `minScore` para 0.50
3. Otimize prompt do LLM

## 🔧 Configurações Recomendadas por Cenário

### Cenário 1: Alta Taxa de Falha (> 30%)

```json
{
  "rag": {
    "service": {
      "defaults": {
        "topK": 8,
        "minScore": 0.40
      },
      "chunking": {
        "strategy": "sentence",
        "size": 500,
        "overlap": 100
      }
    }
  }
}
```

### Cenário 2: Taxa de Sucesso Média (70-85%)

```json
{
  "rag": {
    "service": {
      "defaults": {
        "topK": 6,
        "minScore": 0.45
      },
      "chunking": {
        "strategy": "sentence",
        "size": 500,
        "overlap": 75
      }
    }
  }
}
```

### Cenário 3: Alta Taxa de Sucesso (> 85%) - Foco em Qualidade

```json
{
  "rag": {
    "service": {
      "defaults": {
        "topK": 5,
        "minScore": 0.50
      },
      "chunking": {
        "strategy": "sentence",
        "size": 400,
        "overlap": 60
      }
    }
  }
}
```

## 📝 Checklist de Implementação

### Fase 1: Diagnóstico (1-2 horas)
- [ ] Executar "Analisar Documentos" na página `/rag-documents`
- [ ] Identificar taxa de sucesso atual
- [ ] Listar perguntas que falham consistentemente
- [ ] Verificar confiança média

### Fase 2: Ajustes Rápidos (30 minutos)
- [ ] Ajustar `minScore` baseado em análise
- [ ] Ajustar `topK` se necessário
- [ ] Reindexar documentos se mudou configurações de chunking

### Fase 3: Melhorias de Conteúdo (2-4 horas)
- [ ] Revisar documentos indexados
- [ ] Melhorar títulos e conteúdo
- [ ] Adicionar sinônimos e variações
- [ ] Reindexar documentos melhorados

### Fase 4: Otimizações Avançadas (4-8 horas)
- [ ] Melhorar modelo de embedding (se necessário)
- [ ] Otimizar prompt do LLM
- [ ] Ajustar estratégia de chunking
- [ ] Implementar reranking (opcional)

### Fase 5: Monitoramento (Contínuo)
- [ ] Estabelecer baseline de métricas
- [ ] Monitorar taxa de sucesso semanalmente
- [ ] Ajustar baseado em tendências
- [ ] Documentar mudanças e resultados

## 🎯 Meta de Performance

**Objetivo**: Taxa de sucesso ≥ 85% com confiança média ≥ 0.70

**Indicadores**:
- Taxa de sucesso: ≥ 85%
- Confiança média: ≥ 0.70
- Chunks médios encontrados: ≥ 4
- Documento correto encontrado: ≥ 80% das vezes

**Como medir**:
1. Use a funcionalidade "Analisar Documentos" na página `/rag-documents`
2. Observe as métricas no resumo da análise
3. Compare com baseline anterior

## ⚠️ Avisos Importantes

1. **Não reduza `minScore` abaixo de 0.3**: Pode trazer muito ruído
2. **Não aumente `topK` acima de 10**: Pode degradar performance
3. **Monitore confiança média**: Se cair muito, você está aceitando chunks ruins
4. **Teste incrementalmente**: Faça uma mudança por vez e meça o impacto
5. **Reindexe após mudanças**: Mudanças em chunking ou embedding requerem reindexação

## 🔄 Processo de Otimização Contínua

1. **Medir**: Use "Analisar Documentos" regularmente
2. **Identificar**: Encontre padrões de falha e baixa confiança
3. **Ajustar**: Implemente uma estratégia por vez
4. **Validar**: Meça o impacto da mudança
5. **Iterar**: Repita o processo

## 📚 Recursos Adicionais

- [Como Diminuir Taxa de Falha RAG](./COMO_DIMINUIR_TAXA_FALHA_RAG.md)
- [Como Testar RAG](./COMO_TESTAR_RAG.md)
- [Configuração RAG Centralizada](./CONFIGURACAO_RAG_CENTRALIZADA.md)
- [RAG para Desenvolvedores](./RAG_PARA_DEV.md)

---

**Última atualização**: 2026-01-05
**Versão**: 1.0

