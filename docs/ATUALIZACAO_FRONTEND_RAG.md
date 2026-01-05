# Atualização do Frontend - Configurações RAG

## 📋 Resumo

O frontend foi atualizado para usar as novas configurações RAG otimizadas que foram aplicadas no backend.

## 🔄 Mudanças Aplicadas

### 1. Valores Padrão Atualizados

**Arquivo**: `frontend/src/api/ragDocuments.js`

**Antes**:
```javascript
options: {
  topK: options.topK || 5,
  minScore: options.minScore || 0.5,
  maxTokens: options.maxTokens || 1000,
}
```

**Depois**:
```javascript
options: {
  topK: options.topK || 6,  // Aumentado de 5 para 6 para melhor cobertura
  minScore: options.minScore || 0.45,  // Reduzido de 0.5 para 0.45 para melhor taxa de sucesso
  maxTokens: options.maxTokens || 1000,
}
```

### 2. Análise de Documentos Atualizada

**Arquivo**: `frontend/src/pages/RAGDocumentsPage.jsx`

**Antes**:
```javascript
let result = await queryRag(question, tenantId, { topK: 5, minScore: 0.3, maxTokens: 1000 });
if (!result.success || !result.sources || result.sources.length === 0) {
  result = await queryRag(question, tenantId, { topK: 5, minScore: 0.5, maxTokens: 1000 });
}
```

**Depois**:
```javascript
let result = await queryRag(question, tenantId, { topK: 6, minScore: 0.3, maxTokens: 1000 });
if (!result.success || !result.sources || result.sources.length === 0) {
  result = await queryRag(question, tenantId, { topK: 6, minScore: 0.45, maxTokens: 1000 });
}
```

## 📊 Impacto

### Melhorias Esperadas

1. **Maior Taxa de Sucesso**
   - `topK` aumentado de 5 para 6 → mais chunks candidatos
   - `minScore` reduzido de 0.5 para 0.45 → mais chunks relevantes capturados

2. **Consistência**
   - Frontend e backend agora usam os mesmos valores padrão
   - Configurações centralizadas no `config.json`

3. **Melhor Cobertura**
   - Análise de documentos mais eficaz
   - Menos falsos negativos

## ✅ Compatibilidade

- **Retrocompatibilidade**: Código existente que passa `topK` ou `minScore` explicitamente continua funcionando
- **Fallback**: Valores antigos ainda funcionam se especificados manualmente
- **API**: Nenhuma mudança na interface da API

## 🔍 Verificação

Para verificar se as mudanças foram aplicadas:

1. **Verificar valores padrão**:
   ```javascript
   // frontend/src/api/ragDocuments.js
   // Deve mostrar: topK: 6, minScore: 0.45
   ```

2. **Testar consultas RAG**:
   - Fazer uma consulta sem especificar opções
   - Verificar que usa `topK: 6` e `minScore: 0.45` por padrão

3. **Análise de documentos**:
   - Executar análise de documentos na página RAG
   - Verificar que usa os novos valores

## 📝 Notas

- As mudanças são **transparentes** para o usuário final
- **Performance**: Ligeiro aumento no tempo de busca (mais chunks), mas compensado pela maior taxa de sucesso
- **Qualidade**: Confiança média pode diminuir ligeiramente, mas taxa de sucesso aumenta significativamente

## 🔗 Relacionado

- [Otimizações RAG Aplicadas](./OTIMIZACOES_RAG_APLICADAS.md)
- [Configuração RAG Centralizada](./CONFIGURACAO_RAG_CENTRALIZADA.md)
- [Como Diminuir Taxa de Falha](./COMO_DIMINUIR_TAXA_FALHA_RAG.md)

---

**Última atualização**: 2026-01-05

