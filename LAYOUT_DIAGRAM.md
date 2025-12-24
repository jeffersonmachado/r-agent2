# Diagrama do Layout - Flow Editor

## Estrutura Hierárquica (SIMPLIFICADA)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           TOOLBAR                                        │
│  [+ Novo Fluxo] [Abrir Fluxo ▼] [🗑️ Remover] ... [📋 Logs] [🌙 Theme]  │
└─────────────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────────────┐
│                    BARRA "FLUXO ATUAL"                                  │
│  (FORA do ResizablePanel, z-index: 1)                                   │
│  Fluxo atual: nome-do-fluxo (id)                                        │
└─────────────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────────────┐
│                    MAIN-PANEL-CONTAINER                                 │
│                    (flex: 1, min-height: 0)                             │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │              RESIZABLE PANEL PRINCIPAL (ÚNICO)                      │ │
│  │              (direction: horizontal, collapsible: false)           │ │
│  │                                                                     │ │
│  │  ┌───────────────────────────────────────────────────────────────┐ │ │
│  │  │         MAIN-PANEL-CONTENT (flex row, gap: 0)                 │ │ │
│  │  │                                                                │ │ │
│  │  │  ┌──────────────┐  ┌──────────────────────┐  ┌─────────────┐ │ │ │
│  │  │  │ RESIZABLE    │  │   EDITOR SECTION     │  │ RESIZABLE   │ │ │ │
│  │  │  │ PANEL        │  │   (flex: 1)          │  │ PANEL       │ │ │ │
│  │  │  │ "PALETA"     │  │   (min-width: 400px) │  │"PROPRIEDADES"│ │ │ │
│  │  │  │              │  │   (NÃO colapsável)   │  │             │ │ │ │
│  │  │  │ ┌──────────┐ │  │                      │  │ ┌─────────┐ │ │ │ │
│  │  │  │ │ Header   │ │  │   ┌──────────────┐   │  │ │ Header  │ │ │ │ │
│  │  │  │ │ Paleta [▶]│ │  │   │              │   │  │ │Props [▶]│ │ │ │ │
│  │  │  │ └──────────┘ │  │   │  FlowEditor   │   │  │ └─────────┘ │ │ │ │
│  │  │  │ ┌──────────┐ │  │   │  (Rete.js)   │   │  │ ┌─────────┐ │ │ │ │
│  │  │  │ │NodePalette│ │  │   │              │   │  │ │Sidebar │ │ │ │ │
│  │  │  │ │          │ │  │   │  Canvas com  │   │  │ │Properties│ │ │ │ │
│  │  │  │ │ • Nó 1   │ │  │   │  nós e      │   │  │ │          │ │ │ │ │
│  │  │  │ │ • Nó 2   │ │  │   │  conexões    │   │  │ │ Configs  │ │ │ │ │
│  │  │  │ │ • Nó 3   │ │  │   │              │   │  │ │          │ │ │ │ │
│  │  │  │ └──────────┘ │  │   └──────────────┘   │  │ └─────────┘ │ │ │ │
│  │  │  └──────────────┘  └──────────────────────┘  └─────────────┘ │ │ │
│  │  │                                                                │ │ │
│  │  │  ┌──────────────────────────────────────────────────────────┐ │ │ │
│  │  │  │         RESIZABLE PANEL "VALIDAÇÃO"                      │ │ │ │
│  │  │  │                                                          │ │ │ │
│  │  │  │  ┌──────────┐                                           │ │ │ │
│  │  │  │  │ Header   │                                           │ │ │ │
│  │  │  │  │Validação[▶]                                          │ │ │ │
│  │  │  │  └──────────┘                                           │ │ │ │
│  │  │  │  ┌──────────┐                                           │ │ │ │
│  │  │  │  │Validation │                                           │ │ │ │
│  │  │  │  │ Results   │                                           │ │ │ │
│  │  │  │  │           │                                           │ │ │ │
│  │  │  │  │Simulation │                                           │ │ │ │
│  │  │  │  │ Panel     │                                           │ │ │ │
│  │  │  │  └──────────┘                                           │ │ │ │
│  │  │  └──────────────────────────────────────────────────────────┘ │ │ │
│  │  └───────────────────────────────────────────────────────────────┘ │ │
│  └───────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

## Características Principais

### 1. Toolbar
- **Posição**: Topo da página
- **Conteúdo**: Botões de ação (Novo, Abrir, Salvar, Validar, etc.)
- **Comportamento**: Fixo no topo, não redimensionável

### 2. Barra "Fluxo Atual"
- **Posição**: Abaixo da Toolbar, **FORA** do ResizablePanel
- **CSS**: `.flow-current-display` com `z-index: 1`
- **Comportamento**: Sempre visível, não desaparece
- **Conteúdo**: Mostra nome e ID do fluxo atual

### 3. Main Panel Container
- **CSS**: `.main-panel-container`
- **Layout**: `flex: 1`, `min-height: 0`, `overflow: hidden`
- **Função**: Container principal que ocupa todo espaço restante

