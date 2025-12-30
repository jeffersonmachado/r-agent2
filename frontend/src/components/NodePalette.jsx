import React, { useState } from 'react';
import { NODE_TYPES } from '../editor/nodeSchemas';

/**
 * Tipos de nós de sistema
 */
const SYSTEM_NODE_TYPES = [
  'get_config_value',
  'get_flow_info',
  'get_queue_status',
  'list_flows',
  'get_current_time',
  'generate_uuid',
  'delay',
  'format_date',
  'random_number',
  'get_user_info',
];

/**
 * Separa nós de sistema dos outros nós
 */
function categorizeNodes() {
  const systemNodes = [];
  const otherNodes = [];

  NODE_TYPES.forEach(nodeType => {
    if (SYSTEM_NODE_TYPES.includes(nodeType.type)) {
      systemNodes.push(nodeType);
    } else {
      otherNodes.push(nodeType);
    }
  });

  return { systemNodes, otherNodes };
}

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

  const { systemNodes, otherNodes } = categorizeNodes();

  return (
    <div className="node-palette-collapsed">
      {otherNodes.map((nodeType) => (
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
      {/* Botão Sistema na versão colapsada */}
      {systemNodes.length > 0 && (
        <button
          draggable={false}
          className="node-palette-item-collapsed"
          title="Sistema"
        >
          ⚙️
        </button>
      )}
    </div>
  );
}

export function NodePalette({ onNodeDragStart, onNodeDragEnd }) {
  const [draggedType, setDraggedType] = useState(null);
  const [isSystemExpanded, setIsSystemExpanded] = useState(false);

  const handleDragStart = (e, nodeType) => {
    setDraggedType(nodeType.type);
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/node-type', nodeType.type);
    e.dataTransfer.setData('text/plain', nodeType.type);
    
    const dragImage = document.createElement('div');
    dragImage.className = 'node-palette-drag-image';
    dragImage.style.setProperty('--node-color', nodeType.color);
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

  const { systemNodes, otherNodes } = categorizeNodes();

  return (
    <>
      {otherNodes.map((nodeType) => (
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
      
      {/* Item Sistema com subitens */}
      {systemNodes.length > 0 && (
        <div className="node-palette-category">
          <div
            className="flex items-center gap-2 cursor-pointer hover:opacity-80 select-none"
            onClick={() => setIsSystemExpanded(!isSystemExpanded)}
          >
            <span className="node-palette-item-icon">{isSystemExpanded ? '▼' : '▶'}</span>
            <span className="inline font-medium">Sistema</span>
          </div>
          {isSystemExpanded && (
            <div className="ml-4 mt-1 space-y-1">
              {systemNodes.map((nodeType) => (
                <div
                  key={nodeType.type}
                  draggable
                  onDragStart={(e) => handleDragStart(e, nodeType)}
                  onDragEnd={handleDragEnd}
                  className="flex items-center gap-2 cursor-move hover:opacity-80 pl-2"
                  data-node-type={nodeType.type}
                  title={nodeType.label}
                >
                  <span className="node-palette-item-icon">{nodeType.icon}</span>
                  <span className="inline">{nodeType.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
