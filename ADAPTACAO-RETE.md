# Adaptação do Projeto para Padrão Rete.js

## Diferenças Principais Identificadas

### 1. **Uso do Hook `useRete`**
**Referência:**
```tsx
const [ref] = useRete(createEditor)
<div ref={ref} className="rete"></div>
```

**Nosso projeto atual:**
- Usa `useRef` e `useEffect` manualmente
- Gerencia inicialização manualmente
- Muito mais código

### 2. **Componentes de Socket e Control**
**Referência:**
```tsx
import { Presets } from "rete-react-plugin";
const { RefSocket, RefControl } = Presets.classic;

<RefSocket
  name="output-socket"
  side="output"
  emit={props.emit}
  socketKey={key}
  nodeId={id}
  payload={output.socket}
/>
```

**Nosso projeto atual:**
- Cria sockets manualmente com `onPointerDown`, `onClick`, etc.
- Muito código para gerenciar eventos
- Problemas com propagação de eventos

### 3. **Customização via Preset**
**Referência:**
```tsx
reactRender.addPreset(
  ReactPresets.classic.setup({
    customize: {
      node(context) {
        if (context.payload.label === 'Fully customized') {
          return CustomNode;
        }
        return ReactPresets.classic.Node;
      },
      socket() {
        return CustomSocket;
      },
    },
  })
);
```

**Nosso projeto atual:**
- Usa `ReteReactPluginShim.js` customizado
- Renderização manual complexa
- Não usa o sistema de customize do preset

### 4. **Seleção de Nós**
**Referência:**
```tsx
AreaExtensions.selectableNodes(area, AreaExtensions.selector(), {
  accumulating: AreaExtensions.accumulateOnCtrl(),
});
```

**Nosso projeto atual:**
- Gerencia seleção manualmente
- Handlers de clique complexos
- Lógica de detecção de sockets complicada

### 5. **Estrutura do Editor**
**Referência:**
```tsx
export async function createEditor(container: HTMLElement) {
  const editor = new NodeEditor<Schemes>();
  const area = new AreaPlugin<Schemes, AreaExtra>(container);
  const connection = new ConnectionPlugin<Schemes, AreaExtra>();
  const reactRender = new ReactPlugin<Schemes, AreaExtra>({ createRoot });

  editor.use(area);
  area.use(reactRender);
  area.use(connection);

  connection.addPreset(ConnectionPresets.classic.setup());
  reactRender.addPreset(ReactPresets.classic.setup());

  return { destroy: () => area.destroy() };
}
```

**Nosso projeto atual:**
- Muito código de inicialização
- Gerenciamento manual de plugins
- Lógica complexa de bindSocket

## Plano de Adaptação

1. ✅ Simplificar lógica de detecção de cliques (já feito)
2. ✅ Adaptar para usar padrão Rete.js (melhorias na inicialização)
3. ✅ Substituir sockets manuais por `RefSocket` dos presets
4. ✅ Usar `customize` do preset para componentes customizados
5. ✅ Usar `AreaExtensions.selectableNodes` para seleção
6. ⏳ Remover código manual de renderização de conexões (em progresso)
7. ✅ Simplificar inicialização do editor (melhorias aplicadas)

## Mudanças Implementadas

### ✅ Substituição de Sockets Manuais por RefSocket

**Antes:**
- Sockets criados manualmente com `ref` e `bindSocket`
- Handlers de eventos (`onPointerDown`, `onClick`, etc.) manuais
- Lógica complexa de vinculação de sockets
- Problemas com propagação de eventos

**Depois:**
- Uso de `RefSocket` dos presets do Rete.js
- Sockets gerenciados automaticamente pelo Rete.js
- Estilos customizados aplicados via CSS inline
- Fallback para versão antiga se `emit` não estiver disponível

**Código:**
```jsx
// Importação dos presets
const { RefSocket, RefControl } = ReactPresets.classic;

// Uso no componente
{emit && RefSocket ? (
  <RefSocket
    name="input-socket"
    side="input"
    emit={emit}
    socketKey={key}
    nodeId={node.id}
    payload={input.socket}
  />
) : (
  // Fallback para versão antiga
)}
```

**Benefícios:**
- Código mais simples e aderente ao padrão Rete.js
- Menos problemas com propagação de eventos
- Melhor integração com ConnectionPlugin
- Manutenção mais fácil

### ✅ Uso de AreaExtensions.selectableNodes

**Antes:**
- Lógica manual de detecção de seleção de nós
- Handlers de clique complexos
- Gerenciamento manual de estado de seleção

**Depois:**
- Uso de `AreaExtensions.selectableNodes` para gerenciar seleção automaticamente
- Integração com `AreaExtensions.selector()` e `AreaExtensions.accumulateOnCtrl()`
- Eventos de seleção/deseleção gerenciados pelo Rete.js

**Código:**
```jsx
// Configuração simplificada
const selector = AreaExtensions.selector();
const accumulating = AreaExtensions.accumulateOnCtrl();
AreaExtensions.selectableNodes(area, selector, { accumulating });

// Eventos de seleção via pipe
area.addPipe((context) => {
  if (context.type === 'nodepicked' || context.type === 'nodeselected') {
    // Lógica de seleção simplificada
  }
  return context;
});
```

**Benefícios:**
- Seleção de nós gerenciada automaticamente pelo Rete.js
- Suporte a seleção múltipla com Ctrl
- Menos código manual
- Mais consistente com o padrão Rete.js

### ✅ Melhorias no customize do Preset

**Antes:**
- Customização básica do componente de nó
- Lógica de bindSocket complexa

**Depois:**
- Uso adequado do `customize` do preset classic
- Componentes customizados mantendo funcionalidade padrão
- Melhor integração com RefSocket e RefControl

**Código:**
```jsx
const reactPreset = ReactPresets.classic.setup({
  customize: {
    node(context) {
      // Retorna componente customizado que usa RefSocket
      return (props) => {
        return <FlowNodeComponentWrapper {...props} />;
      };
    },
  },
});
```

**Benefícios:**
- Customização mais limpa e organizada
- Melhor separação de responsabilidades
- Facilita manutenção e extensão

