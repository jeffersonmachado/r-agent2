# Features do Projeto de Referência Rete.js

Este documento lista todas as funcionalidades disponíveis no projeto de referência do Rete.js Kit.

## 📦 Plugins e Dependências

### Plugins Principais
- **rete** (v2.0.6) - Core do Rete.js
- **rete-area-plugin** (v2.1.5) - Área de trabalho 2D
- **rete-area-3d-plugin** (v2.0.5) - Área de trabalho 3D
- **rete-connection-plugin** (v2.0.5) - Gerenciamento de conexões
- **rete-connection-reroute-plugin** (v2.0.3) - Reroute points nas conexões
- **rete-react-plugin** (v2.1.0) - Renderização React
- **rete-context-menu-plugin** (v2.0.6) - Menu de contexto
- **rete-minimap-plugin** (v2.0.3) - Minimapa
- **rete-scopes-plugin** (v2.1.1) - Escopos/hierarquia de nós
- **rete-auto-arrange-plugin** (v2.0.2) - Organização automática
- **rete-engine** (v2.1.1) - Engine de execução (Dataflow)
- **rete-render-utils** (v2.0.3) - Utilitários de renderização

### Outras Dependências
- **three** (v0.156.1) - Para renderização 3D
- **elkjs** (v0.8.2) - Layout automático
- **styled-components** (v5.3.11) - Estilização

## 🎯 Templates Disponíveis

O projeto de referência possui 5 templates diferentes, acessíveis via query string `?template=<nome>`:

### 1. **default** (Template Padrão)
**Arquivo:** `src/rete/default.ts`

**Features:**
- ✅ Renderização React de nós
- ✅ Sistema de conexões
- ✅ Context Menu (menu de contexto)
- ✅ Minimapa
- ✅ Reroute points (pontos de reroteamento)
- ✅ Auto Arrange (organização automática)
- ✅ Dataflow Engine (execução de fluxo de dados)
- ✅ Seleção de nós (com Ctrl para múltipla seleção)
- ✅ Seleção de reroute points
- ✅ Zoom automático nos nós
- ✅ Ordenação simples de nós
- ✅ Processamento automático quando conexões são criadas/removidas

**Nós:**
- `NumberNode` - Nó numérico com controle de entrada
- `AddNode` - Nó de adição com 2 entradas e 1 saída

**Exemplo de uso:**
```typescript
// Acessa via: ?template=default
const editor = new NodeEditor<Schemes>();
const area = new AreaPlugin(container);
const connection = new ConnectionPlugin();
const reactRender = new ReactPlugin({ createRoot });
const contextMenu = new ContextMenuPlugin({ items: [...] });
const minimap = new MinimapPlugin();
const reroutePlugin = new ReroutePlugin();
const dataflow = new DataflowEngine();
const arrange = new AutoArrangePlugin();
```

### 2. **customization** (Customização)
**Arquivo:** `src/rete/customization.ts`

**Features:**
- ✅ Componentes customizados de nós
- ✅ Sockets customizados
- ✅ Conexões customizadas
- ✅ Background customizado
- ✅ Seleção de nós
- ✅ Sistema de `customize` do preset

**Componentes Customizados:**
- `CustomNode` - Nó totalmente customizado
- `StyledNode` - Nó com estilos customizados
- `CustomSocket` - Socket customizado
- `CustomConnection` - Conexão customizada

**Exemplo de uso:**
```typescript
reactRender.addPreset(
  ReactPresets.classic.setup({
    customize: {
      node(context) {
        if (context.payload.label === 'Fully customized') {
          return CustomNode;
        }
        if (context.payload.label === 'Override styles') {
          return StyledNode;
        }
        return ReactPresets.classic.Node;
      },
      socket() {
        return CustomSocket;
      },
      connection() {
        return CustomConnection;
      },
    },
  })
);
```

### 3. **scopes** (Escopos/Hierarquia)
**Arquivo:** `src/rete/scopes.ts`

**Features:**
- ✅ Sistema de escopos (hierarquia de nós)
- ✅ Nós pais e filhos
- ✅ Context Menu
- ✅ Auto Arrange
- ✅ Seleção de nós

**Nós:**
- `NodeA` - Nó tipo A
- `NodeB` - Nó tipo B
- `NodeParent` - Nó pai (pode conter outros nós)

**Exemplo de uso:**
```typescript
const scopes = new ScopesPlugin<Schemes>();
scopes.addPreset(ScopesPresets.classic.setup());

// Define hierarquia
a.parent = parent1.id;
b.parent = parent1.id;
parent1.parent = parent3.id;
```

### 4. **3d** (Renderização 3D)
**Arquivo:** `src/rete/3d.ts`

**Features:**
- ✅ Renderização 3D usando Three.js
- ✅ Context Menu
- ✅ Reroute points
- ✅ Dataflow Engine
- ✅ Auto Arrange
- ✅ Formas 3D para conexões, nós e reroutes

**Exemplo de uso:**
```typescript
const area3D = new Area3DPlugin(container);
Area3DExtensions.forms.connection(reactRender);
Area3DExtensions.forms.node(area);
Area3DExtensions.forms.reroute(area);
```

### 5. **perf** (Performance)
**Arquivo:** `src/rete/perf.ts`

**Features:**
- ✅ Renderização otimizada para muitos nós
- ✅ Grid de nós configurável (via query string)
- ✅ Seleção de nós
- ✅ Zoom automático
- ✅ Ordenação simples

