import React from 'react';
import { useTheme } from '../styles/themeContext';

/**
 * Painel de simulação: lista os passos executados pela engine.
 *
 * Props:
 * - simulation: resultado retornado pelo backend (simulateFlow)
 *   com forma aproximada de:
 *   {
 *     compiledFlowInfo: { id, version, versionHash },
 *     steps: [{ index, stateBefore, stateAfter, output, events }],
 *     replay,
 *   }
 */
export function SimulationPanel({ simulation, onSelectStep }) {
  const { theme } = useTheme();

  if (!simulation) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-sm sidebar-properties-empty">
        <div className="text-center space-y-3 max-w-[240px]">
          <div className="mb-3 opacity-40">
            <span className="icon icon-play sidebar-properties-empty-icon"></span>
          </div>
          <div className="text-base font-semibold mb-1 sidebar-properties-empty-title">
            Nenhuma simulação executada
          </div>
          <div className="text-xs leading-relaxed sidebar-properties-empty-description">
            Execute a simulação para ver os resultados.
          </div>
        </div>
      </div>
    );
  }

  const { compiledFlowInfo, steps } = simulation;

  return (
    <div className="simulation-panel">
      <div>
        <div className="simulation-panel-header">Simulação</div>
        {compiledFlowInfo && (
          <div className="simulation-panel-info">
            {compiledFlowInfo.id} v{compiledFlowInfo.version}
          </div>
        )}
      </div>

      <div className="simulation-panel-steps">
        {(!steps || steps.length === 0) && (
          <div className="simulation-panel-empty">
            Nenhum passo executado.
          </div>
        )}
        {Array.isArray(steps) &&
          steps.map((step, idx) => (
            <div
              key={step.index}
              onClick={() => onSelectStep && onSelectStep(step)}
              className={`simulation-panel-step ${onSelectStep ? '' : 'simulation-panel-step--no-pointer'}`}
            >
              <div className="simulation-panel-step-header">
                <span className="simulation-panel-step-title">
                  Passo {step.index}
                </span>
                <span className="simulation-panel-step-node">
                  {step.stateAfter && step.stateAfter.currentNodeId}
                </span>
              </div>
              {step.output && (
                <div className="simulation-panel-step-output">
                  <span className="simulation-panel-step-output-label">Output: </span>
                  <code className="simulation-panel-step-code">
                    {JSON.stringify(step.output).slice(0, 100)}
                    {JSON.stringify(step.output).length > 100 ? '…' : ''}
                  </code>
                </div>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}


