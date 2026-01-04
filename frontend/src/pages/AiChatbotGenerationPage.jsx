/**
 * Interface de Geração por IA - Chatbot.
 * 
 * Tela controlada que:
 * - Recebe input do usuário
 * - Exibe resultado da geração
 * - Exibe erros estruturados
 * - Linka para resultado de QA
 * 
 * PROIBIDO:
 * - auto-execução
 * - auto-persistência
 * - acesso direto ao executor
 */

import React, { useState } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { generateChatbotFlow } from '../api/aiGeneration';
import { Button } from '../styles/Button';
import { useToast } from '../components/Toast';
import logger from '../utils/logger';

export function AiChatbotGenerationPage() {
  const { agent: currentAgent, isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();

  const [userInput, setUserInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  // Proteção: redireciona para login se não estiver autenticado
  React.useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, authLoading, navigate]);

  const canGenerate = currentAgent?.role === 'admin' || currentAgent?.role === 'supervisor';

  const handleGenerate = async () => {
    if (!userInput.trim()) {
      setError('Por favor, descreva o fluxo que deseja criar.');
      return;
    }

    try {
      setGenerating(true);
      setError(null);
      setResult(null);

      logger.info('[AiChatbotGeneration] Iniciando geração', {
        inputLength: userInput.length
      });

      const generationResult = await generateChatbotFlow(userInput);

      logger.info('[AiChatbotGeneration] Geração concluída', {
        success: generationResult.success,
        domain: generationResult.domain
      });

      setResult(generationResult);

      if (generationResult.success) {
        showToast('Fluxo gerado com sucesso!', 'success');
      } else {
        showToast('Geração falhou. Verifique os erros abaixo.', 'error');
      }
    } catch (err) {
      logger.error('[AiChatbotGeneration] Erro na geração', err);
      setError(err.message || 'Erro ao gerar fluxo. Tente novamente.');
      showToast('Erro ao gerar fluxo', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const handleClear = () => {
    setUserInput('');
    setResult(null);
    setError(null);
  };

  if (authLoading) {
    return <div className="p-6">Carregando...</div>;
  }

  if (!canGenerate) {
    return (
      <div className="p-6">
        <div className="bg-status-error/10 border border-status-error/20 text-status-error p-4 rounded-md">
          Você não tem permissão para acessar esta funcionalidade.
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <ToastContainer />
      
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-text-primary mb-2">
          🤖 Geração de Fluxo de Chatbot por IA
        </h1>
        <p className="text-text-secondary text-sm">
          Descreva o fluxo desejado e a IA gerará um fluxo válido e editável.
        </p>
      </div>

      <div className="space-y-6">
        {/* Input */}
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Descrição do Fluxo
              </label>
              <textarea
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                placeholder="Exemplo: Quero um fluxo que comece com uma mensagem de boas-vindas, reconheça a intenção do usuário (suporte, vendas ou financeiro) e direcione para mensagens específicas."
                className="w-full p-3 border border-border-default rounded-md bg-bg-primary text-text-primary placeholder-text-tertiary resize-none focus:outline-none focus:ring-2 focus:ring-accent-default focus:border-transparent"
                rows={6}
                disabled={generating}
              />
            </div>

            <div className="flex gap-2">
              <Button
                variant="primary"
                onClick={handleGenerate}
                disabled={generating || !userInput.trim()}
              >
                {generating ? 'Gerando...' : 'Gerar Fluxo'}
              </Button>
              <Button
                variant="ghost"
                onClick={handleClear}
                disabled={generating}
              >
                Limpar
              </Button>
            </div>
          </div>
        </div>

        {/* Erro */}
        {error && (
          <div className="bg-status-error/10 border border-status-error/20 text-status-error p-4 rounded-md">
            <strong>Erro:</strong> {error}
          </div>
        )}

        {/* Resultado */}
        {result && (
          <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
            <h2 className="text-lg font-bold text-text-primary mb-4">
              Resultado da Geração
            </h2>

            {result.success ? (
              <div className="space-y-4">
                <div className="bg-status-success/10 border border-status-success/20 text-status-success p-3 rounded-md">
                  <strong>✓ Sucesso:</strong> Fluxo gerado e validado com sucesso.
                </div>

                <div className="space-y-2">
                  <div className="text-sm text-text-secondary">
                    <strong>Domínio:</strong> {result.domain}
                  </div>
                  <div className="text-sm text-text-secondary">
                    <strong>Prompt:</strong> {result.meta?.prompt || 'N/A'}
                  </div>
                  <div className="text-sm text-text-secondary">
                    <strong>Timestamp:</strong> {result.meta?.timestamp ? new Date(result.meta.timestamp).toLocaleString() : 'N/A'}
                  </div>
                </div>

                {result.data?.flow && (
                  <div className="mt-4">
                    <div className="text-sm font-medium text-text-primary mb-2">
                      Fluxo Gerado:
                    </div>
                    <pre className="bg-bg-tertiary p-4 rounded-md overflow-auto text-xs text-text-secondary max-h-96">
                      {JSON.stringify(result.data.flow, null, 2)}
                    </pre>
                  </div>
                )}

                {result.data?.validation && (
                  <div className="mt-4">
                    <div className="text-sm font-medium text-text-primary mb-2">
                      Validação:
                    </div>
                    <div className="bg-bg-tertiary p-3 rounded-md text-sm text-text-secondary">
                      <div>✓ Válido: {result.data.validation.valid ? 'Sim' : 'Não'}</div>
                      <div>Domínio: {result.data.validation.domain}</div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-status-error/10 border border-status-error/20 text-status-error p-3 rounded-md">
                  <strong>✗ Falha:</strong> A geração falhou.
                </div>

                {result.errors && result.errors.length > 0 && (
                  <div>
                    <div className="text-sm font-medium text-text-primary mb-2">
                      Erros:
                    </div>
                    <div className="space-y-2">
                      {result.errors.map((err, index) => (
                        <div key={index} className="bg-bg-tertiary p-3 rounded-md text-sm">
                          <div className="font-medium text-text-primary">
                            {err.code || 'Erro'}
                          </div>
                          <div className="text-text-secondary mt-1">
                            {err.message}
                          </div>
                          <div className="text-text-tertiary text-xs mt-1">
                            Origem: {err.source || 'N/A'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Link para QA */}
            <div className="mt-4 pt-4 border-t border-border-default">
              <a
                href="/qa"
                className="text-sm text-accent-default hover:text-accent-hover underline"
              >
                Ver resultados de QA →
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

