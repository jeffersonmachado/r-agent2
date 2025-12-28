# PROJECT_RULES - Regras e Princípios do Projeto

## 📌 Terminologia Oficial

Para evitar ambiguidades, os termos abaixo são equivalentes neste projeto:

- **Engine = Core do sistema**
  - Onde reside toda a lógica de negócio
  - Execução e validação determinística

- **Frontend = UI**
  - Camada visual e de interação
  - Nunca contém lógica de negócio

- **API = Interface HTTP**
  - Camada de transporte
  - Apenas delega chamadas para a Engine

---

## 📐 Arquitetura

### Camadas do Sistema

```
┌─────────────────────────────────────────┐
│         FRONTEND (UI Layer)             │
│  - React Components                     │
│  - Rete.js Editor                       │
│  - Visualização e Interação             │
│  - Validação visual (UX apenas)         │
└──────────────┬──────────────────────────┘
               │ HTTP/REST
┌──────────────▼──────────────────────────┐
│         API (Interface Layer)            │
│  - server.js                            │
│  - Endpoints REST                       │
│  - Serialização/Deserialização          │
│  - Sem lógica de negócio                │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│         ENGINE (Business Logic)          │
│  - validator.js (validações estáticas)  │
│  - compileFlow.js (compilação)           │
│  - executeStep.js (execução)             │
│  - runner.js (orquestração)              │
│  - Sem dependências de UI ou API         │
└─────────────────────────────────────────┘
```

### Princípios de Separação

1. **Frontend (UI):**
   - Apenas renderização e interação
   - Validação visual para UX (não substitui validação da engine)
   - Transformação de formatos (Rete JSON ↔ Engine Flow)

2. **API:**
   - Apenas interface HTTP
   - Serialização/Deserialização
   - Delegação para engine
   - Sem lógica de negócio

3. **Engine (Core):**
   - Toda lógica de negócio
   - Validações estáticas
   - Execução determinística
   - Para a mesma entrada, a Engine deve sempre produzir o mesmo resultado,
     independentemente de ambiente, frontend ou momento de execução
   - Sem dependências de UI ou API

---

## 🎯 Princípio de Centralização

### Objetivo: Simplificar Manutenção

**Regra Fundamental:** ✅ **Centralizar o máximo possível para simplificar a manutenção**

### Princípios de Centralização

1. **Single Source of Truth (Fonte Única da Verdade)**
   - Cada regra de negócio deve existir em **um único lugar**
   - Evitar duplicação de lógica entre camadas
   - Quando necessário compartilhar código, usar módulos compartilhados

2. **Centralização de Lógica de Negócio**
   - ✅ **Toda lógica de negócio na Engine**
   - ✅ **Mensagens de erro centralizadas no backend** (engine/validator.js)
   - ✅ **Regras de compatibilidade centralizadas** (engine/typeCompatibility.js)
   - ❌ **NUNCA duplicar lógica de validação no frontend**

3. **Centralização de Mensagens**
   - ✅ **Backend envia mensagens técnicas e amigáveis**
   - ✅ **Frontend apenas exibe o que recebe do backend**
   - ❌ **NUNCA mapear ou transformar mensagens no frontend**
   - ❌ **NUNCA criar mensagens de erro no frontend**

4. **Centralização de Regras**
   - ✅ **Regras de compatibilidade de tipos em módulo compartilhado**
   - ✅ **Validações de estrutura na Engine**
   - ✅ **Mensagens de erro com código, mensagem técnica e mensagem amigável no backend**
   - ❌ **NUNCA duplicar regras de compatibilidade no frontend**

5. **Módulos Compartilhados**
   - Quando duplicação é necessária (ex: compatibilidade de tipos), usar módulos compartilhados
   - Backend: `engine/typeCompatibility.js` (CommonJS)
   - Frontend: `frontend/src/shared/typeCompatibility.ts` (TypeScript/ES module)
   - **Manter sincronizados manualmente** ou via script de build

