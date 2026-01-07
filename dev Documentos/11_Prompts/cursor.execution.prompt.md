# Cursor Execution - Regras de Execução no Cursor

## Regras Permanentes

Você deve SEMPRE obedecer às regras abaixo:

1. Leia `PROJECT_RULES.md` antes de qualquer alteração
2. Nunca remova validações existentes
3. Nunca misture camadas
4. Nunca mover lógica de negócio para a UI
5. Nunca adicionar efeitos colaterais no core
6. Nunca "simplificar" removendo regras

## Comportamento em Caso de Violação

**Se uma solicitação violar alguma regra:**
- Recuse a alteração
- Explique o motivo
- Sugira alternativa segura

**Se uma alteração tocar regras fundamentais:**
- Pare
- Peça confirmação explícita

## Arquitetura do Projeto

### Camadas do Sistema

```
FRONTEND (UI Layer)
    ↓ HTTP/REST
API (Interface Layer)
    ↓
ENGINE (Business Logic)
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
   - Sem dependências de UI ou API

## Regras de Proibição

### 1. Nunca Remover Validações

❌ **PROIBIDO:**
- Remover validações da engine
- Simplificar validações complexas
- Remover regras de compatibilidade de tipos

✅ **PERMITIDO:**
- Adicionar novas validações
- Melhorar mensagens de erro
- Otimizar algoritmos de validação

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

### 3. Nunca Mover Lógica de Negócio para UI

❌ **PROIBIDO:**
- Validações de estrutura no frontend
- Lógica de execução no frontend
- Regras de compatibilidade no frontend

✅ **PERMITIDO:**
- Validação de campos vazios (UX)
- Feedback visual
- Transformação de formatos

### 4. Nunca Adicionar Efeitos Colaterais no Core

❌ **PROIBIDO:**
- Mutação de estado global na Engine/Core
- I/O direto na Engine/Core (exceto via providers explicitamente injetados)
- Dependências implícitas de ambiente (filesystem, clock, rede)

✅ **PERMITIDO:**
- Funções puras
- Transformações determinísticas
- Injeção de dependências via providers

### 5. Nunca Simplificar Removendo Regras

❌ **PROIBIDO:**
- Remover validações complexas
- Simplificar algoritmos de validação
- Remover regras de compatibilidade

✅ **PERMITIDO:**
- Otimizar algoritmos mantendo regras
- Refatorar mantendo comportamento
- Melhorar performance sem perder funcionalidade

## Princípio de Centralização

**Regra Fundamental:** ✅ **Centralizar o máximo possível para simplificar a manutenção**

### Single Source of Truth

- Cada regra de negócio deve existir em **um único lugar**
- Evitar duplicação de lógica entre camadas
- Backend é a fonte única de verdade para validações, mensagens e regras

### Centralização de Mensagens

✅ **Backend envia mensagens técnicas e amigáveis**
✅ **Frontend apenas exibe o que recebe do backend**
❌ **NUNCA mapear ou transformar mensagens no frontend**
❌ **NUNCA criar mensagens de erro no frontend**

## Regra de Precedência

Em caso de conflito entre:
- código
- comentários
- prompts
- sugestões de IA

**O arquivo `PROJECT_RULES.md` é a fonte da verdade.**

Qualquer mudança que viole estas regras deve ser recusada, mesmo que o código atual permita.

## Checklist de Conformidade

Antes de fazer alterações, verificar:

- [ ] Não remove validações existentes?
- [ ] Não mistura camadas?
- [ ] Não move lógica de negócio para UI?
- [ ] Não adiciona efeitos colaterais no core?
- [ ] Não simplifica removendo regras?
- [ ] Centraliza lógica de negócio na Engine?
- [ ] Evita duplicação de mensagens e regras?
- [ ] Esta alteração respeita integralmente o PROJECT_RULES.md?

