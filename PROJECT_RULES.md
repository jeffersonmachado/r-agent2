# PROJECT_RULES - Regras e Princípios do Projeto

## 📌 Terminologia Oficial

Para evitar ambiguidades, os termos abaixo são equivalentes neste projeto:

## Status destas regras

- Este documento descreve a arquitetura-alvo e os guardrails de implementação alinhados a `docs/OBJETIVO_FINAL_PLATAFORMA.md`, `docs/ARQUITETURA_TECNICA.md`, `docs/ROADMAP.md` e `docs/O_QUE_FALTA.md`.
- Se o código atual divergir destas regras, a divergência deve ser tratada como legado/dívida técnica a ser reduzida.
- Exceções existentes no repositório não redefinem o padrão para mudanças novas.

- **Engine = Core do sistema**
  - Onde reside toda a lógica de negócio
  - Execução e validação determinística

- **Frontend = UI**
  - Camada visual e de interação
  - Nunca contém lógica de negócio

- **API = Interface HTTP / Application Boundary**
   - Camada de transporte e orquestração
   - Deve delegar para serviços de domínio e engine, evitando concentrar regras em handlers

- **Serviços de domínio = Application / Domain Services**
   - Orquestram casos de uso e regras compartilhadas
   - Vivem prioritariamente em `api/services/` e `engine/`

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
│   API / APPLICATION BOUNDARY            │
│  - server.js / handlers HTTP            │
│  - Auth, serialização, contratos        │
│  - Orquestração leve                    │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│     DOMAIN SERVICES / USE CASES         │
│  - api/services/*                       │
│  - Regras compartilhadas do produto     │
│  - Integração entre runtime e módulos   │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│         ENGINE (Core Determinístico)     │
│  - validator.js (validações estáticas)  │
│  - compileFlow.js (compilação)          │
│  - executeStep.js (execução)            │
│  - runner.js (orquestração)             │
│  - Sem dependências de UI ou HTTP       │
└─────────────────────────────────────────┘
```

### Princípios de Separação

1. **Frontend (UI):**
   - Apenas renderização e interação
   - Validação visual/preventiva para UX (não substitui a validação autoritativa do backend)
   - Transformação de formatos (Rete JSON ↔ Engine Flow)

2. **API:**
   - Interface HTTP e borda da aplicação
   - Serialização/Deserialização
   - Delegação para serviços de domínio/engine
   - Não deve concentrar regras de negócio diretamente nos handlers

3. **Serviços de domínio + Engine (Core):**
   - A lógica de negócio deve ficar em serviços de domínio e no core determinístico
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
   - ✅ **Regras canônicas devem ficar no backend** (`engine/` ou `api/services/`)
   - ✅ **Mensagens de erro canônicas centralizadas no backend**
   - ✅ **Regras de compatibilidade centralizadas** (engine/typeCompatibility.js)
   - ❌ **NUNCA transformar validação preventiva de frontend em fonte autoritativa**

3. **Centralização de Mensagens**
   - ✅ **Backend envia mensagens técnicas e amigáveis**
   - ✅ **Frontend deve preferir exibir o que recebe do backend**
   - ✅ **Mensagens locais de UX só podem existir como ajuda preventiva, sem redefinir códigos canônicos**
   - ❌ **NUNCA remapear erro canônico do backend para outro significado**
   - ❌ **NUNCA usar mensagens locais para contradizer a validação autoritativa**

4. **Centralização de Regras**
   - ✅ **Regras de compatibilidade de tipos em módulo compartilhado**
   - ✅ **Validações de estrutura na Engine**
   - ✅ **Mensagens de erro com código, mensagem técnica e mensagem amigável no backend**
   - ❌ **NUNCA duplicar regras de compatibilidade no frontend**

5. **Centralização de Estilos CSS**
   - ✅ **Novos estilos estáticos devem ir para CSS/classe reutilizável**
   - ✅ **Usar classes CSS para estilos reutilizáveis**
   - ✅ **Estilos inline apenas para valores dinâmicos calculados em runtime, estado visual ou theming contextual**
   - ❌ **Evitar expandir estilos inline estáticos; legado deve ser migrado quando tocado**
   - ❌ **NUNCA duplicar estilos em múltiplos componentes**

6. **Módulos Compartilhados**
   - Quando duplicação é necessária (ex: compatibilidade de tipos), usar módulos compartilhados
   - **Backend**: Módulos em `engine/utils/` usando CommonJS (`module.exports`)
   - **Frontend**: Wrappers ES module em `frontend/src/shared/` que importam do backend
   - **Estrutura**:
     - `engine/utils/aiTaskExecutor.js` → `frontend/src/shared/aiTaskExecutor.js`
     - `engine/utils/typeCompatibility.js` → `frontend/src/shared/typeCompatibility.js`
     - `engine/utils/templateRenderer.js` → `frontend/src/shared/templateRenderer.js`
     - `engine/utils/jsonSchemaValidator.js` → `frontend/src/shared/jsonSchemaValidator.js`
   - **Vite Plugin**: `frontend/vite-plugin-commonjs.js` transforma CommonJS para ES modules em desenvolvimento
   - **Regra**: Backend é a fonte única da verdade; frontend apenas re-exporta

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

#### ✅ CORRETO: Estilos Centralizados no CSS

```css
/* index.css */
.sidebar-properties-empty {
  color: var(--color-text-tertiary);
}

