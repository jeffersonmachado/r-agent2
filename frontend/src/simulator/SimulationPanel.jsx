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
      <div
        style={{
          flex: 1,
          borderTop: `1px solid ${theme.colors.border.default}`,
          padding: '24px',
          fontSize: '13px',
          backgroundColor: theme.colors.bg.secondary,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: theme.colors.text.tertiary,
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '14px', fontWeight: 500, color: theme.colors.text.secondary, marginBottom: '8px' }}>
            Simulação
          </div>
          <div style={{ fontSize: '12px' }}>Nenhuma simulação executada ainda.</div>
        </div>
      </div>
    );
  }

  const { compiledFlowInfo, steps } = simulation;

  return (
    <div
      style={{
        flex: 1,
        borderTop: `1px solid ${theme.colors.border.default}`,
        padding: '16px',
        fontSize: '13px',
        backgroundColor: theme.colors.bg.secondary,
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        minHeight: 0,
      }}
    >
      <div>
        <div style={{ fontWeight: 500, color: theme.colors.text.primary, marginBottom: '4px' }}>Simulação</div>
        {compiledFlowInfo && (
          <div style={{ fontSize: '11px', color: theme.colors.text.tertiary, fontFamily: 'monospace' }}>
            {compiledFlowInfo.id} v{compiledFlowInfo.version}
          </div>
        )}
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          border: `1px solid ${theme.colors.border.default}`,
          borderRadius: '6px',
          backgroundColor: theme.colors.bg.primary,
        }}
      >
        {(!steps || steps.length === 0) && (
          <div style={{ padding: '16px', fontSize: '12px', color: theme.colors.text.tertiary, textAlign: 'center' }}>
            Nenhum passo executado.
          </div>
        )}
        {Array.isArray(steps) &&
          steps.map((step, idx) => (
            <div
              key={step.index}
              onClick={() => onSelectStep && onSelectStep(step)}
              style={{
                padding: '12px',
                borderBottom: idx < steps.length - 1 ? `1px solid ${theme.colors.border.default}` : 'none',
                cursor: onSelectStep ? 'pointer' : 'default',
                transition: 'background-color 150ms ease',
              }}
              onMouseEnter={(e) => {
                if (onSelectStep) {
                  e.currentTarget.style.backgroundColor = theme.colors.bg.tertiary;
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '8px',
                }}
              >
                <span style={{ fontWeight: 500, color: theme.colors.text.primary, fontSize: '12px' }}>
                  Passo {step.index}
                </span>
                <span style={{ fontSize: '11px', color: theme.colors.text.tertiary, fontFamily: 'monospace' }}>
                  {step.stateAfter && step.stateAfter.currentNodeId}
                </span>
              </div>
              {step.output && (
                <div style={{ fontSize: '11px', color: theme.colors.text.secondary }}>
                  <span style={{ color: theme.colors.text.tertiary }}>Output: </span>
                  <code
                    style={{
                      fontFamily: 'monospace',
                      backgroundColor: theme.colors.bg.tertiary,
                      padding: '2px 6px',
                      borderRadius: '4px',
                      fontSize: '11px',
                    }}
                  >
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


