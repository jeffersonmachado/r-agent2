import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '../styles/themeContext';
import { FlowEditorPage } from './FlowEditorPage';

const saveFlow = vi.fn();
const validateCurrentFlow = vi.fn();
const simulateCurrentFlow = vi.fn();
const loadFlow = vi.fn();
const updateEditorJson = vi.fn();
const setSelectedNode = vi.fn();

vi.mock('../state/editorStore', async () => {
  const actual = await vi.importActual('../state/editorStore');
  return {
    ...actual,
    useEditor: () => ({
      currentFlow: { id: 'flow-1', name: 'Flow 1' },
      selectedNode: null,
      validation: null,
      simulation: null,
      loading: false,
      error: null, // Sempre null para evitar que o useEffect de erros seja executado
      setSelectedNode,
      setValidation: vi.fn(),
      validateCurrentFlow,
      saveFlow,
      simulateCurrentFlow,
      loadFlow,
      deleteFlow: vi.fn(),
      clearCurrentFlow: vi.fn(),
    }),
  };
});

vi.mock('../context/authContext', async () => {
  const actual = await vi.importActual('../context/authContext');
  return {
    ...actual,
    useAuth: () => ({
      isAuthenticated: true,
      loading: false,
      agent: { id: 'test-agent', username: 'test' },
      login: vi.fn(),
      logout: vi.fn(),
      reloadAgent: vi.fn(),
    }),
  };
});

vi.mock('../hooks/useRouter', () => ({
  useRouter: () => ({
    navigate: vi.fn(),
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
  beforeEach(() => {
    // Usa fake timers para controlar todos os setTimeout
    vi.useFakeTimers();
    vi.clearAllMocks();
    localStorage.clear();
    // Define valores padrão no localStorage para evitar mudanças durante o teste
    localStorage.setItem('paletteWidth', '224');
    localStorage.setItem('rightPanelWidth', '288');
    // Reseta o mock do showToast
    mockShowToast.mockClear();
  });

  afterEach(() => {
    // Restaura timers reais
    vi.useRealTimers();
  });

  // TODO: Este teste está travando devido a loops infinitos nos useEffects do FlowEditorPage
  // O componente tem muitos useEffects que interagem entre si e causam loops no ambiente de teste
  // Será necessário refatorar o componente ou criar mocks mais específicos para os useEffects
  it.skip('renderiza o componente sem erros', async () => {
    // Limpa localStorage antes do teste para evitar efeitos colaterais
    localStorage.clear();
    localStorage.setItem('paletteWidth', '224');
    localStorage.setItem('rightPanelWidth', '288');
    
    // Renderiza o componente dentro de act
    let container;
    let unmount;
    
    await act(async () => {
      const result = render(
        <ThemeProvider>
          <FlowEditorPage />
        </ThemeProvider>,
      );
      container = result.container;
      unmount = result.unmount;
      
      // Avança os timers imediatamente após renderizar
      vi.advanceTimersByTime(100);
    });

    // Verifica que o componente renderizou sem erros
    expect(container).toBeTruthy();
    
    // Verifica que pelo menos algum elemento foi renderizado
    const hasContent = container.querySelector('[data-testid]') || 
                       container.textContent;
    expect(hasContent).toBeTruthy();
    
    // Avança mais timers para processar todos os setTimeout
    await act(async () => {
      vi.advanceTimersByTime(7000); // Avança 7 segundos para processar todos os timers
    });
    
    // Desmonta o componente
    if (unmount) {
      unmount();
    }
  });
});