### Exemplos de Centralização

#### ✅ CORRETO: Mensagens Centralizadas no Backend

```javascript
// engine/validator.js
function addUiMessage(error) {
  return {
    ...error,
    messageUi: getUiMessage(error.code, error.nodeIds?.length),
    severity: 'error'
  };
}
```

```javascript
// api/server.js
const result = validateFlow(flow);
// Envia erros já com messageUi do backend
res.json({ valid: result.valid, errors: result.errors });
```

```jsx
// frontend/src/SidebarProperties.jsx
// Apenas exibe o que recebe do backend
{err.messageUi || err.message}
```

#### ❌ INCORRETO: Mensagens Duplicadas

```javascript
// ❌ NÃO fazer: Mapeamento no frontend
function mapValidationErrorsToUi(errors) {
  return errors.map(err => ({
    ...err,
    messageUi: getFriendlyMessage(err.code) // Duplicação!
  }));
}
```

#### ✅ CORRETO: Regras Compartilhadas

```javascript
// engine/typeCompatibility.js (CommonJS)
module.exports = {
  TYPE_COMPATIBILITY: { /* regras */ }
};
```

```typescript
// frontend/src/shared/typeCompatibility.ts (TypeScript)
export const TYPE_COMPATIBILITY = { /* mesma regra */ };
```

#### ❌ INCORRETO: Regras Duplicadas

```javascript
// ❌ NÃO fazer: Regras duplicadas em cada arquivo
// engine/validator.js
const COMPATIBILITY = { /* regras */ };

// frontend/src/editor/validation/preventiveValidation.ts
const COMPATIBILITY = { /* mesmas regras duplicadas */ };
```

### Benefícios da Centralização

1. **Manutenção Simplificada**
   - Mudanças em um único lugar
   - Menos risco de inconsistências
   - Facilita refatoração

2. **Consistência**
   - Mesmas regras em todo o sistema
   - Mensagens uniformes
   - Comportamento previsível

3. **Testabilidade**
   - Testes focados em um único ponto
   - Menos casos de teste duplicados
   - Mais fácil garantir cobertura

4. **Redução de Bugs**
   - Menos pontos de falha
   - Menos chance de divergência entre camadas
   - Mais fácil rastrear problemas

### Regras de Centralização

1. ✅ **Backend é a fonte única de verdade para:**
   - Validações de negócio
   - Mensagens de erro (técnicas e amigáveis)
   - Regras de compatibilidade
   - Lógica de execução

2. ✅ **Frontend apenas:**
   - Exibe mensagens recebidas do backend
   - Transforma formatos (Rete JSON ↔ Engine Flow)
   - Fornece feedback visual (UX)

3. ✅ **Quando duplicação é necessária:**
   - Usar módulos compartilhados
   - Manter sincronização explícita
   - Documentar dependências

4. ❌ **NUNCA:**
   - Duplicar lógica de validação
   - Criar mensagens de erro no frontend
   - Mapear mensagens no frontend
   - Duplicar regras de compatibilidade

---

## 🔒 Regras de Validação

### Validação da Engine (Obrigatória)

**Localização:** `engine/validator.js`

**Responsabilidades:**
- Validação de estrutura do fluxo
- Validação de conectividade
- Validação de tipos
- Validação de configurações

**Regra:** ✅ **NUNCA remover validações da engine**

### Validação do Frontend (Opcional - UX)

**Localização:** `frontend/src/editor/validation/runFlowValidation.ts`

**Responsabilidades:**
- Feedback visual imediato
- Validação de campos vazios para UX
- **NÃO substitui validação da engine**

**Regra:** ⚠️ Validação frontend é **complementar**, não substitutiva

---

## 🚫 Regras de Proibição

### 1. Nunca Remover Validações

❌ **PROIBIDO:**
- Remover validações da engine
- Simplificar validações complexas
- Remover regras de compatibilidade de tipos

✅ **PERMITIDO:**
- Adicionar novas validações
- Melhorar mensagens de erro
- Otimizar algoritmos de validação