**Configuração:**
```typescript
// Acessa via: ?template=perf&rows=12&cols=12
const query = new URLSearchParams(location.search);
const rows = Number(query.get('rows') || 0) || 12;
const cols = Number(query.get('cols') || 0) || 12;
```

## 🔧 Funcionalidades Comuns

### AreaExtensions (Área de Trabalho)
- **`selectableNodes`** - Seleção de nós
- **`selector`** - Seletor de nós
- **`accumulateOnCtrl`** - Seleção múltipla com Ctrl
- **`zoomAt`** - Zoom automático nos nós
- **`simpleNodesOrder`** - Ordenação simples de nós

### ConnectionPlugin
- **Criação de conexões** - Arrastar de output para input
- **Remoção de conexões** - Clique na conexão
- **Preset classic** - Configuração padrão

### ReactPlugin
- **Renderização React** - Componentes React para nós
- **Preset classic** - Componentes padrão
- **Customização** - Sistema de customize para componentes customizados
- **RefSocket** - Componente de socket
- **RefControl** - Componente de controle

### ContextMenuPlugin
- **Menu de contexto** - Clique direito para criar nós
- **Preset classic** - Configuração padrão

### MinimapPlugin
- **Minimapa** - Visão geral do grafo
- **Navegação** - Clique no minimapa para navegar

### ReroutePlugin
- **Reroute points** - Pontos intermediários nas conexões
- **Seleção** - Seleção de reroute points
- **Movimentação** - Arrastar reroute points

### AutoArrangePlugin
- **Organização automática** - Layout automático dos nós
- **Preset classic** - Configuração padrão

### DataflowEngine
- **Execução de fluxo** - Processamento de dados
- **Nós implementam DataflowNode** - Interface para nós processáveis
- **Método `data()`** - Retorna dados do nó

### ScopesPlugin
- **Hierarquia** - Nós pais e filhos
- **Escopos** - Agrupamento de nós

## 📝 Padrões de Uso

### 1. Inicialização Básica
```typescript
const editor = new NodeEditor<Schemes>();
const area = new AreaPlugin(container);
const connection = new ConnectionPlugin();
const reactRender = new ReactPlugin({ createRoot });

editor.use(area);
area.use(connection);
area.use(reactRender);
```

### 2. Configuração de Presets
```typescript
connection.addPreset(ConnectionPresets.classic.setup());
reactRender.addPreset(ReactPresets.classic.setup());
```

### 3. Seleção de Nós
```typescript
const selector = AreaExtensions.selector();
const accumulating = AreaExtensions.accumulateOnCtrl();
AreaExtensions.selectableNodes(area, selector, { accumulating });
```

### 4. Hook useRete
```typescript
import { useRete } from 'rete-react-plugin';

function App() {
  const [ref] = useRete(createEditor);
  return <div ref={ref} className="rete"></div>;
}
```

### 5. Customização de Componentes
```typescript
reactRender.addPreset(
  ReactPresets.classic.setup({
    customize: {
      node(context) {
        // Retorna componente customizado
        return CustomNode;
      },
      socket() {
        return CustomSocket;
      },
      connection() {
        return CustomConnection;
      },
    },
  })
);
```

## 🎨 Componentes Customizados

### CustomNode
- Usa `RefSocket` e `RefControl` dos presets
- Estilização com styled-components
- Suporte a width/height customizados
- Estado de seleção
- Ordenação por índice (`index` property)
- Classes CSS: `.title`, `.output`, `.input`, `.output-socket`, `.input-socket`

### CustomSocket
- Socket customizado com estilos próprios
- Tamanho configurável via `$socketsize` (16px)
- Margem configurável via `$socketmargin` (6px)
- Hover effect

### CustomConnection
- Conexão customizada
- Usa `useConnection` hook dos presets
- Estilos customizados
- Suporte a loops (`isLoop` property)
- SVG customizado

### StyledNode
- Nó que estende o preset classic
- Apenas sobrescreve estilos
- Mantém funcionalidade padrão

### Custom Background
- Background customizado para a área
- Adicionado via `area.area.content.add()`
- Estilização via CSS (`.background`, `.fill-area`)

### Variáveis de Customização
```typescript
export const $nodewidth = 200;      // Largura padrão do nó
export const $socketmargin = 6;     // Margem dos sockets
export const $socketsize = 16;      // Tamanho dos sockets
```

## 🚀 Funcionalidades Avançadas

### Dataflow Engine
- Processamento automático de dados
- Nós implementam `DataflowNode`
- Método `data()` retorna dados processados
- Atualização automática quando conexões mudam

### Auto Arrange
- Layout automático usando ELK.js
- Organização hierárquica
- Configuração via preset

### Reroute Points
- Pontos intermediários nas conexões
- Seleção e movimentação
- Context menu para remoção

### Scopes (Hierarquia)
- Nós podem ter pais
- Agrupamento visual
- Hierarquia de escopos

## 📊 Comparação com Nosso Projeto

### ✅ Já Implementado
- Renderização React
- Sistema de conexões
- Seleção de nós (recém adicionado)
- Customização de componentes
- RefSocket e RefControl

### ⏳ Não Implementado (Disponível no Reference)
- Context Menu
- Minimapa
- Reroute Points
- Auto Arrange
- Dataflow Engine
- Scopes (Hierarquia)
- Renderização 3D

## 💡 Recomendações

1. **Context Menu** - Útil para criar nós rapidamente
2. **Minimapa** - Melhora navegação em grafos grandes
3. **Auto Arrange** - Organização automática é muito útil
4. **Reroute Points** - Melhora visualização de conexões complexas
5. **Dataflow Engine** - Se precisar executar o fluxo

