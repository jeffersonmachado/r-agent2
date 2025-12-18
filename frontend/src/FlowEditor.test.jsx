import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { ThemeProvider } from './styles/themeContext';

// Mock das classes do Rete - usando factory functions para evitar hoisting issues
vi.mock('rete', () => {
  const mockNodeEditor = vi.fn();
  const mockNode = vi.fn((id) => ({
    id,
    data: {},
    inputs: {},
    outputs: {},
    addInput: vi.fn(),
    addOutput: vi.fn(),
  }));
  
  const mockSocket = vi.fn();
  
  return {
    NodeEditor: mockNodeEditor,
    ClassicPreset: {
      Node: mockNode,
      Input: vi.fn(),
      Output: vi.fn(),
      Socket: mockSocket,
    },
  };
});

vi.mock('rete-area-plugin', () => {
  const mockAreaPlugin = vi.fn();
  return {
    AreaPlugin: mockAreaPlugin,
    AreaExtensions: {},
  };
});

vi.mock('rete-connection-plugin', () => {
  const mockConnectionPlugin = vi.fn();
  return {
    ConnectionPlugin: mockConnectionPlugin,
    Presets: {
      classic: {
        setup: vi.fn(() => ({})),
      },
    },
  };
});

vi.mock('rete-react-plugin', () => {
  const mockReactPlugin = vi.fn();
  return {
    ReactPlugin: mockReactPlugin,
    Presets: {
      classic: {
        setup: vi.fn(() => ({})),
      },
    },
  };
});