---

### 2. Nunca Misturar Camadas

❌ **PROIBIDO:**
- Lógica de negócio no frontend
- Validações de negócio no frontend (exceto UX)
- Dependências da engine no frontend
- Dependências de UI na engine

✅ **PERMITIDO:**
- Transformação de formatos (mapper)
- Validação visual para UX
- Comunicação via HTTP/REST

---

### 3. Nunca Mover Lógica de Negócio para UI

❌ **PROIBIDO:**
- Validações de estrutura no frontend
- Lógica de execução no frontend
- Regras de compatibilidade no frontend

✅ **PERMITIDO:**
- Validação de campos vazios (UX)
- Feedback visual
- Transformação de formatos

---

### 4. Nunca Adicionar Efeitos Colaterais no Core

❌ **PROIBIDO:**
- Mutação de estado global na Engine/Core
- I/O direto na Engine/Core (exceto via providers explicitamente injetados)
- Dependências implícitas de ambiente (filesystem, clock, rede)

✅ **PERMITIDO:**
- Funções puras
- Transformações determinísticas
- Injeção de dependências via providers

---

### 5. Nunca Simplificar Removendo Regras

❌ **PROIBIDO:**
- Remover validações complexas
- Simplificar algoritmos de validação
- Remover regras de compatibilidade

✅ **PERMITIDO:**
- Otimizar algoritmos mantendo regras
- Refatorar mantendo comportamento
- Melhorar performance sem perder funcionalidade

---

## 📁 Estrutura de Diretórios

### Frontend (`frontend/src/`)

```
frontend/src/
├── components/
├── pages/
├── editor/
│   └── validation/
├── engine-mapper/
├── state/
├── api/
└── utils/
```

**Regra:** Frontend não contém lógica de negócio

---

### Engine (`engine/`)

```
engine/
├── validator.js
├── compileFlow.js
├── executeStep.js
├── runner.js
├── nodes/
│   ├── basicNodes.js
│   └── aiNode.js
└── utils.js
```

**Regra:** Engine não depende de UI ou API

---

### API (`api/`)

```
api/
├── server.js
└── data/
```

**Regra:** API apenas delega para engine

---

## 🔄 Fluxo de Dados

### Criação / Edição de Fluxo

```
Frontend (Rete JSON)
    ↓ (mapper)
Engine Flow Definition
    ↓ (validação)
Engine Validator
    ↓ (compilação)
Compiled Flow
    ↓ (armazenamento)
API Storage
```

### Execução de Fluxo

```
API Request
    ↓
Engine Runner
    ↓ (compilação)
Compiled Flow
    ↓ (execução)
Node Handlers
    ↓ (resultado)
API Response
```

**Regra:** Frontend nunca executa fluxos diretamente

---

## 🧪 Testes

### Estrutura de Testes

```
engine/__tests__/
frontend/src/__tests__/
api/
```

### Regras de Testes

1. ✅ Engine: Testes unitários e de integração
2. ✅ Frontend: Testes de componentes e integração
3. ✅ API: Testes de endpoints

**Regra:** Testes devem validar comportamento, não implementação

---

## 📝 Convenções de Código

### Nomenclatura

- Arquivos: camelCase para JS/TS, PascalCase para componentes React
- Funções: camelCase
- Classes: PascalCase
- Constantes: UPPER_SNAKE_CASE

### Comentários

- Documentar funções complexas
- Explicar decisões arquiteturais
- Documentar regras de negócio

### Logging

- Usar `utils/logger.js` no frontend
- Logs estruturados com contexto
- Evitar `console.log` em produção

---

## 🔐 Segurança

### Multi-tenant

- Isolamento completo por `tenantId`
- Validação de tenant em cada operação
- Cache separado por tenant

### Validação de Entrada

- Validação na engine (obrigatória)
- Validação na API (sanitização)
- Validação no frontend (UX apenas)

---

## 🚀 Performance

### Otimizações Permitidas

