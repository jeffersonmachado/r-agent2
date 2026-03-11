import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CanonicalAnalysisPanel from './CanonicalAnalysisPanel';

describe('CanonicalAnalysisPanel', () => {
  const mockCanonical = {
    validationReport: {
      valid: false,
      errors: [
        {
          code: 'canonical_ai_task_missing_config',
          message: 'AI task node_2 must define prompt or task configuration.',
          nodeIds: ['node_2'],
        },
      ],
      warnings: [
        {
          code: 'canonical_orphan_nodes',
          message: 'There are nodes unreachable from process entrypoints.',
          nodeIds: ['node_5'],
        },
      ],
      suggestions: [
        {
          code: 'canonical_high_fanout_non_gateway',
          message: 'Node node_1 has high fan-out and should likely be modeled as a gateway.',
          nodeIds: ['node_1'],
        },
      ],
    },
    compilationReport: {},
    compiledProcessDefinition: {
      id: 'test-process',
      nodes: [
        { id: 'node_1', type: 'start' },
        { id: 'node_2', type: 'task.service' },
        { id: 'node_3', type: 'end' },
      ],
    },
  };

  const mockFlow = {
    nodes: [
      { id: '1', type: 'start', config: {} },
      { id: '2', type: 'api', config: {} },
      { id: '3', type: 'end', config: {} },
    ],
  };

  describe('rendering', () => {
    it('deve retornar null quando canonical é null', () => {
      const { container } = render(
        <CanonicalAnalysisPanel canonical={null} currentFlow={mockFlow} />
      );
      expect(container.firstChild).toBeNull();
    });

    it('deve renderizar header com status válido quando processo é válido', () => {
      const validCanonical = {
        ...mockCanonical,
        validationReport: {
          ...mockCanonical.validationReport,
          valid: true,
          errors: [],
        },
      };

      render(
        <CanonicalAnalysisPanel canonical={validCanonical} currentFlow={mockFlow} />
      );

      expect(screen.getByText(/Análise Canônica/i)).toBeInTheDocument();
      expect(screen.getByText('✓ Válido')).toBeInTheDocument();
    });

    it('deve renderizar header com status inválido quando processo tem erros', () => {
      render(
        <CanonicalAnalysisPanel canonical={mockCanonical} currentFlow={mockFlow} />
      );

      expect(screen.getByText(/Análise Canônica/i)).toBeInTheDocument();
      expect(screen.getByText('✗ Inválido')).toBeInTheDocument();
    });

    it('deve exibir contadores de erros nas abas', () => {
      render(
        <CanonicalAnalysisPanel canonical={mockCanonical} currentFlow={mockFlow} />
      );

      const validacaoButton = screen.getByText('Validação');
      expect(validacaoButton).toBeInTheDocument();
      expect(screen.getByText('1', { selector: '.bg-red-500' })).toBeInTheDocument();
      expect(screen.getByText('1', { selector: '.bg-blue-500' })).toBeInTheDocument();
    });
  });

  describe('tabs', () => {
    it('deve exibir aba Validação por padrão', () => {
      render(
        <CanonicalAnalysisPanel canonical={mockCanonical} currentFlow={mockFlow} />
      );

      expect(screen.getByText(mockCanonical.validationReport.errors[0].message)).toBeInTheDocument();
    });

    it('deve alternar para aba Sugestões ao clique', () => {
      render(
        <CanonicalAnalysisPanel canonical={mockCanonical} currentFlow={mockFlow} />
      );

      const sugestoesButton = screen.getByText('Sugestões');
      fireEvent.click(sugestoesButton);

      expect(
        screen.getByText(mockCanonical.validationReport.suggestions[0].message)
      ).toBeInTheDocument();
    });

    it('deve alternar para aba Gap Analysis ao clique', () => {
      render(
        <CanonicalAnalysisPanel canonical={mockCanonical} currentFlow={mockFlow} />
      );

      const gapButton = screen.getByText('Gap Analysis');
      fireEvent.click(gapButton);

      expect(screen.getByText(/Status de Execução:/i)).toBeInTheDocument();
      expect(screen.getByText(/Requisitos de Operação/i)).toBeInTheDocument();
    });
  });

  describe('ValidationTab', () => {
    it('deve exibir erros corretamente', () => {
      render(
        <CanonicalAnalysisPanel canonical={mockCanonical} currentFlow={mockFlow} />
      );

      expect(screen.getByText(/Erros \(1\)/i)).toBeInTheDocument();
      expect(screen.getByText(mockCanonical.validationReport.errors[0].message)).toBeInTheDocument();
      expect(screen.getByText(/Nós: node_2/)).toBeInTheDocument();
    });

    it('deve exibir warnings corretamente', () => {
      render(
        <CanonicalAnalysisPanel canonical={mockCanonical} currentFlow={mockFlow} />
      );

      expect(screen.getByText(/Alertas \(1\)/i)).toBeInTheDocument();
      expect(screen.getByText(mockCanonical.validationReport.warnings[0].message)).toBeInTheDocument();
    });

    it('deve exibir mensagem quando sem erros/warnings', () => {
      const cleanCanonical = {
        ...mockCanonical,
        validationReport: {
          ...mockCanonical.validationReport,
          valid: true,
          errors: [],
          warnings: [],
        },
      };

      render(
        <CanonicalAnalysisPanel canonical={cleanCanonical} currentFlow={mockFlow} />
      );

      expect(screen.getByText(/Nenhum erro ou alerta encontrado/i)).toBeInTheDocument();
    });
  });

  describe('GapAnalysisTab', () => {
    it('deve avaliar processo com start e end como pronto', () => {
      render(
        <CanonicalAnalysisPanel canonical={mockCanonical} currentFlow={mockFlow} />
      );

      const gapButton = screen.getByText('Gap Analysis');
      fireEvent.click(gapButton);

      expect(screen.getByText('✓ Pronto para Execução')).toBeInTheDocument();
    });

    it('deve avaliar processo sem end como parcial', () => {
      const incompleteFlow = {
        nodes: [
          { id: '1', type: 'start', config: {} },
          { id: '2', type: 'api', config: {} },
        ],
      };

      render(
        <CanonicalAnalysisPanel canonical={mockCanonical} currentFlow={incompleteFlow} />
      );

      const gapButton = screen.getByText('Gap Analysis');
      fireEvent.click(gapButton);

      expect(screen.getByText('⚠️ Execução Parcial')).toBeInTheDocument();
      expect(screen.getByText(/Adicione um nó de fim/i)).toBeInTheDocument();
    });

    it('deve contar total de nós corretamente', () => {
      render(
        <CanonicalAnalysisPanel canonical={mockCanonical} currentFlow={mockFlow} />
      );

      const gapButton = screen.getByText('Gap Analysis');
      fireEvent.click(gapButton);

      expect(screen.getByText(/Total de Nós:/)).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
    });
  });

  describe('footer', () => {
    it('deve exibir resumo de erros, alertas e sugestões', () => {
      render(
        <CanonicalAnalysisPanel canonical={mockCanonical} currentFlow={mockFlow} />
      );

      expect(screen.getByText(/1 erro\(s\)/)).toBeInTheDocument();
      expect(screen.getByText(/1 alerta\(s\)/)).toBeInTheDocument();
      expect(screen.getByText(/1 sugestão\(ões\)/)).toBeInTheDocument();
    });
  });
});
