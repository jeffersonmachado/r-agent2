import React, { useState } from 'react';

/**
 * Paleta de nós arrastáveis para criar novos nós no editor
 * Estilo moderno com suporte a temas
 */

// Cores suaves conforme diretrizes: tons suaves, nunca vibrantes
export const NODE_TYPES = [
  { type: 'start', label: 'Start', icon: '●', color: '#4A90E2' },        // Azul suave
  { type: 'message', label: 'Message', icon: '💬', color: '#52C9A2' },    // Verde suave
  { type: 'user_input', label: 'Input', icon: '⌨️', color: '#52C9A2' },  // Verde suave
  { type: 'router', label: 'Router', icon: '🔀', color: '#F5A623' },     // Amarelo suave
  { type: 'set_variable', label: 'Variable', icon: '📝', color: '#7B68EE' }, // Roxo suave
  { type: 'handoff', label: 'Handoff', icon: '👤', color: '#9B59B6' },   // Roxo suave
  { type: 'ai', label: 'AI', icon: '🤖', color: '#16A085' },             // Verde-água suave
  { type: 'end', label: 'End', icon: '■', color: '#95A5A6' },            // Cinza suave
];

/**
 * Componente para mostrar apenas os ícones quando o painel está colapsado
 */
export function NodePaletteCollapsed({ onNodeDragStart, onNodeDragEnd }) {
  const [draggedType, setDraggedType] = useState(null);

  const handleDragStart = (e, nodeType) => {
    setDraggedType(nodeType.type);
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/node-type', nodeType.type);
    e.dataTransfer.setData('text/plain', nodeType.type);
    
    if (onNodeDragStart) {
      onNodeDragStart(nodeType);
    }
  };

  const handleDragEnd = () => {
    setDraggedType(null);
    if (onNodeDragEnd) {
      onNodeDragEnd();
    }
  };

  return (
    <>
      {NODE_TYPES.map((nodeType) => (
        <div
          key={nodeType.type}
          draggable
          onDragStart={(e) => handleDragStart(e, nodeType)}
          onDragEnd={handleDragEnd}
          className={`w-8 h-8 rounded-md cursor-grab flex items-center justify-center text-base mb-2 transition-all duration-fast relative ${
            draggedType === nodeType.type
              ? 'opacity-50 scale-90'
              : 'opacity-100 hover:scale-110'
          } ${
            draggedType === nodeType.type
              ? 'bg-bg-tertiary border-2'
              : 'bg-transparent border border-border-default hover:bg-bg-tertiary hover:border-opacity-50 hover:shadow-md'
          }`}
          style={{
            borderColor: draggedType === nodeType.type ? nodeType.color : undefined,
          }}
          title={nodeType.label}
        >
          {nodeType.icon}
        </div>
      ))}
    </>
  );
}

export function NodePalette({ onNodeDragStart, onNodeDragEnd }) {
  const [draggedType, setDraggedType] = useState(null);

  const handleDragStart = (e, nodeType) => {
    setDraggedType(nodeType.type);
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/node-type', nodeType.type);
    e.dataTransfer.setData('text/plain', nodeType.type);
    
    // Criar uma imagem de drag personalizada
    // Usa variáveis CSS para adaptar ao tema
    const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--color-bg-tertiary') || '#1a1a1a';
    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--color-text-primary') || '#ffffff';
    const dragImage = document.createElement('div');
    dragImage.style.cssText = `
      position: absolute;
      top: -1000px;
      padding: 10px 14px;
      background: ${bgColor.trim() || '#1a1a1a'};
      border: 1px solid ${nodeType.color}60;
      border-radius: 8px;
      color: ${textColor.trim() || '#ffffff'};
      font-size: 13px;
      font-weight: 600;
      pointer-events: none;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    `;
    dragImage.textContent = nodeType.label;
    document.body.appendChild(dragImage);
    e.dataTransfer.setDragImage(dragImage, 0, 0);
    setTimeout(() => document.body.removeChild(dragImage), 0);

    if (onNodeDragStart) {
      onNodeDragStart(nodeType);
    }
  };

  const handleDragEnd = () => {
    setDraggedType(null);
    if (onNodeDragEnd) {
      onNodeDragEnd();
    }
  };

  return (
    <div className="w-[200px] border-r border-border-default bg-gradient-to-b from-bg-secondary to-bg-tertiary p-4 flex flex-col gap-2.5 overflow-y-auto scrollbar-thin scrollbar-thumb-border-default scrollbar-track-transparent">
      <div className="text-[11px] text-text-tertiary uppercase tracking-wider mb-1 font-semibold px-1">
        Nós disponíveis
      </div>
      
      {NODE_TYPES.map((nodeType) => (
        <div
          key={nodeType.type}
          draggable
          onDragStart={(e) => handleDragStart(e, nodeType)}
          onDragEnd={handleDragEnd}
          className={`p-3 rounded-lg cursor-grab active:cursor-grabbing flex items-center gap-3 transition-all duration-200 ${
            draggedType === nodeType.type
              ? 'opacity-40 scale-95'
              : 'opacity-100 hover:scale-[1.02] hover:shadow-md'
          } ${
            draggedType === nodeType.type
              ? 'bg-bg-tertiary border-2'
              : 'bg-bg-tertiary/30 border border-border-default/60 hover:bg-bg-tertiary/50 hover:border-opacity-80'
          }`}
          style={{
            borderColor: draggedType === nodeType.type ? nodeType.color : undefined,
          }}
        >
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center text-sm flex-shrink-0 shadow-md backdrop-blur-sm transition-transform duration-200"
            style={{
              backgroundColor: `${nodeType.color}25`,
              boxShadow: `0 2px 8px ${nodeType.color}30`,
            }}
          >
            {nodeType.icon}
          </div>
          <div className="flex-1 text-sm text-text-primary font-medium">
            {nodeType.label}
          </div>
        </div>
      ))}
    </div>
  );
}