- Cache de fluxos compilados
- Lazy loading de componentes
- Debounce em validações de UX
- Memoização de transformações

### Otimizações Proibidas

- Remover validações para performance
- Simplificar algoritmos perdendo precisão
- Cache que compromete isolamento

---

## 📚 Documentação

### Arquivos de Documentação

- `CURSOR_RULES.md`
- `PROJECT_RULES.md`
- `COMPARACAO-BLIP.md`
- `FEATURES-REFERENCE.md`
- `ADAPTACAO-RETE.md`

### Regra de Documentação

- Documentar decisões arquiteturais
- Manter documentação atualizada
- Documentar breaking changes

---

## ⚖️ Regra de Precedência

Em caso de conflito entre:
- código
- comentários
- prompts
- sugestões de IA

**Este arquivo (`PROJECT_RULES.md`) é a fonte da verdade.**

Qualquer mudança que viole estas regras deve ser recusada,
mesmo que o código atual permita.

---

## ✅ Checklist de Conformidade

Antes de fazer alterações, verificar:

- [ ] Não remove validações existentes?
- [ ] Não mistura camadas?
- [ ] Não move lógica de negócio para UI?
- [ ] Não adiciona efeitos colaterais no core?
- [ ] Não simplifica removendo regras?
- [ ] **Centraliza lógica de negócio na Engine?**
- [ ] **Evita duplicação de mensagens e regras?**
- [ ] **Usa módulos compartilhados quando necessário?**
- [ ] Segue estrutura de diretórios?
- [ ] Usa convenções de código?
- [ ] Atualiza documentação se necessário?
- [ ] Esta alteração respeita integralmente o PROJECT_RULES.md?

---

## 🔄 Processo de Mudanças

### Mudanças na Engine

1. Criar testes primeiro
2. Implementar mudança
3. Validar que não quebra validações
4. Atualizar documentação

### Mudanças no Frontend

1. Verificar que não adiciona lógica de negócio
2. Validar que não substitui validação da engine
3. Testar integração com API

### Mudanças na API

1. Verificar que apenas delega para engine
2. Validar serialização/deserialização
3. Testar endpoints

---

## 🎨 Regras de Layout e UI

### Estrutura do Flow Editor

O layout do Flow Editor segue uma hierarquia específica:

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    TOOLBAR (h-12)                                                         │
│  [Novo] [Abrir] [Remover] [Salvar] │ [Validar] [Simular] │ [Buscar] │ [➖] [100%] [➕] [Fit] │ [↶] [↷] [📋] [📄] [Duplicar] [Organizar] │
│  [Importar] [Exportar] [Template] │ [Logs] [Tema] │ ←SPACER→ │ [⋯ Mais]                    │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────┐
│              BARRA "FLUXO ATUAL"                        │
│  (FORA do ResizablePanel, z-index: 1)                  │
│  Fluxo atual: nome-do-fluxo (id)                       │
└─────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────┐
│              MAIN-PANEL-CONTAINER                      │
│              (flex: 1, min-height: 0)                  │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │   PALETA     │  │    EDITOR    │  │ PROPRIEDADES │ │
│  │ (colapsável) │  │ (flex: 1)    │  │ (colapsável) │ │
│  │              │  │ (min: 400px) │  │              │ │
│  │ NodePalette  │  │ FlowEditor   │  │ SidebarProps │ │
│  │              │  │ (Rete.js)    │  │              │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
│                                                         │
│  ┌───────────────────────────────────────────────────┐ │
│  │         VALIDAÇÃO/SIMULAÇÃO (colapsável)          │ │
│  │  ValidationResults + SimulationPanel              │ │
│  └───────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### Componentes Principais