.sidebar-properties-empty-icon {
  font-size: 48px;
  width: 48px;
  height: 48px;
}
```

```jsx
// Componente - apenas usa classes CSS
<div className="sidebar-properties-empty">
  <span className="sidebar-properties-empty-icon">...</span>
</div>
```

#### ❌ INCORRETO: Estilos Inline Estáticos

```jsx
// ❌ NÃO fazer: estilos estáticos inline
<div style={{ color: 'var(--color-text-tertiary)', fontSize: '48px' }}>
  <span style={{ width: '48px', height: '48px' }}>...</span>
</div>
```

#### ✅ CORRETO: Estilos Inline Apenas para Valores Dinâmicos

```jsx
// ✅ Permitido: largura calculada dinamicamente
<div 
  className="flow-editor-palette"
  style={!paletteCollapsed ? { width: `${paletteWidth}px` } : {}}
>

// ✅ Permitido: variável CSS dinâmica
const nodeColorStyle = { '--node-color': color };
<div className="sidebar-properties-header" style={nodeColorStyle}>
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
   - Usar estilos inline para estilos estáticos
   - Duplicar estilos em múltiplos componentes

---

## 🧩 Flow Editor — Configuração Obrigatória via Painel de Propriedades

### Regra Fundamental

✅ **Toda configuração de nós do Flow Editor DEVE ser feita pelo Painel de Propriedades (`SidebarProperties`)**.

Isso inclui (obrigatoriamente):
- Ajustar `config` de qualquer nó (textos, URLs, variáveis, thresholds, flags, etc.)
- **Adicionar/remover saídas de nós multi-saída** (ex.: regras, horários, opções, intenções)

### Nós com múltiplas saídas (multi-saída)

- **As saídas são derivadas do `config` do nó** (definidas em `frontend/src/editor/nodeSchemas.js` via `outputs` e/ou `getOutputs(node)`).
- O editor **atualiza portas dinamicamente** via `updateNodeIO(nodeId)` quando o `config` muda.
- ❌ **PROIBIDO**: criar/editar saídas alterando JSON manualmente, hacks no DOM, ou “editar config em JSON” no painel.

### Proibição de edição manual de JSON no painel

❌ **PROIBIDO** expor UI que permita editar `config` diretamente como JSON livre no painel (ex.: “Configuração Avançada” editável).

✅ **PERMITIDO**:
- Mostrar JSON **somente leitura** para diagnóstico/migração
- Criar novos campos/controles no painel para cobrir o `config`