### 4. ResizablePanel Principal (ÚNICO)
- **Direção**: Horizontal
- **Colapsável**: Não (`collapsible={false}`)
- **Largura mínima**: 600px
- **Função**: Controla o redimensionamento geral do conteúdo

### 5. Main Panel Content
- **CSS**: `.main-panel-content`
- **Layout**: `flex row`, `gap: 0`
- **Função**: Container flexível que organiza os painéis lado a lado

### 6. Seção Paleta (ResizablePanel com colapso)
- **Componente**: `ResizablePanel` com `collapsible={true}` e `title="Paleta"`
- **Largura padrão**: 200px
- **Largura quando colapsado**: 40px
- **Limites**: min: 150px, max: 400px
- **Conteúdo**: `NodePalette` (lista de nós disponíveis)
- **Quando colapsado**: Mostra título "Paleta" na vertical (40px de largura)

### 7. Seção Editor (NÃO Colapsável)
- **CSS**: `.editor-section`
- **Layout**: `flex: 1` (ocupa todo espaço disponível)
- **Tamanho mínimo**: 400px (`min-width: 400px`)
- **Conteúdo**: `FlowEditor` (Rete.js canvas)
- **Comportamento**: Sempre visível, se ajusta automaticamente

### 8. Seção Propriedades (ResizablePanel com colapso)
- **Componente**: `ResizablePanel` com `collapsible={true}` e `title="Propriedades"`
- **Largura padrão**: 300px
- **Largura quando colapsado**: 40px
- **Limites**: min: 280px, max: 500px
- **Conteúdo**: `SidebarProperties` (formulário de propriedades do nó selecionado)
- **Quando colapsado**: Mostra título "Propriedades" na vertical (40px de largura)

### 9. Seção Validação (ResizablePanel com colapso)
- **Componente**: `ResizablePanel` com `collapsible={true}` e `title="Validação"`
- **Largura padrão**: 400px
- **Largura quando colapsado**: 40px
- **Limites**: min: 300px, max: 600px
- **Conteúdo**: 
  - `ValidationResults` (resultados da validação)
  - `SimulationPanel` (resultados da simulação)
- **Quando colapsado**: Mostra título "Validação" na vertical (40px de largura)

## Simplificações Implementadas

### ✅ Remoção de CollapsibleSection
- **Antes**: Cada seção tinha um `CollapsibleSection` que envolvia um `ResizablePanel`
- **Agora**: Apenas `ResizablePanel` com `collapsible={true}` e `title`
- **Benefício**: Código mais simples, menos componentes aninhados

### ✅ Header Integrado
- **Antes**: Header separado em `CollapsibleSection`
- **Agora**: Header integrado no próprio `ResizablePanel`
- **Benefício**: Um único componente gerencia tudo

### ✅ Título Vertical quando Colapsado
- Quando colapsado, o `ResizablePanel` mostra automaticamente o título na vertical
- Usa `writing-mode: vertical-rl` e `text-orientation: mixed`
- Largura fixa de 40px quando colapsado

## Fluxo de Redimensionamento

1. **ResizablePanel Principal**: Controla a largura total do conteúdo
2. **ResizablePanels Individuais**: Cada seção é um `ResizablePanel` independente com:
   - Redimensionamento horizontal (CSS `resize`)
   - Colapso/expansão integrado
   - Título na vertical quando colapsado
3. **Editor**: Se ajusta automaticamente com `flex: 1` entre as seções laterais

## Responsividade

### Desktop (> 1024px)
- Layout horizontal: Paleta | Editor | Propriedades | Validação
- Todos os painéis redimensionáveis horizontalmente
- Colapso automático quando a tela fica pequena

### Tablet/Mobile (≤ 1024px)
- Layout vertical: painéis empilhados
- Editor sempre no meio (order: 2)
- Propriedades (order: 3)
- Validação (order: 4)
- Redimensionamento vertical permitido

## Estados de Colapso

```
┌────┐  ┌──────────────────┐  ┌────┐  ┌────┐
│ P  │  │                  │  │ P  │  │ V  │
│ a  │  │                  │  │ r  │  │ a  │
│ l  │  │    EDITOR        │  │ o  │  │ l  │
│ e  │  │   (min: 400px)   │  │ p  │  │ i  │
│ t  │  │                  │  │ s  │  │ d  │
│ a  │  │                  │  │    │  │ a  │
│[◀] │  │                  │  │[◀] │  │[◀] │
└────┘  └──────────────────┘  └────┘  └────┘
```

Quando colapsado, cada `ResizablePanel` mostra:
- Largura de 40px
- Título na vertical (rotacionado)
- Botão de expandir/recolher no header

## Colapso Automático Responsivo

- Monitora o tamanho da janela continuamente
- Quando a tela fica pequena, colapsa automaticamente (prioridade: Validação → Propriedades → Paleta)
- Quando há espaço, expande automaticamente (prioridade: Paleta → Propriedades → Validação)
- O editor sempre mantém pelo menos 400px de largura
