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
 * Paleta de nós arrastáveis - versão simplificada e responsiva
 */
function filterNodeTypesByKind(nodeTypes, flowKind) {
  const kind = String(flowKind || 'chat').trim().toLowerCase();
  if (kind === 'voice') {
    const allowed = new Set([
      // Estruturais
      'start',
      'merge',
      'router',
      'end',
      'set_variable',
      // System nodes
      ...SYSTEM_NODE_TYPES,
      // Voice nodes
      'voice_prompt_listen',
      'voice_listen_asr',
      'voice_gather_dtmf',
      'voice_branch',
      'voice_transfer_ramal',
      'voice_transfer_fila',
      'voice_transfer_utils',
      'voice_hangup',
    ]);
    return (nodeTypes || []).filter((t) => allowed.has(t.type));
  }

  // chat (default): esconde nós de voz
  return (nodeTypes || []).filter((t) => !String(t.type || '').startsWith('voice_'));
}

function categorizeNodes(flowKind) {
  const systemNodes = [];
  const otherNodes = [];

  const filtered = filterNodeTypesByKind(NODE_TYPES, flowKind);
  filtered.forEach(nodeType => {
    if (SYSTEM_NODE_TYPES.includes(nodeType.type)) {
      systemNodes.push(nodeType);
    } else {
      otherNodes.push(nodeType);
    }
  });

  return { systemNodes, otherNodes };
}

export function NodePaletteCollapsed({ onNodeDragStart, onNodeDragEnd, flowKind }) {
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

  const { systemNodes, otherNodes } = categorizeNodes(flowKind);

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

export function NodePalette({ onNodeDragStart, onNodeDragEnd, flowKind }) {
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

  const { systemNodes, otherNodes } = categorizeNodes(flowKind);

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