#### 1. Toolbar
- **Posição**: Topo da página
- **Comportamento**: Fixo no topo, não redimensionável, responsiva
- **Altura**: `h-12` (48px)
- **Layout**: `flex`, `items-center`, `px-2`
- **Sistema de Prioridades**: Grupos são escondidos automaticamente quando espaço é limitado
- **Estrutura de Grupos** (da esquerda para direita):
  
  **GRUPO FILE** (Prioridade 1 - Máxima)
  - ➕ Novo (via `children[0]`)
  - 📂 Abrir (via `children[1]` - FlowSelector)
  - 🗑️ Remover (via `children[2]`)
  - 💾 Salvar (`onSave`)
  
  **GRUPO MAIN** (Prioridade 2)
  - ✓ Validar (`onValidate`)
  - ▶️ Simular (`onSimulate`)
  
  **GRUPO SEARCH** (Prioridade 3)
  - 🔍 Buscar (`onSearchNode`)
  
  **GRUPO ZOOM** (Prioridade 4)
  - ➖ Diminuir zoom (`onZoomOut`)
  - 100% (`onResetZoom`)
  - ➕ Aumentar zoom (`onZoomIn`)
  - 🔍 Fit (`onZoomFit`)
  
  **GRUPO EDIT** (Prioridade 5)
  - ↶ Desfazer (`onUndo`)
  - ↷ Refazer (`onRedo`)
  - 📋 Copiar (`onCopy`)
  - 📄 Colar (`onPaste`)
  - 📑 Duplicar (`onDuplicate`)
  - ⚙️ Organizar (`onArrange`)
  
  **GRUPO EXTRA** (Prioridade 6)
  - 📥 Importar (`onImportJson`)
  - 📤 Exportar (`onExportJson`)
  - 📋 Template (`onImportTemplate`)
  
  **GRUPO TOOLS** (Prioridade 7 - Menor)
  - 📋 Logs (via `children[3]`)
  - 🎨 Tema/ThemeSelector (via `children[4]`)
  
  **SPACER** (flex: 1, min-w-5)
  - Preenche espaço restante
  
  **GRUPO MAIS** (sempre último, se houver itens)
  - ⋯ Mais (menu dropdown)
  - Contém itens que não cabem na toolbar

- **Ordem de Prioridade** (quando espaço é limitado):
  1. FILE (maior prioridade - sempre tenta mostrar primeiro)
  2. MAIN
  3. SEARCH
  4. ZOOM
  5. EDIT
  6. EXTRA
  7. TOOLS (menor prioridade - primeiro a ser escondido)

- **Histerese**: Grupos visíveis só são escondidos se realmente não houver espaço (margem de 16px = gap-4)
- **Cálculo de Espaço**: Usa constantes baseadas em classes Tailwind (px-2, gap-2, min-w-5, w-20, gap-12)
- **Menu "Mais"**: Aparece quando há itens que não cabem na toolbar, sempre por último

#### 2. Barra "Fluxo Atual"
- **Posição**: Abaixo da Toolbar, **FORA** do ResizablePanel
- **CSS**: `.flow-current-display` com `z-index: 1`
- **Comportamento**: Sempre visível, não desaparece
- **Conteúdo**: Mostra nome e ID do fluxo atual

#### 3. Main Panel Container
- **CSS**: `.main-panel-container`
- **Layout**: `flex: 1`, `min-height: 0`, `overflow: hidden`
- **Função**: Container principal que ocupa todo espaço restante

#### 4. Seção Paleta
- **Componente**: `ResizablePanel` com `collapsible={true}`
- **Largura padrão**: 200px
- **Largura quando colapsado**: 48px
- **Limites**: min: 48px, max: 800px
- **Conteúdo**: `NodePalette` (lista de nós disponíveis)
- **Quando colapsado**: Mostra apenas ícones na vertical

#### 5. Seção Editor
- **CSS**: `.editor-section`
- **Layout**: `flex: 1` (ocupa todo espaço disponível)
- **Tamanho mínimo**: 400px (`min-width: 400px`)
- **Conteúdo**: `FlowEditor` (Rete.js canvas)
- **Comportamento**: Sempre visível, se ajusta automaticamente
- **NÃO colapsável**: O editor nunca pode ser colapsado

