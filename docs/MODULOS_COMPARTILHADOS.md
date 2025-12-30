# Módulos Compartilhados - Oportunidades de Refatoração

Este documento lista oportunidades para criar módulos compartilhados entre frontend e backend, seguindo a mesma abordagem usada em `aiTaskExecutor`.

## ✅ Módulos Compartilhados Implementados

### 1. `engine/utils/aiTaskExecutor.js` ✅
- **Status**: ✅ Implementado
- **Uso**: Backend (`engine/nodes/aiTaskNode.js`) e Frontend (`frontend/src/utils/aiExecutor.js`)
- **Benefício**: Lógica de execução de tarefas de IA centralizada
- **Exporta**: `executeAiTask`, `validateResponse`, `SUPPORTED_TASKS`, funções específicas de cada tarefa

### 2. `engine/utils/typeCompatibility.js` ✅
- **Status**: ✅ Implementado
- **Uso**: Backend (`engine/validator.js`, `engine/typeCompatibility.js`) e Frontend (`frontend/src/shared/typeCompatibility.ts`, `frontend/src/editor/validation/preventiveValidation.ts`)
- **Benefício**: Elimina necessidade de sincronização manual entre frontend e backend
- **Exporta**: `TYPE_COMPATIBILITY`

### 3. `engine/utils/templateRenderer.js` ✅
- **Status**: ✅ Implementado
- **Uso**: 
  - Backend: `engine/nodes/basicNodes.js`, `engine/nodes/aiNode.js`
  - Frontend: `frontend/src/hooks/useFlowRunner.js`
- **Benefício**: Código único para renderização de templates `{{variavel}}`
- **Exporta**: `renderTemplate`

### 4. `engine/utils/jsonSchemaValidator.js` ✅
- **Status**: ✅ Implementado
- **Uso**: Backend (`engine/nodes/aiNode.js`)
- **Benefício**: Reutilização em outros contextos que precisem validar JSON Schema
- **Exporta**: `validateJsonSchema`

### 5. **SUPPORTED_TASKS** ✅
- **Status**: ✅ Refatorado
- **Uso**: Todos os arquivos agora importam de `@shared/aiTaskExecutor` ou `engine/utils/aiTaskExecutor`
- **Arquivos atualizados**:
  - `engine/validator.js` ✅
  - `frontend/src/editor/nodeSchemas.js` ✅
  - `frontend/src/utils/validateAiTask.js` ✅
- **Benefício**: Fonte única de verdade para tarefas suportadas

### 5. **Validação de Estrutura de Fluxo** (Baixa Prioridade)
- **Status**: ⚠️ Lógica similar em frontend e backend
- **Arquivos**:
  - Backend: `engine/validator.js` (validação completa)
  - Frontend: `frontend/src/utils/validateAiTask.js` (validação parcial)
- **Problema**: Frontend tem validação parcial que pode divergir
- **Solução**: Frontend deve sempre chamar API de validação do backend
- **Nota**: Conforme PROJECT_RULES.md, validação frontend é apenas para UX

---

## ✅ Status de Implementação

### Todas as Oportunidades Implementadas ✅

1. ✅ `aiTaskExecutor` - **IMPLEMENTADO**
2. ✅ `typeCompatibility` - **IMPLEMENTADO**
3. ✅ `renderTemplate` - **IMPLEMENTADO**
4. ✅ `SUPPORTED_TASKS` - **REFATORADO** (todos usam `aiTaskExecutor`)
5. ✅ `validateJsonSchema` - **IMPLEMENTADO**
6. ⚠️ Validação de Fluxo - Mantido como está (backend é fonte única, conforme PROJECT_RULES.md)

---

## 🛠️ Padrão de Implementação

Para cada módulo compartilhado, seguir o padrão:

1. **Criar módulo em `engine/utils/`** com exportação dual:
   ```javascript
   // Exportação CommonJS (backend)
   if (typeof module !== 'undefined' && module.exports) {
     module.exports = { ... };
   }
   
   // Exportação ES modules (frontend)
   export { ... };
   ```

2. **Configurar alias no Vite** (`frontend/vite.config.mjs`):
   ```javascript
   resolve: {
     alias: {
       '@shared/moduleName': join(__dirname, '..', 'engine', 'utils', 'moduleName.js'),
     },
   },
   ```

3. **Atualizar imports**:
   - Backend: `const { ... } = require('../utils/moduleName');`
   - Frontend: `import { ... } from '@shared/moduleName';`

4. **Remover código duplicado** dos arquivos originais

---

## 📊 Benefícios Esperados

- ✅ **Redução de duplicação**: Menos código para manter
- ✅ **Consistência**: Mesma lógica em frontend e backend
- ✅ **Manutenibilidade**: Mudanças em um único lugar
- ✅ **Testabilidade**: Testes centralizados
- ✅ **Menos bugs**: Menos chance de divergência entre camadas