### Fonte única da verdade

- **`nodeSchemas.js` é a fonte única da verdade** para:
  - Campos do painel (metadados e propriedades)
  - Entradas/saídas (ports) e sockets
  - Regras de validação por nó

### Regra de implementação (quando faltar campo no painel)

Se um nó precisar de nova configuração:
- ✅ Atualizar `frontend/src/editor/nodeSchemas.js` (propriedade + descrição + default + validação)
- ✅ Garantir renderização no `SidebarProperties` (tipo de campo suportado)
- ✅ Para saídas dinâmicas: usar `getOutputs(node)` e garantir que o painel edite o `config` que alimenta essas saídas

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
├── shared/
│   ├── aiTaskExecutor.js
│   ├── typeCompatibility.js
│   ├── templateRenderer.js
│   └── jsonSchemaValidator.js
├── hooks/
│   ├── useFlowRunner.js
│   └── useRouter.js
└── utils/
```

**Regra:** Frontend não contém lógica de negócio

**Módulos Compartilhados:**
- Wrappers ES module em `frontend/src/shared/` importam módulos CommonJS do backend
- Vite plugin customizado (`vite-plugin-commonjs.js`) transforma CommonJS para ES modules
- Aliases configurados em `vite.config.mjs` para `@shared/*`

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
│   ├── aiNode.js
│   ├── aiTaskNode.js
│   └── persistenceNodes.js
├── utils/
│   ├── aiTaskExecutor.js
│   ├── typeCompatibility.js
│   ├── templateRenderer.js
│   └── jsonSchemaValidator.js
└── utils.js
```

**Regra:** Engine não depende de UI ou API

**Módulos Compartilhados:**
- Módulos em `engine/utils/` são compartilhados com o frontend via wrappers ES module
- Usam CommonJS (`module.exports`) para compatibilidade com Node.js
- Frontend importa via aliases Vite configurados em `vite.config.mjs`

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

### Rate Limiting

**Regra Fundamental:** ✅ **Todas as execuções passam por rate limiting antes de qualquer processamento**

#### Políticas de Rate Limiting

- **DRY-RUN**: Mais permissivo (50 execuções/minuto) - para testes
- **Geração Real**: Restritivo (5 execuções/minuto) - para produção
- **Bootstrap**: Extremamente restritivo (1 execução/5 minutos) - para operações críticas
- **Scraping**: 
  - 10 requisições por 5 minutos (global)
  - 3 requisições por segundo por domínio
  - Máximo 20 páginas por execução

#### Implementação

- **Backend**: Redis obrigatório em produção (`RATE_LIMIT_REDIS_URL`)
- **Fallback**: Memória apenas em desenvolvimento (não recomendado)
- **Integração**: Rate limiting aplicado ANTES de qualquer processamento (IA, scraping, etc.)
- **Auditoria**: Todos os eventos registrados em `reports/rate-limit-events.json`

#### Regras Críticas

1. ❌ **Nenhuma execução sem rate limit**
   - Rate limiting é aplicado na ETAPA 0 do orquestrador
   - Falha de rate limit bloqueia execução ANTES da IA ser chamada

2. ❌ **Nenhum scraping sem rate limit**
   - Rate limit por domínio (requests por segundo)
   - Rate limit por execução (páginas por execução)

3. ❌ **Nenhum retry automático silencioso**
   - Erros de rate limit retornam HTTP 429
   - Frontend exibe mensagem clara com `retryAfter`

4. ✅ **Tudo auditável**
   - Eventos registrados com timestamp, usuário, tipo de operação
   - Relatórios disponíveis em `reports/rate-limit-events.json`

#### Configuração

- Políticas configuráveis via variáveis de ambiente (ver `env.example`)
- Valores padrão em `infra/rate-limit/policies.js`
- Redis configurado via `docker-compose.yml` ou variável `RATE_LIMIT_REDIS_URL`

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
- [ ] **Módulos compartilhados estão em `engine/utils/` (CommonJS)?**
- [ ] **Wrappers ES module estão em `frontend/src/shared/`?**
- [ ] **Estilos estáticos estão no CSS, não inline?**
- [ ] **Estilos inline apenas para valores dinâmicos necessários?**
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

### Estilos CSS e Centralização

**Regra Fundamental:** ✅ **Todos os estilos devem estar no CSS, não inline**

#### Princípios de Estilização

1. **Estilos no CSS (Obrigatório)**
   - ✅ **Todos os estilos estáticos devem estar em `index.css`**
   - ✅ **Usar classes CSS para estilos reutilizáveis**
   - ✅ **Manter consistência visual através de classes CSS**
   - ❌ **NUNCA usar estilos inline para estilos estáticos**

2. **Estilos Inline (Apenas quando necessário)**
   - ✅ **Permitido apenas para valores dinâmicos calculados em runtime**
   - ✅ **Exemplos permitidos:**
     - Larguras calculadas: `style={{ width: `${paletteWidth}px` }}`
     - Posições calculadas: `style={{ top: `${dropdownPosition.top}px` }}`
     - Variáveis CSS dinâmicas: `style={{ '--node-color': color }}`
   - ❌ **NUNCA usar inline para:**
     - Cores estáticas
     - Espaçamentos fixos
     - Tamanhos fixos
     - Bordas, sombras, transições

3. **Organização de Classes CSS**
   - ✅ **Agrupar classes por componente/seção**
   - ✅ **Usar prefixos consistentes** (ex: `.sidebar-properties-*`, `.flow-editor-*`)
   - ✅ **Comentar seções no CSS** para facilitar manutenção
   - ✅ **Usar variáveis CSS** para cores e valores reutilizáveis

4. **Exemplos de Centralização de Estilos**

#### ✅ CORRETO: Estilos no CSS

```css
/* index.css */
.sidebar-properties-empty {
  color: var(--color-text-tertiary);
}