// Mock do logger
vi.mock('./utils/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Importa após os mocks
import { FlowEditor } from './FlowEditor';
import { NodeEditor } from 'rete';
import { AreaPlugin } from 'rete-area-plugin';
import { ConnectionPlugin } from 'rete-connection-plugin';
import { ReactPlugin } from 'rete-react-plugin';

/**
 * Helper para renderizar componentes que precisam do ThemeProvider
 */
function renderWithTheme(component) {
  return render(<ThemeProvider>{component}</ThemeProvider>);
}

describe('FlowEditor', () => {
  let containerElement;
  let onFlowChanged;
  let onNodeSelected;
  let onEvent;
  let mockEditor;
  let mockArea;
  let mockReactRender;
  let mockConnection;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    // Cria instâncias dos mocks
    mockEditor = {
      getNodes: vi.fn(() => []),
      getConnections: vi.fn(() => []),
      getNode: vi.fn((id) => {
        if (id === 'node-1') {
          return {
            id: 'node-1',
            data: { type: 'message', config: { text: 'Hello' } },
            inputs: {},
            outputs: {},
          };
        }
        return null;
      }),
      use: vi.fn(),
      addPipe: vi.fn(),
      removeNode: vi.fn(),
      removeConnection: vi.fn(),
    };

    mockArea = {
      use: vi.fn(),
      addPipe: vi.fn(),
      nodeViews: new Map(),
    };

    mockReactRender = {
      addPreset: vi.fn(),
      update: vi.fn(),
    };

    mockConnection = {
      addPreset: vi.fn(),
    };

    // Setup dos mocks
    vi.mocked(NodeEditor).mockReturnValue(mockEditor);
    vi.mocked(AreaPlugin).mockReturnValue(mockArea);
    vi.mocked(ConnectionPlugin).mockReturnValue(mockConnection);
    vi.mocked(ReactPlugin).mockReturnValue(mockReactRender);

    // Mock do container
    containerElement = document.createElement('div');
    containerElement.style.width = '800px';
    containerElement.style.height = '600px';
    document.body.appendChild(containerElement);

    // Callbacks
    onFlowChanged = vi.fn();
    onNodeSelected = vi.fn();
    onEvent = vi.fn();
  });

  afterEach(() => {
    if (containerElement && containerElement.parentNode) {
      containerElement.parentNode.removeChild(containerElement);
    }
    // Limpa a ref global
    if (typeof window !== 'undefined' && window.__reteNodeSelectedRef) {
      delete window.__reteNodeSelectedRef;
    }
  });

  it('renderiza o editor corretamente', () => {
    const { container } = renderWithTheme(
      <FlowEditor
        onFlowChanged={onFlowChanged}
        onNodeSelected={onNodeSelected}
        onEvent={onEvent}
      />,
    );

    expect(container.querySelector('[style*="background"]')).toBeInTheDocument();
  });

  it('inicializa o editor Rete quando montado', async () => {
    renderWithTheme(
      <FlowEditor
        onFlowChanged={onFlowChanged}
        onNodeSelected={onNodeSelected}
        onEvent={onEvent}
      />,
    );

    await waitFor(() => {
      expect(NodeEditor).toHaveBeenCalled();
      expect(AreaPlugin).toHaveBeenCalled();
      expect(ConnectionPlugin).toHaveBeenCalled();
      expect(ReactPlugin).toHaveBeenCalled();
    });
  });

  it('chama onNodeSelected quando um nó é clicado via data-node-id', async () => {
    const { container } = renderWithTheme(
      <FlowEditor
        onFlowChanged={onFlowChanged}
        onNodeSelected={onNodeSelected}
        onEvent={onEvent}
      />,
    );

    // Aguarda a inicialização completa do editor
    await waitFor(() => {
      expect(NodeEditor).toHaveBeenCalled();
      expect(AreaPlugin).toHaveBeenCalled();
    });

    // Aguarda um pouco mais para garantir que o listener foi adicionado
    await new Promise(resolve => setTimeout(resolve, 100));

    // Encontra o container do editor (onde o listener está)
    const editorContainer = container.querySelector('[style*="background"]');
    expect(editorContainer).toBeInTheDocument();

    // Simula um elemento de nó com data-node-id dentro do container
    const nodeElement = document.createElement('div');
    nodeElement.setAttribute('data-node-id', 'node-1');
    nodeElement.style.width = '200px';
    nodeElement.style.height = '100px';
    nodeElement.style.position = 'absolute';
    nodeElement.style.top = '100px';
    nodeElement.style.left = '100px';
    
    // Adiciona o nó ao container do editor
    editorContainer.appendChild(nodeElement);
    
    // Simula clique no nó (o listener está no container, na fase de captura)
    fireEvent.click(nodeElement, { bubbles: true });

    // Verifica se o callback foi chamado
    await waitFor(() => {
      expect(onNodeSelected).toHaveBeenCalled();
    }, { timeout: 2000 });

    // Verifica os dados passados
    expect(onNodeSelected).toHaveBeenCalledWith({
      id: 'node-1',
      type: 'message',
      config: { text: 'Hello' },
    });
  });

  it('chama onNodeSelected quando um nó é clicado via evento customizado', async () => {
    const { container } = renderWithTheme(
      <FlowEditor
        onFlowChanged={onFlowChanged}
        onNodeSelected={onNodeSelected}
        onEvent={onEvent}
      />,
    );

    // Aguarda a inicialização completa
    await waitFor(() => {
      expect(NodeEditor).toHaveBeenCalled();
    });

    await new Promise(resolve => setTimeout(resolve, 100));

    const editorContainer = container.querySelector('[style*="background"]');
    expect(editorContainer).toBeInTheDocument();

    // Cria um elemento de nó
    const nodeElement = document.createElement('div');
    nodeElement.setAttribute('data-node-id', 'node-1');
    editorContainer.appendChild(nodeElement);

    // Simula o evento customizado que o componente do nó dispara
    const customEvent = new CustomEvent('nodeclick', {
      detail: { nodeId: 'node-1', node: mockEditor.getNode('node-1') },
      bubbles: true,
      cancelable: true,
    });

    // Dispara o evento no container (onde o listener está)
    editorContainer.dispatchEvent(customEvent);

    // Verifica se o callback foi chamado
    await waitFor(() => {
      expect(onNodeSelected).toHaveBeenCalled();
    }, { timeout: 2000 });

    expect(onNodeSelected).toHaveBeenCalledWith({
      id: 'node-1',
      type: 'message',
      config: { text: 'Hello' },
    });
  });

  it('ignora cliques em sockets e conexões', async () => {
    const { container } = renderWithTheme(
      <FlowEditor
        onFlowChanged={onFlowChanged}
        onNodeSelected={onNodeSelected}
        onEvent={onEvent}
      />,
    );

    await waitFor(() => {
      expect(NodeEditor).toHaveBeenCalled();
    });

    await new Promise(resolve => setTimeout(resolve, 100));

    const editorContainer = container.querySelector('[style*="background"]');
    expect(editorContainer).toBeInTheDocument();

    // Simula clique em um socket
    const socketElement = document.createElement('div');
    socketElement.className = 'socket';
    editorContainer.appendChild(socketElement);

    fireEvent.click(socketElement);

    // Aguarda um pouco para garantir que não foi chamado
    await new Promise(resolve => setTimeout(resolve, 100));

    // Não deve chamar onNodeSelected
    expect(onNodeSelected).not.toHaveBeenCalled();
  });

  it('deseleciona nó quando clica fora dele', async () => {
    const { container } = renderWithTheme(
      <FlowEditor
        onFlowChanged={onFlowChanged}
        onNodeSelected={onNodeSelected}
        onEvent={onEvent}
      />,
    );

    await waitFor(() => {
      expect(NodeEditor).toHaveBeenCalled();
    });

    // Simula clique fora de qualquer nó (no container)
    const editorContainer = container.querySelector('[style*="background"]');
    if (editorContainer) {
      fireEvent.click(editorContainer);

      await waitFor(() => {
        expect(onNodeSelected).toHaveBeenCalledWith(null);
      }, { timeout: 2000 });
    }
  });

  it('carrega JSON inicial quando fornecido', async () => {
    const initialFlowJson = {
      id: 'chatbot-flow@0.1.0',
      nodes: {
        'node-1': {
          id: 'node-1',
          data: { type: 'message', config: { text: 'Hello' } },
          position: [100, 100],
          inputs: {},
          outputs: {},
        },
      },
    };

    mockEditor.getNodes.mockReturnValue([
      {
        id: 'node-1',
        data: { type: 'message', config: { text: 'Hello' } },
        inputs: {},
        outputs: {},
      },
    ]);

    renderWithTheme(
      <FlowEditor
        initialFlowJson={initialFlowJson}
        onFlowChanged={onFlowChanged}
        onNodeSelected={onNodeSelected}
        onEvent={onEvent}
      />,
    );

    await waitFor(() => {
      expect(NodeEditor).toHaveBeenCalled();
    });
  });

  it('atualiza selectedNodeId quando prop muda', async () => {
    const { rerender } = renderWithTheme(
      <FlowEditor
        onFlowChanged={onFlowChanged}
        onNodeSelected={onNodeSelected}
        onEvent={onEvent}
        selectedNodeId={null}
      />,
    );

    await waitFor(() => {
      expect(NodeEditor).toHaveBeenCalled();
    });

    // Atualiza para ter um nó selecionado
    rerender(
      <ThemeProvider>
        <FlowEditor
          onFlowChanged={onFlowChanged}
          onNodeSelected={onNodeSelected}
          onEvent={onEvent}
          selectedNodeId="node-1"
        />
      </ThemeProvider>,
    );

    // O componente deve atualizar o contexto
    await waitFor(() => {
      expect(window.__reteNodeSelectedRef).toBeDefined();
    });
  });

  it('expõe editorRef quando fornecido', async () => {
    const editorRef = { current: null };

    renderWithTheme(
      <FlowEditor
        onFlowChanged={onFlowChanged}
        onNodeSelected={onNodeSelected}
        onEvent={onEvent}
        editorRef={editorRef}
      />,
    );

    await waitFor(() => {
      expect(NodeEditor).toHaveBeenCalled();
    });

    // Verifica se a ref foi preenchida
    await waitFor(() => {
      expect(editorRef.current).toBeDefined();
      expect(editorRef.current.editor).toBeDefined();
    }, { timeout: 2000 });
  });

  it('chama onUpdateNodeConfig quando config de nó é atualizado', async () => {
    const onUpdateNodeConfig = vi.fn();
    const editorRef = { current: null };

    renderWithTheme(
      <FlowEditor
        onFlowChanged={onFlowChanged}
        onNodeSelected={onNodeSelected}
        onEvent={onEvent}
        editorRef={editorRef}
        onUpdateNodeConfig={onUpdateNodeConfig}
      />,
    );

    await waitFor(() => {
      expect(editorRef.current).toBeDefined();
      expect(editorRef.current.updateNodeConfig).toBeDefined();
    }, { timeout: 2000 });

    // Chama a função de atualização
    editorRef.current.updateNodeConfig('node-1', { text: 'Updated' });

    // Verifica se o nó foi atualizado
    expect(mockEditor.getNode).toHaveBeenCalledWith('node-1');
  });

  it('aplica tema corretamente', async () => {
    const { container } = renderWithTheme(
      <FlowEditor
        onFlowChanged={onFlowChanged}
        onNodeSelected={onNodeSelected}
        onEvent={onEvent}
      />,
    );

    await waitFor(() => {
      expect(NodeEditor).toHaveBeenCalled();
    });

    // Verifica se o container tem estilos do tema
    const editorContainer = container.querySelector('[style*="background"]');
    expect(editorContainer).toBeInTheDocument();
  });
});
