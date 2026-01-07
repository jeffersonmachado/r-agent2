# Otimizações RAG Aplicadas

Este documento descreve as otimizações implementadas para reduzir a taxa de falha do RAG.

**Data**: 2026-01-05  
**Versão**: 1.0

## 📋 Resumo das Mudanças

### 1. ✅ Fallback Inteligente no Serviço RAG

**Arquivo**: `rag-service/api/routes/query.py`

**Mudança**: Implementado fallback automático que tenta buscar chunks com `minScore` reduzido (20% menor, mínimo 0.3) quando nenhum chunk é encontrado com o score original.

**Benefício**: Reduz falhas por "nenhum chunk encontrado" sem comprometer qualidade quando chunks relevantes existem.

**Código**:
```python
# FALLBACK INTELIGENTE: Se não encontrou chunks, tenta com minScore reduzido
if not chunks and min_score > 0.3:
    fallback_min_score = max(0.3, min_score * 0.8)
    # Busca novamente com score reduzido
    fallback_chunks = vector_store.search(...)
    if fallback_chunks:
        chunks = fallback_chunks
```

### 2. ✅ Ajuste de Thresholds Padrão

**Arquivos modificados**:
- `rag-service/config/settings.py`
- `engine/nodes/aiNode.js`
- `api/services/ragService.js`
- `api/server.js`

**Mudanças**:
- `default_top_k`: 5 → **6** (melhor cobertura)
- `default_min_score`: 0.5 → **0.45** (mais chunks relevantes)
- `ragMinConfidence`: 0.5 → **0.45** (melhor taxa de sucesso)

**Benefício**: Aumenta taxa de sucesso sem comprometer significativamente a qualidade.

### 3. ✅ Sistema de Monitoramento em Tempo Real

**Arquivo**: `scripts/monitor-rag-performance.js`

**Funcionalidades**:
- Monitora últimas 100 consultas em tempo real
- Calcula métricas: taxa de sucesso, confiança média, chunks médios
- Alertas automáticos quando métricas ficam abaixo dos thresholds
- Tendências e análise de performance

**Uso**:
```bash
npm run monitor:rag
# ou
tail -f api/logs/app.log | npm run monitor:rag
```

### 4. ✅ Scripts de Análise e Otimização

**Scripts criados**:
1. `analyze-rag-logs.js` - Análise detalhada de logs
2. `optimize-rag-thresholds.js` - Sugere configurações otimizadas
3. `monitor-rag-performance.js` - Monitoramento em tempo real

## 📊 Impacto Esperado

### Antes das Otimizações
- Taxa de sucesso: ~72-75%
- Confiança média: ~0.57-0.63
- Falhas por falta de chunks: ~33%

### Depois das Otimizações (Estimado)
- Taxa de sucesso: **~80-85%** ⬆️
- Confiança média: **~0.60-0.65** ⬆️
- Falhas por falta de chunks: **~15-20%** ⬇️

## 🔧 Configurações Aplicadas

### Serviço RAG (Python)
```python
default_top_k: int = 6
default_min_score: float = 0.45
```

### Engine Node.js
```javascript
ragMinConfidence: 0.45
ragTopK: 6
```

### API Node.js
```javascript
topK: 6
minScore: 0.45
```

## 📝 Como Usar

### 1. Análise de Logs
```bash
npm run analyze:rag-logs < logs.txt
```

### 2. Otimização de Thresholds
```bash
npm run optimize:rag-thresholds < logs.txt
```

### 3. Monitoramento em Tempo Real
```bash
npm run monitor:rag
```

## ⚠️ Observações Importantes

1. **Teste em Desenvolvimento**: As mudanças foram aplicadas com valores conservadores. Teste antes de produção.

2. **Monitoramento Contínuo**: Use o script de monitoramento para acompanhar o impacto das mudanças.

3. **Ajuste Incremental**: Se a taxa de sucesso ainda estiver baixa, considere:
   - Reduzir `minScore` para 0.4 (não abaixo de 0.3)
   - Aumentar `topK` para 7-8 (não acima de 10)
   - Melhorar qualidade dos documentos indexados

4. **Qualidade vs Quantidade**: Se a confiança média cair muito (< 0.5), pode ser necessário:
   - Reverter algumas mudanças
   - Melhorar conteúdo dos documentos
   - Ajustar estratégia de chunking

## 🔄 Próximos Passos

1. **Monitorar por 1 semana** as métricas de performance
2. **Coletar feedback** dos usuários sobre qualidade das respostas
3. **Ajustar incrementalmente** baseado em dados reais
4. **Melhorar documentos** indexados se necessário

## 📚 Documentação Relacionada

- [Como Diminuir Taxa de Falha](./COMO_DIMINUIR_TAXA_FALHA_RAG.md)
- [RAG para Desenvolvimento](./RAG_PARA_DEV.md)
- [Como Testar RAG](./COMO_TESTAR_RAG.md)

---

**Última atualização**: 2026-01-05

