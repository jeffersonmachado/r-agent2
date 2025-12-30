import React, { useState } from 'react';
import { Dialog } from './Dialog';
import { Button } from '../styles/Button';
import { Input } from '../styles/Input';
import logger from '../utils/logger';

/**
 * Diálogo para salvar fluxo como template
 */
export function SaveAsTemplateDialog({ isOpen, onClose, onSave, flowName = '' }) {
  const [templateName, setTemplateName] = useState(flowName || '');
  const [templateId, setTemplateId] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('📋');

  const handleSave = () => {
    if (!templateName.trim()) {
      logger.warn('Nome do template não pode estar vazio');
      return;
    }

    const templateData = {
      name: templateName.trim(),
      id: templateId.trim() || templateName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
      description: description.trim() || `Template baseado em ${flowName}`,
      icon: icon.trim() || '📋',
    };

    logger.info('Salvando como template', templateData);
    onSave(templateData);
    handleClose();
  };

  const handleClose = () => {
    setTemplateName(flowName || '');
    setTemplateId('');
    setDescription('');
    setIcon('📋');
    onClose();
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      title="Template"
      size="md"
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <div className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium">
            Nome do Template *
          </div>
          <Input
            type="text"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder="Ex.: Fluxo de Suporte"
            className="w-full"
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <div className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium">
            ID do Template (opcional)
          </div>
          <Input
            type="text"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            placeholder="Deixe vazio para gerar automaticamente"
            className="w-full font-mono text-xs"
          />
          <div className="text-[10px] text-text-tertiary">
            Será usado como nome do arquivo JSON
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium">
            Descrição
          </div>
          <Input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Descrição do template"
            className="w-full"
          />
        </div>

        <div className="space-y-2">
          <div className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium">
            Ícone (emoji)
          </div>
          <Input
            type="text"
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            placeholder="📋"
            className="w-full"
            maxLength={2}
          />
        </div>

        <div className="flex gap-2 justify-end pt-4">
          <Button variant="ghost" onClick={handleClose}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={!templateName.trim()}>
            Salvar Template
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

