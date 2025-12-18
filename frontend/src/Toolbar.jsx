import React from 'react';
import { Button } from './styles/Button';
import { Input } from './styles/Input';

/**
 * Barra de ferramentas superior do editor - estilo moderno
 */
export function Toolbar({
  onImportJson,
  onExportJson,
  onSimulate,
  onSave,
  onValidate,
  onLoadFlow,
  children,
}) {
  return (
    <div className="flex gap-2.5 px-5 py-3.5 border-b border-border-default bg-gradient-to-r from-bg-secondary via-bg-secondary to-bg-tertiary items-center min-h-[56px] backdrop-blur-sm shadow-sm">
      {onLoadFlow && (
        <Button variant="ghost" size="sm" onClick={onLoadFlow}>
          Carregar
        </Button>
      )}

      {onSave && (
        <Button variant="ghost" size="sm" onClick={onSave}>
          Salvar
        </Button>
      )}

      {onValidate && (
        <Button variant="ghost" size="sm" onClick={onValidate}>
          Validar
        </Button>
      )}

      {onImportJson && (
        <Button variant="ghost" size="sm" onClick={onImportJson}>
          Importar
        </Button>
      )}

      {onExportJson && (
        <Button variant="ghost" size="sm" onClick={onExportJson}>
          Exportar
        </Button>
      )}

      <div className="ml-auto flex items-center gap-3">
        {children}
        {onSimulate && (
          <Button variant="primary" size="sm" onClick={onSimulate}>
            Simular
          </Button>
        )}
      </div>
    </div>
  );
}