.sidebar-properties-empty-icon {
  font-size: 48px;
  width: 48px;
  height: 48px;
}
```

```jsx
// Componente
<div className="sidebar-properties-empty">
  <span className="sidebar-properties-empty-icon">...</span>
</div>
```

#### ✅ CORRETO: Estilos Dinâmicos Inline (quando necessário)

```jsx
// ✅ Permitido: largura calculada dinamicamente
<div 
  className="flow-editor-palette"
  style={!paletteCollapsed ? { width: `${paletteWidth}px` } : {}}
>

// ✅ Permitido: variável CSS dinâmica
const nodeColorStyle = { '--node-color': color };
<div className="sidebar-properties-header" style={nodeColorStyle}>
```

#### ❌ INCORRETO: Estilos Estáticos Inline

```jsx
// ❌ NÃO fazer: estilos estáticos inline
<div style={{ color: 'var(--color-text-tertiary)', fontSize: '48px' }}>
```

#### Benefícios da Centralização de Estilos

1. **Manutenção Simplificada**
   - Mudanças de estilo em um único lugar
   - Fácil de encontrar e atualizar
   - Consistência visual garantida

2. **Performance**
   - CSS é otimizado pelo navegador
   - Menos re-renderizações
   - Cache de estilos mais eficiente

3. **Reutilização**
   - Classes podem ser reutilizadas
   - Menos duplicação de código
   - Facilita temas e customizações

4. **Testabilidade**
   - Estilos podem ser testados separadamente
   - Fácil de verificar consistência visual
   - Menos acoplamento entre lógica e apresentação

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
9. ✅ **Usar classes Tailwind e CSS**, não CSS-in-JS ou inline styles (exceto valores dinâmicos)
10. ✅ **Manter suporte a dark/light theme**
11. ✅ **Estilos estáticos sempre no CSS**, não inline

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

**Última atualização:** 2025-12-30

---

## 🎯 Execução Oficial do Sistema

### Comando Único de Validação

O projeto possui **um único comando oficial** para validação completa do sistema:

```bash
npm run system:validate
```

Este comando executa, nesta ordem exata:
1. **Validação de Contratos** - Verifica existência e leitura de:
   - `contracts/generation.interface.json`
   - `contracts/qa/qa.contract.json`
2. **Execução Completa de QA** - Executa todos os tipos de teste obrigatórios:
   - Testes unitários (`test:unit`)
   - Testes flow (`test:flow`)
   - Testes stress (`test:stress`)
   - Testes RPA (`test:rpa`)

**Regras Absolutas:**
- ✅ Se qualquer etapa falhar → `process.exit(1)` (sistema não está conforme)
- ✅ Se tudo passar → `process.exit(0)` (sistema está conforme)
- ✅ Execuções fora desse comando **não são consideradas conformes** para validação oficial

### Checklist Automático de Conformidade

Para verificar conformidade estrutural do projeto:

```bash
npm run system:checklist
```

Este comando verifica automaticamente:
- 📦 **Estrutura** - Pastas e arquivos obrigatórios existem
- 📜 **Governança** - `PROJECT_RULES.md` contém seções obrigatórias
- 🧪 **QA** - Scripts de QA estão configurados no `package.json`
- 🔒 **Segurança** - Verificação básica de segurança organizacional

**Regras:**
- ✅ Qualquer falha → `process.exit(1)`
- ✅ Tudo conforme → `process.exit(0)`

### Execução em CI/CD

**Obrigatório:** CI/CD deve usar `npm run system:validate` como único comando de validação.

**Não permitido:**
- ❌ Executar testes individuais isoladamente em CI/CD
- ❌ Pular etapas de validação
- ❌ Usar comandos alternativos para validação oficial

**Permitido (apenas para desenvolvimento local):**
- ✅ Executar testes individuais para desenvolvimento/debug
- ✅ Usar scripts utilitários para diagnóstico rápido
- ✅ Executar `qa` para testes incrementais durante desenvolvimento

### Auditoria de Bypass

Todos os possíveis bypass do sistema estão documentados em:
- `docs/BYPASS_AUDIT.md`

Este documento mapeia:
- Scripts que podem ser executados isoladamente
- Pontos onde QA pode ser ignorado
- Pontos onde IA poderia ser chamada fora do fluxo oficial
- Como `system:validate` resolve ou não cada caso

**Regra:** NÃO removemos scripts, NÃO bloqueamos manualmente, apenas **documentamos e mitigamos por processo**.

---

## 🤖 Testes RPA (Obrigatório)

### Regras Absolutas de RPA

1. ✅ **RPA é exclusivamente um mecanismo de TESTE**
   - RPA NÃO é funcionalidade do produto final
   - RPA é usado apenas para validar fluxos e interfaces
   - Testes RPA são executados em ambiente controlado

2. ✅ **Todo fluxo funcional deve possuir ao menos um teste RPA**
   - Fluxos gerados por IA DEVEM gerar teste RPA automaticamente quando a opção estiver marcada
   - Testes RPA são obrigatórios para componentes: frontend, chatbot-flows
   - Falha em teste RPA pode bloquear deploy conforme política de QA

3. ✅ **Controle explícito de fontes de conhecimento**
   - A IA **NUNCA decide sozinha** usar RAG ou scraping
   - Tudo deve vir explicitamente do formulário do usuário
   - Backend valida contrato (`generation.interface.json`) antes de executar

4. ✅ **RAG e Scraping controlados**
   - RAG: conhecimento interno (fluxos, QA, documentação)
   - Scraping: fontes externas (URLs) - requer aprovação/auditoria
   - Metadata de geração registra todas as fontes utilizadas

5. ✅ **Estrutura de pastas obrigatória**
   - `/tests/rpa/flows` - Testes RPA gerados
   - `/tests/rpa/recordings` - Gravações de ações
   - `/tests/rpa/replays` - Replays de execução
   - `/tests/rpa/reports` - Relatórios de execução

6. ✅ **Integração com pipeline**
   - Testes RPA executados via `npm run test:rpa`
   - Falha em RPA bloqueia pipeline (salvo política explícita)
   - Relatórios gerados em `/tests/rpa/reports`

### Componentes do Sistema de RPA

#### 1. Contratos Formais
- `contracts/generation.interface.json`: Interface pública de geração
- `contracts/qa/qa.contract.json`: Tipos de teste obrigatórios

#### 2. Validação de Contratos
- Backend valida payload contra contratos antes de executar
- Rejeita requisições que não seguem o contrato
- Registra metadata de geração para auditoria

#### 3. Geração Controlada
- Formulário frontend controla explicitamente:
  - Uso de RAG (checkbox + seleção de fontes)
  - Uso de scraping (checkbox + URLs)
  - Geração de teste RPA (checkbox + modo)
- Backend não pode decidir usar fontes não declaradas

#### 4. Execução de Testes
- Script `tools/rpa/run-all.js` executa todos os testes
- Gera relatórios estruturados
- Retorna exit code ≠ 0 em falha

### Regras de Implementação

1. ✅ **Nunca permitir decisão automática de fontes**
   - IA não pode decidir usar RAG ou scraping
   - Tudo deve vir do formulário

2. ✅ **Sempre validar contratos**
   - Backend valida `generation.interface.json` antes de executar
   - Rejeita requisições inválidas

3. ✅ **Sempre registrar metadata**
   - Toda geração registra fontes utilizadas
   - Timestamp, modo RPA, fontes RAG, URLs raspadas

4. ✅ **Sempre integrar com QA**
   - Testes RPA são parte obrigatória do pipeline
   - Falhas bloqueiam deploy (conforme política)

---

## 🔄 Sistema de Fallback (Obrigatório)

### Regras Absolutas de Fallback

1. ✅ **Nenhum fluxo é válido sem FallbackNode**
   - Todo fluxo DEVE conter pelo menos 1 FallbackNode
   - Validação estrutural obrigatória em `frontend/src/editor/flowValidator.js`
   - Validação executada antes da validação do backend

2. ✅ **Todo erro passa pelo FallbackController**
   - Módulo centralizado: `frontend/src/core/FallbackController.js`
   - Único ponto de decisão de fallback
   - Stateless por chamada (estado via contexto)

3. ✅ **Máximo de 3 tentativas por sessão**
   - Configurável via `maxAttempts` no FallbackNode (padrão: 3)
   - Após 3 tentativas, escalada automática para humano

4. ✅ **Nenhum erro técnico visível ao usuário final**
   - Erros técnicos são logados, não exibidos
   - Mensagens amigáveis sempre apresentadas ao usuário
   - Logs estruturados via `logger.event()`

5. ✅ **Escalada humana preserva contexto**
   - Contexto da conversa mantido durante escalada
   - Nó de retorno seguro configurável (`safeReturnNode`)
   - Atendimento humano permite retorno ao bot

6. ✅ **Detecção automática de loops e frustração**
   - Loops simples detectados automaticamente
   - Frustração detectada por palavras-chave
   - Escalada imediata para humano quando detectado

### Componentes do Sistema de Fallback

#### 1. FallbackController (`frontend/src/core/FallbackController.js`)

**Responsabilidades:**
- Receber eventos de erro (intent, flow, data, system, timeout, no_match)
- Controlar número de tentativas por sessão/contexto
- Detectar loops simples (mesmo nó acionando fallback repetidamente)
- Decidir próxima ação: retry, options, human, end
- Detectar frustração básica por palavras-chave
- Emitir logs estruturados de fallback

**Tipos de Fallback:**
- `INTENT`: Intenção não reconhecida
- `FLOW`: Erro no fluxo (nó desconectado, etc)
- `DATA`: Erro de dados (validação, formato)
- `SYSTEM`: Erro de sistema (API, timeout, etc)
- `TIMEOUT`: Timeout específico
- `NO_MATCH`: Sem correspondência (NLU)

**Ações de Fallback:**
- `RETRY`: Tentar novamente
- `OPTIONS`: Oferecer opções ao usuário
- `HUMAN`: Escalar para humano
- `END`: Encerrar conversa

#### 2. FallbackNode (`frontend/src/editor/nodeSchemas.js`)

**Entradas:**
- `in`: Entrada normal
- `error`: Entrada de erro
- `timeout`: Entrada de timeout
- `no_match`: Entrada de sem correspondência

**Saídas:**
- `retry`: Tentar novamente
- `options`: Opções
- `human`: Atendimento humano
- `end`: Encerrar

**Configurações:**
- `maxAttempts` (default: 3): Máximo de tentativas
- `confidenceThreshold` (default: 0.75): Threshold de confiança
- `enableEmotionCheck` (default: true): Detectar frustração
- `safeReturnNode` (opcional): Nó de retorno após escalada humana

**Regras:**
- Nó NÃO contém lógica de negócio complexa
- Delega decisões ao FallbackController
- Visualmente identificado como "Fallback" (ícone: 🔄, cor: #E74C3C)
- Deve impedir loop direto com ele mesmo

#### 3. flowValidator (`frontend/src/editor/flowValidator.js`)

**Validações obrigatórias:**
- Todo fluxo deve conter pelo menos 1 FallbackNode
- Nenhum nó pode ficar órfão
- Todo caminho deve terminar em FallbackNode ou nó de término explícito
- Detectar loops estruturais simples
- Retornar erros claros para o botão "Validar"

**Integração:**
- Validação executada antes da validação do backend
- Erros aplicados visualmente aos nós do editor
- Integrado no `handleValidate` do FlowEditorPage

#### 4. Extensão de nodeSchemas

**Suporte opcional:**
- `errorPorts: true`: Nó suporta portas de erro para fallback
- `supportsTimeout: true`: Nó suporta timeout

**Exemplo:**
```javascript
ai: {
  type: 'ai',
  errorPorts: true,      // Suporta portas de erro
  supportsTimeout: true, // Suporta timeout
  // ... resto do schema
}
```

**Nenhum schema existente deve quebrar** - propriedades são opcionais.

#### 5. Logs Estruturados

**Padrão:**
```javascript
logger.event('fallback_triggered', {
  fallbackType: 'intent',
  attempt: 1,
  nodeId: 'node-123',
  sessionId: 'session-456',
  action: 'retry',
  timestamp: '2025-12-30T12:00:00.000Z',
  hasLoop: false,
  hasFrustration: false,
});
```

**Eventos de fallback:**
- `fallback_triggered`: Fallback acionado
- `fallback_loop_detected`: Loop detectado
- `fallback_frustration_detected`: Frustração detectada
- `fallback_max_attempts_reached`: Máximo de tentativas atingido

**Regra:** Não logar dados sensíveis.

### Regras de Implementação

1. ✅ **Não reescrever nodeFactory existente**
   - FallbackNode criado automaticamente via nodeFactory
   - Schema em nodeSchemas.js é suficiente

2. ✅ **Não remover ou alterar comportamento atual dos nós existentes**
   - Extensões são opcionais (errorPorts, supportsTimeout)
   - Nenhum nó existente quebra

3. ✅ **Não introduzir dependência de framework externo**
   - Apenas dependências já existentes no projeto

4. ✅ **Alterações devem ser extensões claras e isoladas**
   - FallbackController é módulo isolado
   - flowValidator é módulo isolado
   - Extensões em nodeSchemas são opcionais

5. ✅ **Máximo de 3 tentativas de fallback por sessão**
   - Configurável, mas padrão é 3
   - Após 3 tentativas, escalada para humano

6. ✅ **Nenhum erro técnico pode ser exibido ao usuário final**
   - Erros técnicos apenas em logs
   - Mensagens amigáveis sempre apresentadas

7. ✅ **Todo fluxo DEVE conter fallback para ser considerado válido**
   - Validação estrutural obrigatória
   - Erro claro se não houver FallbackNode

### Testes Obrigatórios

**Arquivo:** `frontend/src/__tests__/fallback.spec.js`

**Cenários obrigatórios:**
1. Texto sem intenção reconhecida
2. Confiança abaixo do threshold
3. Nó desconectado
4. Erro simulado de API
5. 3 falhas consecutivas → escalada humana
6. Loop detectado
7. Log de fallback gerado corretamente

**Regra:** Testes devem ser determinísticos e não depender de IA real.

---

**Última atualização:** 2025-12-30

### Mudanças Recentes - Módulos Compartilhados (2025-12-30)

- **Sistema de módulos compartilhados implementado**: Lógica de negócio compartilhada entre backend e frontend
- **Módulos compartilhados**:
  - `aiTaskExecutor.js`: Execução de tarefas de IA (intent_classification, entity_extraction, text_normalization, assisted_response)
  - `typeCompatibility.js`: Regras de compatibilidade de tipos de nós
  - `templateRenderer.js`: Renderização de templates com variáveis
  - `jsonSchemaValidator.js`: Validação de esquemas JSON
- **Wrappers ES module**: Frontend usa wrappers que importam módulos CommonJS do backend
- **Vite Plugin**: Plugin customizado (`vite-plugin-commonjs.js`) transforma CommonJS para ES modules em desenvolvimento
- **Benefícios**: Eliminação de duplicação, fonte única da verdade, manutenção simplificada

### Mudanças Recentes - API Real de IA (2025-12-30)

- **Configuração `useRealAiApi`**: Feature flag para usar chamadas HTTP reais à API de IA
- **Implementação**: Quando habilitado, faz requisições para `/api/ai/generate` ao invés de usar implementação mock local
- **Configuração**: Disponível na página de Configuração (aba Features) e via `config.json`
- **Fallback**: Se API real falhar, usa implementação mock como fallback
- **Benefícios**: Permite ver requisições na aba Network do DevTools, útil para debug e desenvolvimento

### Mudanças Recentes - Sistema de Classificação de Intenções (2025-12-30)

- **Matching melhorado**: Lógica de classificação de intenções aprimorada com detecção de palavras completas
- **Tratamento de fallback**: Quando não há match, retorna `_noMatch: true` ao invés de retornar fallback diretamente
- **Exibição no log**: Resposta da IA sempre exibida no log, mesmo quando fallback é usado
- **Feedback visual**: Mensagem "Copiado!" ao copiar log de execução
- **Benefícios**: Melhor rastreabilidade, debug facilitado, transparência no processo de classificação

### Mudanças Recentes na Toolbar

- **Novo grupo FILE criado**: "Novo", "Abrir" (FlowSelector), "Remover" e "Salvar" agora estão em um grupo separado com prioridade máxima
- **Grupo MAIN atualizado**: Agora contém apenas "Validar" e "Simular"
- **Ordem de prioridade atualizada**: FILE > MAIN > SEARCH > ZOOM > EDIT > EXTRA > TOOLS
- **Toolbar responsiva**: Só reage a mudanças de viewport (window.resize), não a colapso de painéis internos
- **Menu "Mais" com separação por grupos**: Itens são organizados por grupos (Arquivo, Fluxo, Importar/Exportar, Zoom, Editar, Buscar) com cabeçalhos e separadores visuais

### Mudanças Recentes - Centralização de Estilos (2025-12-28)

- **Estilos inline removidos**: Todos os estilos estáticos foram movidos para `index.css`
- **Classes CSS organizadas**: Estilos agrupados por componente/seção com prefixos consistentes
- **Estilos dinâmicos mantidos**: Apenas valores calculados em runtime permanecem inline (larguras, posições, variáveis CSS dinâmicas)
- **Benefícios**: Manutenção simplificada, melhor performance, reutilização de classes, consistência visual
