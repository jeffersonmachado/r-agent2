import React from 'react';

function readSelection(viewModel, selection) {
  if (!viewModel || !selection?.kind || !selection?.id) return null;

  const maps = {
    node: viewModel.nodes,
    participant: viewModel.participants,
    lane: viewModel.lanes,
    sequenceFlow: viewModel.sequenceFlows,
    messageFlow: viewModel.messageFlows,
  };

  const collection = maps[selection.kind];
  if (!Array.isArray(collection)) return null;

  return collection.find((item) => item.id === selection.id) || null;
}

function InfoRow({ label, value }) {
  if (value == null || value === '') return null;

  return (
    <div className="flex items-start justify-between gap-3 border-b border-border-subtle py-2 text-xs">
      <span className="text-text-secondary">{label}</span>
      <span className="text-right text-text-primary break-all">{String(value)}</span>
    </div>
  );
}

export function BpmnInspectorBridge({ selection, viewModel, onSwitchToEngine }) {
  if (!selection) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-sm sidebar-properties-empty">
        <div className="text-center space-y-3 max-w-[240px]">
          <div className="mb-3 opacity-40">
            <span className="icon icon-logs sidebar-properties-empty-icon"></span>
          </div>
          <div className="text-base font-semibold mb-1 sidebar-properties-empty-title">
            Nenhum elemento BPMN selecionado
          </div>
          <div className="text-xs leading-relaxed sidebar-properties-empty-description">
            Selecione um pool, lane, atividade ou fluxo para inspecionar seus metadados.
          </div>
        </div>
      </div>
    );
  }

  const item = readSelection(viewModel, selection);

  if (!item) {
    return (
      <div className="p-4 text-sm text-text-secondary">
        O elemento selecionado não está mais disponível no diagrama atual.
      </div>
    );
  }

  const engineTargets = [];

  if (selection.kind === 'node' && item.id) {
    engineTargets.push({ id: item.id, label: 'Editar este nó no modo engine' });

    if (item.attachedToRef) {
      engineTargets.push({ id: item.attachedToRef, label: 'Abrir nó vinculado no engine' });
    }
  }

  if (selection.kind === 'sequenceFlow') {
    if (item.sourceRef) {
      engineTargets.push({ id: item.sourceRef, label: 'Abrir nó de origem no engine' });
    }
    if (item.targetRef) {
      engineTargets.push({ id: item.targetRef, label: 'Abrir nó de destino no engine' });
    }
  }

  const uniqueEngineTargets = Array.from(
    new Map(engineTargets.map((target) => [target.id, target])).values()
  );

  return (
    <div className="p-4 space-y-4 overflow-y-auto">
      <div>
        <div className="text-[11px] uppercase tracking-[0.14em] text-text-tertiary">Modo BPMN</div>
        <div className="mt-1 text-base font-semibold text-text-primary">{item.name || item.id}</div>
        <div className="mt-1 text-xs text-text-secondary">{selection.kind}</div>
      </div>

      <div className="rounded-lg border border-border-default bg-bg-elevated px-3">
        <InfoRow label="ID" value={item.id} />
        <InfoRow label="Nome" value={item.name} />
        <InfoRow label="Tipo BPMN" value={item.bpmnType} />
        <InfoRow label="Categoria" value={item.category} />
        <InfoRow label="Processo" value={item.processRef} />
        <InfoRow label="Pool" value={item.participantRef || item.sourceParticipantRef} />
        <InfoRow label="Lane" value={item.laneRef} />
        <InfoRow label="Origem" value={item.sourceRef} />
        <InfoRow label="Destino" value={item.targetRef} />
        <InfoRow label="Atrelado a" value={item.attachedToRef} />
        <InfoRow label="Evento" value={item.eventDefinitionType} />
        <InfoRow label="Expandido" value={typeof item.isExpanded === 'boolean' ? String(item.isExpanded) : null} />
      </div>

      {onSwitchToEngine && uniqueEngineTargets.length > 0 ? (
        <div className="space-y-2">
          {uniqueEngineTargets.map((target) => (
            <button
              key={target.id}
              type="button"
              className="btn-base w-full justify-center"
              onClick={() => onSwitchToEngine(target.id)}
            >
              {target.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default BpmnInspectorBridge;