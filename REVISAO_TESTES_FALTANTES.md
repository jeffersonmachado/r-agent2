# Revisão dos Testes Faltantes

**Data:** 2026-01-04  
**Status:** Análise completa dos testes faltantes ou pulados

---

## 📊 RESUMO EXECUTIVO

### Testes Executando
- ✅ **Backend (Jest)**: 521 testes passando
- ✅ **Frontend (Vitest)**: 71 testes passando
- ✅ **RPA**: 2 testes passando

### Testes Faltantes/Pulados
- ⚠️ **Frontend**: 1 teste pulado (intencional)
- ⚠️ **RAG Service**: Todos os testes pulados (dependências faltando)

---

## 🔍 DETALHAMENTO DOS TESTES FALTANTES

### 1. FRONTEND - Teste Pulado

#### 1.1 FlowEditorPage.test.jsx
**Arquivo:** `frontend/src/pages/FlowEditorPage.test.jsx`  
**Linha:** 221  
**Status:** `it.skip()` - Pulado intencionalmente

**Motivo:**
```javascript
// TODO: Este teste está travando devido a loops infinitos nos useEffects do FlowEditorPage
// O componente tem muitos useEffects que interagem entre si e causam loops no ambiente de teste
// Será necessário refatorar o componente ou criar mocks mais específicos para os useEffects
it.skip('renderiza o componente sem erros', async () => {
```

**Problema:**
- Loops infinitos nos `useEffect` do componente `FlowEditorPage`
- Múltiplos `useEffect` interagindo entre si
- Ambiente de teste não consegue estabilizar o componente

**Solução Necessária:**
1. Refatorar o componente `FlowEditorPage` para reduzir dependências entre `useEffect`
2. Criar mocks mais específicos para os `useEffect`
3. Usar `useEffect` com dependências mais controladas
4. Considerar usar `useMemo` e `useCallback` para estabilizar referências

---

### 2. RAG SERVICE - Todos os Testes Pulados

#### 2.1 Dependências Faltando
**Status:** Não executando devido a dependências não instaladas

**Erro:**
```
ModuleNotFoundError: No module named 'sentence_transformers'
```

**Dependências Necessárias:**
- `sentence-transformers==2.2.2` (principal faltando)
- Possivelmente outras dependências transitivas

**Espaço Necessário:**
- Mínimo: 1.5GB
- Máximo: 3.0GB
- Disponível: 1.6GB
- **Falta: 0-1.4GB** (dependendo do modelo baixado)

**Testes que Deveriam Executar:**
1. `test_health.py` - 2 testes
   - `test_health_check()` - Verifica status healthy
   - `test_health_check_structure()` - Verifica estrutura da resposta

2. `test_index.py` - Múltiplos testes
   - `test_index_document_success()` - Indexação bem-sucedida
   - Outros testes de indexação

3. `test_query.py` - Múltiplos testes
   - `test_query_success()` - Consulta bem-sucedida
   - Outros testes de query

**Solução Necessária:**
1. Liberar espaço em disco (pelo menos 2-3GB recomendado)
2. Instalar dependências: `pip install -r requirements.txt`
3. Executar testes: `pytest`

---

## 📋 COMPONENTES/PÁGINAS SEM TESTES

### Frontend - Páginas Sem Testes

O frontend tem **28 páginas**, mas apenas **2 têm testes**:

#### Páginas COM Testes:
1. ✅ `FlowEditorPage.test.jsx` (1 teste pulado)
2. ❌ `SimulationDebuggerPage.test.jsx` (removido - funcionalidade integrada no FlowEditorPage)

#### Páginas SEM Testes (26 páginas):
1. ❌ `AgentsPage.jsx`
2. ❌ `AiChatbotGenerationPage.jsx` (removido - funcionalidade no GenerateSystemPage)
3. ❌ `AiRpaGenerationPage.jsx` (removido - funcionalidade no GenerateSystemPage)
4. ❌ `AIToolsPage.jsx`
5. ❌ `AnalyticsPage.jsx`
6. ❌ `AuditPage.jsx`
7. ❌ `BulkMessagingPage.jsx`
8. ❌ `ChatPage.jsx`
9. ❌ `ConfigPage.jsx`
10. ❌ `DashboardPage.jsx`
11. ❌ `DepartmentsPage.jsx`
12. ❌ `ExportPage.jsx`
13. ❌ `FlowEditorModelPage.jsx` (removido - protótipo não utilizado)
14. ❌ `GenerateSystemPage.jsx`
16. ❌ `KnowledgeBasePage.jsx`
17. ❌ `ProductDocsPage.jsx`
18. ❌ `QaPage.jsx`
19. ❌ `QuickRepliesPage.jsx`
20. ❌ `RAGDocumentsPage.jsx`
21. ❌ `RpaTestPage.jsx`
22. ❌ `SegmentationPage.jsx`
23. ❌ `SupportPage.jsx`
24. ❌ `TicketMaintenancePage.jsx`
25. ❌ `WebScrapingPage.jsx`
26. ❌ `WhatsAppTemplatesPage.jsx`

**Cobertura de Testes do Frontend:**
- Páginas testadas: 2/28 (7%)
- Componentes testados: 11 arquivos de teste
- Cobertura geral: Baixa para páginas, média para componentes

---

## 🎯 PRIORIDADES DE CORREÇÃO

### Prioridade ALTA
1. **RAG Service** - Instalar dependências
   - Impacto: Todos os testes do RAG Service não executam
   - Esforço: Médio (requer espaço em disco)
   - Benefício: Alta (testes críticos de funcionalidade RAG)

### Prioridade MÉDIA
2. **FlowEditorPage.test.jsx** - Corrigir teste pulado
   - Impacto: 1 teste não executa
   - Esforço: Alto (requer refatoração)
   - Benefício: Médio (teste importante mas não crítico)

### Prioridade BAIXA
3. **Páginas sem testes** - Criar testes para páginas críticas
   - Impacto: Baixa cobertura de testes
   - Esforço: Muito Alto (26 páginas)
   - Benefício: Alto (melhora qualidade geral)

---

## 📝 RECOMENDAÇÕES

### Imediatas
1. Liberar espaço em disco para instalar dependências do RAG Service
2. Documentar o teste pulado do FlowEditorPage como conhecido

### Curto Prazo
1. Refatorar `FlowEditorPage` para corrigir loops infinitos
2. Criar testes para páginas mais críticas (ex: `RpaTestPage`, `GenerateSystemPage`)

### Longo Prazo
1. Aumentar cobertura de testes do frontend
2. Implementar testes E2E para fluxos críticos
3. Adicionar testes de integração para RAG Service

---

## ✅ CONCLUSÃO

**Testes Principais:** ✅ Funcionando (521 + 71 + 2 = 594 testes passando)

**Testes Faltantes:**
- 1 teste do frontend (pulado intencionalmente)
- ~10-15 testes do RAG Service (não executando por falta de dependências)

**Cobertura Geral:** Boa para backend, média para frontend, ausente para RAG Service

**Próximos Passos:**
1. Resolver problema de espaço em disco
2. Instalar dependências do RAG Service
3. Refatorar FlowEditorPage para corrigir teste pulado

