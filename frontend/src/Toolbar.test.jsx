import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from './styles/themeContext';
import { Toolbar } from './Toolbar';

/**
 * Helper para renderizar componentes que precisam do ThemeProvider
 */
function renderWithTheme(component) {
  return render(<ThemeProvider>{component}</ThemeProvider>);
}

describe('Toolbar', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renderiza apenas botões com callbacks fornecidos e dispara eventos', async () => {
    const onOpen = vi.fn();
    const onSave = vi.fn();
    const onValidate = vi.fn();
    const onSimulate = vi.fn();

    const { container } = renderWithTheme(
      <Toolbar
        onOpen={onOpen}
        onSave={onSave}
        onValidate={onValidate}
        onSimulate={onSimulate}
      />,
    );

    // Aguarda renderização
    await new Promise(resolve => setTimeout(resolve, 100));

    // Procura pelos botões usando querySelector ou getAllByText
    const saveButton = screen.queryByText('Salvar') || container.querySelector('button[title*="Salvar"]');
    const validateButton = screen.queryByText('Validar') || container.querySelector('button[title*="Validar"]');
    const simulateButton = screen.queryByText('Simular') || container.querySelector('button[title*="Simular"]');

    if (saveButton) {
      await userEvent.click(saveButton);
      expect(onSave).toHaveBeenCalledTimes(1);
    }

    if (validateButton) {
      await userEvent.click(validateButton);
      expect(onValidate).toHaveBeenCalledTimes(1);
    }

    if (simulateButton) {
      await userEvent.click(simulateButton);
      expect(onSimulate).toHaveBeenCalledTimes(1);
    }

    // Verifica que pelo menos um callback foi chamado
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onValidate).toHaveBeenCalledTimes(1);
    expect(onSimulate).toHaveBeenCalledTimes(1);
  });

  it('não renderiza botões quando callbacks não são fornecidos', () => {
    const { container } = renderWithTheme(<Toolbar />);

    // Verifica que não há botões renderizados (apenas o container)
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(0);
  });

  it('renderiza apenas botões com callbacks fornecidos', () => {
    const onSave = vi.fn();
    const onValidate = vi.fn();

    const { container } = renderWithTheme(<Toolbar onSave={onSave} onValidate={onValidate} />);

    // Verifica que apenas os botões com callbacks estão presentes
    const buttons = Array.from(container.querySelectorAll('button'));
    const buttonTexts = buttons.map(btn => btn.textContent);
    
    expect(buttonTexts).toContain('Salvar');
    expect(buttonTexts).toContain('Validar');
    expect(buttonTexts).not.toContain('Carregar');
    expect(buttonTexts).not.toContain('Simular');
    expect(buttonTexts).not.toContain('Importar');
    expect(buttonTexts).not.toContain('Exportar');
  });

  it('renderiza children quando fornecido', async () => {
    const { container } = renderWithTheme(
      <Toolbar>
        <div data-testid="custom-content">Conteúdo customizado</div>
      </Toolbar>,
    );

    // Aguarda renderização
    await new Promise(resolve => setTimeout(resolve, 100));

    // Procura pelo elemento usando querySelector ou getByTestId
    const customContent = screen.queryByTestId('custom-content') || container.querySelector('[data-testid="custom-content"]');
    const customText = screen.queryByText('Conteúdo customizado') || container.querySelector('div:has-text("Conteúdo customizado")');

    // Verifica que o elemento existe
    expect(customContent || customText).toBeTruthy();
    
    // Se encontrou pelo testid, verifica o texto também
    if (customContent) {
      expect(customContent).toBeInTheDocument();
      expect(customContent.textContent).toContain('Conteúdo customizado');
    }
  });
});


