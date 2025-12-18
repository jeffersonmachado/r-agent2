import React, { useState } from 'react';
import { flowTemplates, createFlowFromTemplate } from '../templates/flowTemplates';
import { Button } from '../styles/Button';
import { Input } from '../styles/Input';
import { Dialog } from './Dialog';
import logger from '../utils/logger';

/**
 * Seletor de modelos de fluxo para criar novos fluxos
 */
export function FlowTemplateSelector({ onTemplateSelected, onCancel }) {
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [customName, setCustomName] = useState('');
  const [customId, setCustomId] = useState('');

  const handleSelectTemplate = (template) => {
    setSelectedTemplate(template);
    setCustomName(`${template.name} (cópia)`);
    setCustomId('');
  };

  const handleCreate = () => {
    logger.info('Botão Criar Fluxo clicado', { 
      hasTemplate: !!selectedTemplate,
      templateId: selectedTemplate?.id,
      customId,
      customName 
    });
    
    if (!selectedTemplate) {
      logger.warn('Tentativa de criar fluxo sem template selecionado');
      return;
    }

    logger.debug('Criando fluxo do template', { 
      templateId: selectedTemplate.id,
      templateName: selectedTemplate.name 
    });

    const flow = createFlowFromTemplate(
      selectedTemplate,
      customId || undefined,
      customName || undefined,
    );

    logger.info('Fluxo criado do template', { 
      flowId: flow?.id,
      flowName: flow?.name,
      nodeCount: flow?.nodes?.length || 0 
    });

    if (onTemplateSelected) {
      logger.debug('Chamando onTemplateSelected callback', { flowId: flow?.id });
      onTemplateSelected(flow);
    } else {
      logger.error('onTemplateSelected não está definido!');
    }
  };

  const handleCancel = () => {
    setSelectedTemplate(null);
    setCustomName('');
    setCustomId('');
    if (onCancel) {
      onCancel();
    }
  };

  if (selectedTemplate) {
    return (
      <Dialog
        isOpen={true}
        onClose={handleCancel}
        title={`Criar fluxo: ${selectedTemplate.name}`}
        size="md"
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium">
              Nome do fluxo
            </div>
            <Input
              type="text"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder={selectedTemplate.name}
              className="w-full"
            />
          </div>

          <div className="space-y-2">
            <div className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium">
              ID do fluxo (opcional)
            </div>
            <Input
              type="text"
              value={customId}
              onChange={(e) => setCustomId(e.target.value)}
              placeholder="Deixe vazio para gerar automaticamente"
              className="w-full font-mono text-xs"
            />
          </div>

          <div className="text-xs text-text-secondary p-3 bg-bg-tertiary rounded-md">
            {selectedTemplate.description}
          </div>

          <div className="flex gap-2 justify-end pt-4">
            <Button variant="ghost" onClick={handleCancel}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleCreate}>
              Criar Fluxo
            </Button>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      isOpen={true}
      onClose={handleCancel}
      title="Criar Novo Fluxo"
      size="xl"
    >
      <div className="space-y-6">
        <p className="text-sm text-text-secondary">
          Selecione um modelo para começar
        </p>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
          {flowTemplates.map((template) => (
            <div
              key={template.id}
              onClick={() => handleSelectTemplate(template)}
              className="p-4 rounded-md border border-border-default bg-bg-tertiary cursor-pointer transition-all duration-fast hover:border-border-hover hover:bg-bg-hover hover:-translate-y-0.5 hover:shadow-lg hover:shadow-accent-light"
            >
              <div className="text-3xl mb-2 text-center">{template.icon}</div>
              <div className="text-sm font-semibold text-text-primary mb-1 text-center">
                {template.name}
              </div>
              <div className="text-[11px] text-text-tertiary text-center leading-snug">
                {template.description}
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end pt-4">
          <Button variant="ghost" onClick={handleCancel}>
            Cancelar
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

