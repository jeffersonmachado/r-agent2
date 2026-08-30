import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { FlowGeneratorDialog } from './FlowGeneratorDialog';

vi.mock('../utils/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockGenerateFlowFromDescription = vi.fn();
const mockPreviewFlowGenerationPrompt = vi.fn();
vi.mock('../api/flows', () => ({
  generateFlowFromDescription: (...args) => mockGenerateFlowFromDescription(...args),
  previewFlowGenerationPrompt: (...args) => mockPreviewFlowGenerationPrompt(...args),
}));

const mockFetchJson = vi.fn();
vi.mock('../api/client', () => ({
  fetchJson: (...args) => mockFetchJson(...args),
}));

vi.mock('../api/auth', () => ({
  getTenantId: () => 'tenant-test',
}));

const authDouble = vi.hoisted(() => ({
  agent: { id: 'a-dev', role: 'super_admin', classification: 'DEVELOPMENT' },
}));

vi.mock('../context/authContext', () => ({
  useAuth: () => ({
    agent: authDouble.agent,
    capabilities: { inbox: true, caseManagement: true, caseCreationPolicy: 'manual' },
  }),
}));

describe('components/FlowGeneratorDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    authDouble.agent = { id: 'a-dev', role: 'super_admin', classification: 'DEVELOPMENT' };
  });

  afterEach(() => {
    localStorage.clear();
  });

  async function openAdvanced(user) {
    // O conteúdo fica dentro do accordion "Configuração de geração (critérios)"
    await user.click(screen.getByRole('button', { name: /configuração de geração/i }));
  }

  it('Sugerir chama /system/generate-faq e exibe exclusões + perguntas', async () => {
    const user = userEvent.setup();

    mockFetchJson.mockResolvedValue({
      ok: true,
      data: {
        faq: [{ category: 'Geral', questions: ['Qual o horário de atendimento?'] }],
        flatQuestions: ['Qual o horário de atendimento?'],
        exclusions: ['pdf', 'ocr'],
        coverage: 0.5,
        meta: { chunkTextsEffective: 3, chunkCoverageMode: 'relevant' },
      },
    });

    render(<FlowGeneratorDialog onFlowGenerated={vi.fn()} onCancel={vi.fn()} />);

    await user.type(
      screen.getByPlaceholderText(/exemplo: quero um fluxo/i),
      'Quero um fluxo de atendimento'
    );

    await openAdvanced(user);

    await user.click(
      screen.getByLabelText(/incluir perguntas \(faq\) para orientar o fluxo/i)
    );

    await user.click(screen.getByRole('button', { name: /^sugerir$/i }));

    await waitFor(() => {
      expect(mockFetchJson).toHaveBeenCalled();
    });

    const [path, init] = mockFetchJson.mock.calls[0];
    expect(path).toBe('/system/generate-faq');
    expect(init).toMatchObject({ method: 'POST' });
    expect(String(init.body)).toContain('"pipelineStage":"questionsGenerated"');

    // UI: bloco de exclusões + pergunta renderizada
    expect(screen.getByText(/exclusões dinâmicas/i)).toBeInTheDocument();
    expect(screen.getByText(/2 termo\(s\)/i)).toBeInTheDocument();
    expect(screen.getByText('Qual o horário de atendimento?')).toBeInTheDocument();
  });

  it('Gerar Fluxo envia questions combinando sugeridas + manuais (questionsList)', async () => {
    const user = userEvent.setup();

    mockFetchJson.mockResolvedValue({
      ok: true,
      data: {
        flatQuestions: ['Pergunta A?'],
        exclusions: ['x'],
        coverage: 0.2,
      },
    });

    mockGenerateFlowFromDescription.mockResolvedValue({
      flowDefinition: { id: 'flow-1', nodes: [] },
    });
    mockPreviewFlowGenerationPrompt.mockResolvedValue({
      success: true,
      tenantId: 'tenant-test',
      objective: 'Fluxo qualquer',
      promptSummary: 'chatbot.generator.prompt.md',
      ragMeta: { ragUsed: false, ragExecutionId: null, ragSources: [] },
      finalPrompt: 'PROMPT_PREVIEW',
    });

    render(<FlowGeneratorDialog onFlowGenerated={vi.fn()} onCancel={vi.fn()} />);

    await user.type(
      screen.getByPlaceholderText(/exemplo: quero um fluxo/i),
      'Fluxo qualquer'
    );

    await openAdvanced(user);

    await user.click(
      screen.getByLabelText(/incluir perguntas \(faq\) para orientar o fluxo/i)
    );

    // 1) Sugerir -> entra Pergunta A?
    await user.click(screen.getByRole('button', { name: /^sugerir$/i }));
    await waitFor(() => expect(screen.getByText('Pergunta A?')).toBeInTheDocument());

    // 2) Adicionar manual -> Pergunta B?
    await user.type(
      screen.getByPlaceholderText(/digite 1 pergunta por linha/i),
      'Pergunta B?\n'
    );
    await user.click(screen.getByRole('button', { name: /adicionar perguntas/i }));

    // 3) Mostrar prompt -> vai para etapa de confirmação
    await user.click(screen.getByRole('button', { name: /mostrar prompt e continuar/i }));

    await waitFor(() => expect(mockPreviewFlowGenerationPrompt).toHaveBeenCalled());
    expect(screen.getByText(/confira o objetivo e o prompt final/i)).toBeInTheDocument();
    expect(screen.getByText(/PROMPT_PREVIEW/i)).toBeInTheDocument();

    // 4) Confirmar e enviar -> payload deve conter ambas
    await user.click(screen.getByRole('button', { name: /confirmar e enviar/i }));

    await waitFor(() => expect(mockGenerateFlowFromDescription).toHaveBeenCalled());
    const [_desc, options] = mockGenerateFlowFromDescription.mock.calls[0];
    expect(options).toMatchObject({ includeQuestions: true });
    expect(options.questions).toEqual(expect.arrayContaining(['Pergunta A?', 'Pergunta B?']));
  });

  it('exibe a opção de teste RPA apenas para DEVELOPMENT', async () => {
    const user = userEvent.setup();
    render(<FlowGeneratorDialog onFlowGenerated={vi.fn()} onCancel={vi.fn()} />);

    await openAdvanced(user);
    expect(screen.getByText('Gerar teste RPA (opcional)')).toBeInTheDocument();
  });

  it('esconde a opção de teste RPA para PRODUCTION', async () => {
    authDouble.agent = { id: 'a-prod', role: 'operator' };
    const user = userEvent.setup();
    render(<FlowGeneratorDialog onFlowGenerated={vi.fn()} onCancel={vi.fn()} />);

    await openAdvanced(user);
    expect(screen.queryByText('Gerar teste RPA (opcional)')).not.toBeInTheDocument();
  });
});