#### 6. Seção Propriedades/Validação/Simulação
- **Componente**: Painel direito único com colapso vertical
- **Largura padrão**: 288px
- **Largura quando colapsado**: 48px
- **Limites**: min: 48px, max: 800px
- **Conteúdo**: 
  - `SidebarProperties` (formulário de propriedades)
  - `ValidationResults` (resultados da validação)
  - `SimulationPanel` (resultados da simulação)
- **Colapso vertical**: Cada subseção pode ser colapsada verticalmente
- **Quando colapsado horizontalmente**: Mostra títulos na vertical

### Regras de Colapso

#### Colapso Horizontal
- **Paleta**: Pode ser colapsada horizontalmente (largura → 48px)
- **Painel Direito**: Pode ser colapsado horizontalmente (largura → 48px)
- **Editor**: NUNCA pode ser colapsado

#### Colapso Vertical (Painel Direito)
- **Propriedades**: Pode ser colapsada verticalmente (altura → header apenas)
- **Validação**: Pode ser colapsada verticalmente (altura → header apenas)
- **Simulação**: Pode ser colapsada verticalmente (altura → header apenas)
- **Headers**: Sempre visíveis, mesmo quando colapsado

### Responsividade

#### Desktop (> 1024px)
- Layout horizontal: Paleta | Editor | Propriedades/Validação/Simulação
- Todos os painéis redimensionáveis horizontalmente
- Colapso automático quando a tela fica pequena

#### Tablet/Mobile (≤ 1024px)
- Layout pode se adaptar verticalmente se necessário
- Editor sempre mantém pelo menos 400px de largura
- Painéis laterais podem ser colapsados automaticamente

### Estados de Colapso

Quando colapsado horizontalmente, cada painel mostra:
- Largura de 48px
- Título na vertical (rotacionado)
- Botão de expandir/recolher no header
- Ícones apenas (no caso da paleta)

### Regras de Redimensionamento

1. **ResizableDivider**: Usado para redimensionamento manual
2. **Limites**: Cada painel tem limites min/max definidos
3. **Editor**: Sempre mantém `flex: 1` e `min-width: 400px`
4. **Persistência**: Larguras são salvas no localStorage

### CSS e Classes

- **`.flow-editor-page`**: Container principal (grid layout)
- **`.toolbar`**: Barra de ferramentas no topo
- **`.flow-current-display`**: Barra de fluxo atual
- **`.main-panel-container`**: Container dos painéis principais
- **`.flow-editor-container`**: Container do editor Rete.js
- **`.rete-background`**: Background do canvas com grid
- **`.tb-btn`**: Botões da toolbar
- **`.collapse-btn`**: Botões de colapso
- **`.vertical`**: Classe para texto vertical quando colapsado

### Regras de Implementação

1. ✅ **NÃO remover painéis do DOM** quando colapsados
2. ✅ **NÃO usar `display: none`** no container do painel
3. ✅ **Colapsar = reduzir ALTURA** (painéis verticais) ou **LARGURA** (painéis horizontais)
4. ✅ **Header do painel deve SEMPRE permanecer visível**
5. ✅ **Apenas o CONTEÚDO do painel deve ser ocultado**
6. ✅ **Não alterar a largura do painel direito** quando colapsando verticalmente
7. ✅ **Não gerar scroll horizontal**
8. ✅ **Não quebrar redimensionamento existente**
9. ✅ **Usar classes Tailwind**, não CSS-in-JS ou inline styles
10. ✅ **Manter suporte a dark/light theme**

---

### Toolbar - Detalhes Técnicos

#### Sistema de Prioridades e Responsividade

A Toolbar implementa um sistema inteligente de prioridades que esconde grupos automaticamente quando o espaço é limitado:

