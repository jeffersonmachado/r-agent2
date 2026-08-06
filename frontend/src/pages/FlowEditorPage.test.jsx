import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const saveFlow = vi.fn();
const validateCurrentFlow = vi.fn();
const simulateCurrentFlow = vi.fn();
const loadFlow = vi.fn();
const updateEditorJson = vi.fn();
const setSelectedNode = vi.fn();

// Mock estável do editorStore para evitar loops infinitos
const mockSetValidation = vi.fn();
const mockDeleteFlow = vi.fn();
const mockClearCurrentFlow = vi.fn();
let mockValidation = null;

vi.mock('../state/editorStore', async () => {
  const actual = await vi.importActual('../state/editorStore');
  // Cria valores estáveis que não mudam entre renders
  const stableCurrentFlow = {
    id: 'flow-1',
    name: 'Flow 1',
    nodes: [],
    metadata: {
      aiGeneration: {
        usedFallback: false,
        qualityScore: 100,
        attempts: [{ attempt: 1, ok: false }, { attempt: 2, ok: true }],
      },
    },
  };
  return {
    ...actual,
    useEditor: () => ({
      currentFlow: stableCurrentFlow,
      selectedNode: null,
      validation: mockValidation,
      simulation: null,
      loading: false,
      error: null, // Sempre null para evitar que o useEffect de erros seja executado
      setSelectedNode,
      setValidation: mockSetValidation,
      validateCurrentFlow,
      saveFlow,
      simulateCurrentFlow,
      loadFlow,
      deleteFlow: mockDeleteFlow,
      clearCurrentFlow: mockClearCurrentFlow,
    }),
  };
});

let mockIsAuthenticated = true;

vi.mock('../context/authContext', async () => {
  const actual = await vi.importActual('../context/authContext');
  return {
    ...actual,
    useAuth: () => ({
      isAuthenticated: mockIsAuthenticated,
      loading: false,
      agent: { id: 'test-agent', username: 'test' },
      login: vi.fn(),
      logout: vi.fn(),
      reloadAgent: vi.fn(),
    }),
  };
});

// Mock estável do useRouter para evitar loops infinitos
const mockNavigate = vi.fn();
vi.mock('../hooks/useRouter', () => ({
  useRouter: () => ({
    navigate: mockNavigate,
    currentPath: '/editor',
  }),
}));

vi.mock('../engine-mapper/engineMapper', () => ({
  engineFlowToReteJson: vi.fn(() => ({ nodes: {}, connections: [] })),
  reteJsonToEngineFlow: vi.fn((json) => ({ id: 'flow-1', nodes: [] })),
}));

vi.mock('../utils/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../api/flows', () => ({
  createFlow: vi.fn(),
  saveTemplate: vi.fn(),
}));

// Mock do FlowEditor será definido no teste

vi.mock('../SidebarProperties', () => ({
  SidebarProperties: () => <div data-testid="sidebar-properties-mock" />,
}));

vi.mock('../simulator/SimulationPanel', () => ({
  SimulationPanel: () => <div data-testid="simulation-panel-mock" />,
}));

vi.mock('../Toolbar', () => ({
  Toolbar: ({ onSave, onValidate, onSimulate, onTest, children }) => (
    <div data-testid="toolbar-mock">
      <button type="button" onClick={onSave}>
        Salvar
      </button>
      <button type="button" onClick={onValidate}>
        Validar
      </button>
      <button type="button" onClick={onSimulate}>
        Simular
      </button>
      {onTest && (
        <button type="button" onClick={onTest}>
          Testar
        </button>
      )}
      {children}
    </div>
  ),
}));

// Mock estável do useToast para evitar loops infinitos
const mockShowToast = vi.fn();
vi.mock('../components/Toast', () => ({
  useToast: () => ({
    showToast: mockShowToast, // Função estável que não muda entre renders
    ToastContainer: () => null,
  }),
}));

vi.mock('../components/Dialog', () => ({
  Dialog: ({ children, open }) => (open ? <div>{children}</div> : null),
}));

