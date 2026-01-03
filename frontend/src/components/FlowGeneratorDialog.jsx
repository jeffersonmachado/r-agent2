import React, { useState } from 'react';
import { generateFlowFromDescription } from '../api/flows';
import { Button } from '../styles/Button';
import { Input } from '../styles/Input';
import { Dialog } from './Dialog';
import logger from '../utils/logger';

/**
 * Diálogo para gerar fluxos a partir de descrições em linguagem natural.
 */
export function FlowGeneratorDialog({ onFlowGenerated, onCancel }) {
  const [description, setDescription] = useState('');
  const [flowName, setFlowName] = useState('');
  const [flowId, setFlowId] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  const handleGenerate = async () => {
    if (!description.trim()) {
      setError('Por favor, descreva o fluxo que deseja criar.');
      return;
    }

    try {
      setGenerating(true);
      setError(null);

      logger.info('Iniciando geração de fluxo', { 
        description: description.substring(0, 100),
        flowName,
        flowId 
      });

      const generatedFlow = await generateFlowFromDescription(description, {
        flowName: flowName || undefined,
        flowId: flowId || undefined,
      });

      logger.info('Fluxo gerado com sucesso', { 
        flowId: generatedFlow?.id,
        nodeCount: generatedFlow?.nodes?.length || 0 
      });

      if (onFlowGenerated) {
        onFlowGenerated(generatedFlow);
      }
    } catch (err) {
      logger.error('Erro ao gerar fluxo', err);
      setError(err.message || 'Erro ao gerar fluxo. Tente novamente.');
    } finally {
      setGenerating(false);
    }
  };

  const handleCancel = () => {
    setDescription('');
    setFlowName('');
    setFlowId('');
    setError(null);
    if (onCancel) {
      onCancel();
    }
  };

  return (
    <Dialog
      isOpen={true}
      onClose={handleCancel}
      title="Gerar Fluxo com IA"
      size="lg"
    >
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="text-sm text-text-secondary">
            Descreva o fluxo que você deseja criar em linguagem natural. 
            Por exemplo: "Quero um fluxo que ofereça atendimento humano" ou 
            "Crie um fluxo que reconheça intenções e direcione para diferentes mensagens".
          </div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Exemplo: Quero um fluxo que comece com uma mensagem de boas-vindas, reconheça a intenção do usuário (suporte, vendas ou financeiro) e direcione para mensagens específicas. Se não entender, deve transferir para atendimento humano."
            className="w-full p-3 border border-border-default rounded-md bg-bg-primary text-text-primary placeholder-text-tertiary resize-none focus:outline-none focus:ring-2 focus:ring-accent-default focus:border-transparent"
            rows={6}
            disabled={generating}
          />
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium">
              Nome do fluxo (opcional)
            </div>
            <Input
              type="text"
              value={flowName}
              onChange={(e) => setFlowName(e.target.value)}
              placeholder="Deixe vazio para usar nome padrão"
              className="w-full"
              disabled={generating}
            />
          </div>

          <div className="space-y-2">
            <div className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium">
              ID do fluxo (opcional)
            </div>
            <Input
              type="text"
              value={flowId}
              onChange={(e) => setFlowId(e.target.value)}
              placeholder="Deixe vazio para gerar automaticamente"
              className="w-full font-mono text-xs"
              disabled={generating}
            />
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-md bg-status-error/10 border border-status-error/20 text-status-error text-sm">
            {error}
          </div>
        )}

        <div className="text-xs text-text-tertiary p-3 bg-bg-tertiary rounded-md">
          <strong>Dica:</strong> Seja específico na descrição. Mencione se você quer:
          <ul className="list-disc list-inside mt-2 space-y-1">
            <li>Mensagens ao usuário</li>
            <li>Reconhecimento de intenções</li>
            <li>Roteamento baseado em condições</li>
            <li>Transferência para atendimento humano</li>
            <li>Outras funcionalidades específicas</li>
          </ul>
        </div>

        <div className="flex gap-2 justify-end pt-4">
          <Button variant="ghost" onClick={handleCancel} disabled={generating}>
            Cancelar
          </Button>
          <Button 
            variant="primary" 
            onClick={handleGenerate}
            disabled={generating || !description.trim()}
          >
            {generating ? 'Gerando...' : 'Gerar Fluxo'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