1. **Cálculo de Espaço Disponível**:
   - Usa `window.resize` para detectar mudanças de viewport (não ResizeObserver)
   - Calcula espaço fixo (separadores, spacer, botão "Mais")
   - Reserva espaço estimado para botão "Mais" (w-20 = 80px)
   - Usa constantes baseadas em classes Tailwind (não valores fixos em pixels)
   - Ignora mudanças menores que 5px para evitar recálculos desnecessários

2. **Constantes Tailwind Usadas**:
   - `TAILWIND_PX_2 = 8` → `px-2`, `gap-2`
   - `TAILWIND_PX_4 = 16` → `gap-4` (histerese)
   - `TAILWIND_MIN_W_5 = 20` → `min-w-5` (spacer mínimo)
   - `TAILWIND_W_20 = 80` → `w-20` (botão "Mais")
   - `TAILWIND_GAP_12 = 48` → `gap-12` (margem de segurança)

3. **Histerese (15px → 16px = gap-4)**:
   - Evita alternância quando espaço está no limite
   - Se um grupo já está visível, precisa de menos espaço para continuar
   - Aplica-se aos grupos: EDIT, EXTRA, TOOLS

4. **Debounce e Performance**:
   - Debounce de 500ms no `window.resize`
   - `requestAnimationFrame` para agrupar atualizações
   - Verificação de mudança mínima de viewport (5px) antes de recalcular
   - Flag `isChecking` para evitar processamento simultâneo
   - Toolbar só reage a mudanças de viewport, não a colapso de painéis internos

5. **Menu "Mais"**:
   - Sempre aparece por último (após spacer)
   - Contém itens dos grupos que não cabem na toolbar
   - **Organização por grupos**: Itens são agrupados e separados visualmente
   - **Nomes dos grupos**:
     - **Arquivo**: Abrir (FlowSelector), Remover, Salvar
     - **Fluxo**: Validar, Simular
     - **Importar/Exportar**: Importar, Exportar, Template
     - **Zoom**: Diminuir zoom, 100%, Aumentar zoom, Fit
     - **Editar**: Desfazer, Refazer, Copiar, Colar, Duplicar, Organizar
     - **Buscar**: Buscar nó
   - **Ordem de exibição**: FILE → MAIN → EXTRA → ZOOM → EDIT → SEARCH
   - **Separadores visuais**: Cada grupo tem um cabeçalho e separador (borda superior)
   - **Grupos vazios**: Não são renderizados

#### Regras de Implementação da Toolbar

1. ✅ **Usar classes Tailwind**, não valores fixos em pixels
2. ✅ **Grupos são escondidos na ordem inversa de prioridade** (7 → 6 → 5 → 4 → 3 → 2 → 1)
3. ✅ **Histerese aplicada** para evitar alternância (grupos EDIT, EXTRA, TOOLS)
4. ✅ **Menu "Mais" sempre por último** (após spacer)
5. ✅ **Tools tem menor prioridade** (primeiro a ser escondido)
6. ✅ **Spacer usa flex: 1** para preencher espaço restante
7. ✅ **Separadores condicionais** (só aparecem se houver grupos após)
8. ✅ **Grupo FILE tem prioridade máxima** (Novo, Abrir, Remover, Salvar sempre tentam aparecer primeiro)
9. ✅ **Toolbar só reage a mudanças de viewport**, não a colapso de painéis internos

---

**Última atualização:** 2025-12-25

### Mudanças Recentes na Toolbar

- **Novo grupo FILE criado**: "Novo", "Abrir" (FlowSelector), "Remover" e "Salvar" agora estão em um grupo separado com prioridade máxima
- **Grupo MAIN atualizado**: Agora contém apenas "Validar" e "Simular"
- **Ordem de prioridade atualizada**: FILE > MAIN > SEARCH > ZOOM > EDIT > EXTRA > TOOLS
- **Toolbar responsiva**: Só reage a mudanças de viewport (window.resize), não a colapso de painéis internos
- **Menu "Mais" com separação por grupos**: Itens são organizados por grupos (Arquivo, Fluxo, Importar/Exportar, Zoom, Editar, Buscar) com cabeçalhos e separadores visuais