vi.mock('../components/ConfirmDialog', () => ({
  ConfirmDialog: () => null,
}));

vi.mock('../components/FlowSelector', () => ({
  FlowSelector: () => <div data-testid="flow-selector-mock" />,
}));

vi.mock('../components/NodePalette', () => ({
  NodePalette: () => <div data-testid="node-palette-mock" />,
  NodePaletteCollapsed: () => <div data-testid="node-palette-collapsed-mock" />,
}));

vi.mock('../components/ResizableDivider', () => ({
  ResizableDivider: ({ children }) => <div>{children}</div>,
}));

vi.mock('../components/FlowGeneratorDialog', () => ({
  FlowGeneratorDialog: () => null,
}));

vi.mock('../components/SaveAsTemplateDialog', () => ({
  SaveAsTemplateDialog: () => null,
}));

vi.mock('../components/LogViewer', () => ({
  LogViewer: () => null,
}));

vi.mock('../components/FlowTestChat', () => ({
  FlowTestChat: () => null,
}));

vi.mock('../components/NavigationLink', () => ({
  NavigationLink: () => null,
}));

vi.mock('../components/FallbackEventsViewer', () => ({
  FallbackEventsViewer: () => null,
}));

vi.mock('../components/ThemeSelector', () => ({
  ThemeSelector: () => null,
}));

vi.mock('../components/FlowTemplateSelector', () => ({
  FlowTemplateSelector: () => null,
}));

// Mock do useTheme - deve ser estável para evitar loops
vi.mock('../styles/themeContext', async () => {
  const actual = await vi.importActual('../styles/themeContext');
  return {
    ...actual,
    useTheme: () => ({
      themeName: 'dark',
      theme: {},
      toggleTheme: vi.fn(),
    }),
  };
});

vi.mock('../editor/flowValidator', async () => {
  return {
    validateFlow: vi.fn(() => ({ valid: true, errors: [] })),
  };
});

// Mock do FlowEditor - versão simplificada que não executa lógica
vi.mock('../FlowEditor', () => ({
  FlowEditor: React.memo(React.forwardRef((props, ref) => {
    // Não executa useImperativeHandle para evitar efeitos colaterais
    return <div data-testid="flow-editor-mock" />;
  })),
}));

