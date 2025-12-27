import React, { useState } from 'react';
import { NODE_TYPES } from '../editor/nodeSchemas';

/**
 * Paleta de nós arrastáveis - versão simplificada e responsiva
 */
export function NodePaletteCollapsed({ onNodeDragStart, onNodeDragEnd }) {
  const [draggedType, setDraggedType] = useState(null);

  const handleDragStart = (e, nodeType) => {
    setDraggedType(nodeType.type);
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/node-type', nodeType.type);
    e.dataTransfer.setData('text/plain', nodeType.type);
    if (onNodeDragStart) onNodeDragStart(nodeType);
  };

  const handleDragEnd = () => {
    setDraggedType(null);
    if (onNodeDragEnd) onNodeDragEnd();
  };

  return (
    <div className="node-palette-collapsed">
      {NODE_TYPES.map((nodeType) => (
        <button
          key={nodeType.type}
          draggable
          onDragStart={(e) => handleDragStart(e, nodeType)}
          onDragEnd={handleDragEnd}
          className={`node-palette-item-collapsed ${
            draggedType === nodeType.type ? 'node-palette-item--dragging' : ''
          }`}
          data-node-type={nodeType.type}
          style={{ '--node-color': nodeType.color }}
          title={nodeType.label}
        >
          {nodeType.icon}
        </button>
      ))}
    </div>
  );
}

export function NodePalette({ onNodeDragStart, onNodeDragEnd }) {
  const [draggedType, setDraggedType] = useState(null);

  const handleDragStart = (e, nodeType) => {
    setDraggedType(nodeType.type);
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/node-type', nodeType.type);
    e.dataTransfer.setData('text/plain', nodeType.type);
    
    const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--color-bg-tertiary') || '#1a1a1a';
    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--color-text-primary') || '#ffffff';
    const dragImage = document.createElement('div');
    dragImage.className = 'node-palette-drag-image';
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

    if (onNodeDragStart) onNodeDragStart(nodeType);
  };

  const handleDragEnd = () => {
    setDraggedType(null);
    if (onNodeDragEnd) onNodeDragEnd();
  };

  return (
    <>
      {NODE_TYPES.map((nodeType) => (
        <div
          key={nodeType.type}
          draggable
          onDragStart={(e) => handleDragStart(e, nodeType)}
          onDragEnd={handleDragEnd}
          className="flex items-center gap-2 cursor-move hover:opacity-80"
          data-node-type={nodeType.type}
          title={nodeType.label}
        >
          <span className="node-palette-item-icon">{nodeType.icon}</span>
          <span className="inline">{nodeType.label}</span>
        </div>
      ))}
    </>
  );
}
