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

**Última atualização:** 2025-12-22