describe('pages/FlowEditorPage', () => {
  // Timeout global para todos os testes deste describe
  const TEST_TIMEOUT = 15000;
  
  beforeEach(() => {
    // Com isolate=false no Vitest, garantimos cache limpo para evitar
    // interferência de mocks/imports vindos de outros arquivos.
    vi.resetModules();
    mockValidation = null;
    mockIsAuthenticated = true;
    // Usa fake timers para controlar todos os setTimeout
    vi.useFakeTimers();
    vi.clearAllMocks();
    // Garante layout desktop para manter o painel de validação expandido
    window.innerWidth = 1024;
    window.dispatchEvent(new Event('resize'));
    localStorage.clear();
    // Define valores padrão no localStorage para evitar mudanças durante o teste
    localStorage.setItem('paletteWidth', '224');
    localStorage.setItem('rightPanelWidth', '288');
    // Reseta todos os mocks
    mockShowToast.mockClear();
    mockNavigate.mockClear();
    mockSetValidation.mockClear();
    mockDeleteFlow.mockClear();
    mockClearCurrentFlow.mockClear();
  });

  afterEach(() => {
    // Restaura timers reais
    vi.useRealTimers();
    // Limpa localStorage
    localStorage.clear();
    // Limpa todos os timers pendentes
    vi.clearAllTimers();
    // Força garbage collection se disponível
    if (global.gc) {
      global.gc();
    }
  });

  it('renderiza o componente sem erros', async () => {
    vi.useRealTimers();

    let container;
    let unmount;

    await act(async () => {
      const { FlowEditorPage } = await import('./FlowEditorPage');
      const { ThemeProvider } = await import('../styles/themeContext');
      const { WebSocketProvider } = await import('../context/WebSocketContext');
      const result = render(
        <ThemeProvider>
          <WebSocketProvider>
            <FlowEditorPage />
          </WebSocketProvider>
        </ThemeProvider>,
      );
      container = result.container;
      unmount = result.unmount;
    });

    expect(container).toBeTruthy();

    const hasContent = container?.querySelector('[data-testid]') ||
      container?.querySelector('div') ||
      (container?.textContent && container.textContent.trim().length > 0);

    if (hasContent) {
      expect(hasContent).toBeTruthy();
    }

    if (unmount) {
      unmount();
    }
  }, TEST_TIMEOUT);

  it('mostra warnings na seção Validação', async () => {
    // `valid: true` pode vir acompanhado de warnings/info.
    mockValidation = {
      valid: true,
      errors: [
        {
          code: 'SAMPLE_WARNING',
          message: 'warning técnico',
          messageUi: 'Este é um warning',
          severity: 'warning',
          nodeIds: [],
        },
      ],
      uiErrors: [
        {
          code: 'SAMPLE_WARNING',
          message: 'warning técnico',
          messageUi: 'Este é um warning',
          severity: 'warning',
          nodeIds: [],
        },
      ],
    };

    await act(async () => {
      const { FlowEditorPage } = await import('./FlowEditorPage');
      const { ThemeProvider } = await import('../styles/themeContext');
      const { WebSocketProvider } = await import('../context/WebSocketContext');
      render(
        <ThemeProvider>
          <WebSocketProvider>
            <FlowEditorPage />
          </WebSocketProvider>
        </ThemeProvider>,
      );
    });

    // Em alguns ambientes de teste a seção pode iniciar colapsada (window.innerWidth < 768).
    const validationHeader = screen.getByText('Validação').closest('.section-header');
    const toggleBtn = validationHeader?.querySelector('button');
    if (toggleBtn?.getAttribute('title') === 'Expandir') {
      await act(async () => {
        toggleBtn.click();
      });
    }

    // O painel "Validação" deve listar warnings também.
    // OBS: usamos fake timers nesse arquivo; portanto evitamos `findBy*`/`waitFor`.
    expect(screen.getByText('Este é um warning')).toBeTruthy();
    expect(screen.getByText('[SAMPLE_WARNING]')).toBeTruthy();
    expect(screen.getByText('WARNING')).toBeTruthy();
  }, TEST_TIMEOUT);

  it('não quebra quando a sessão expira com a página montada', async () => {
    // Regressão: hooks declarados após early returns causavam
    // "Rendered fewer hooks than expected" quando isAuthenticated virava false.
    vi.useRealTimers();

    let rerender;
    let unmount;

    await act(async () => {
      const { FlowEditorPage } = await import('./FlowEditorPage');
      const { ThemeProvider } = await import('../styles/themeContext');
      const { WebSocketProvider } = await import('../context/WebSocketContext');
      const result = render(
        <ThemeProvider>
          <WebSocketProvider>
            <FlowEditorPage />
          </WebSocketProvider>
        </ThemeProvider>,
      );
      rerender = result.rerender;
      unmount = result.unmount;
    });

    const { FlowEditorPage } = await import('./FlowEditorPage');
    const { ThemeProvider } = await import('../styles/themeContext');
    const { WebSocketProvider } = await import('../context/WebSocketContext');

    // Simula expiração da sessão com a página já montada
    mockIsAuthenticated = false;
    await act(async () => {
      rerender(
        <ThemeProvider>
          <WebSocketProvider>
            <FlowEditorPage />
          </WebSocketProvider>
        </ThemeProvider>,
      );
    });

    expect(mockNavigate).toHaveBeenCalledWith('/login');

    if (unmount) {
      unmount();
    }
  }, TEST_TIMEOUT);

  // Observação: o badge IA/Fallback (score/tentativas) é testado em `FlowCurrentDisplay.test.jsx`
});
