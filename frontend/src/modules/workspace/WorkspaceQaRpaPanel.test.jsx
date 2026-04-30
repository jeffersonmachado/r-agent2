/* @vitest-environment jsdom */
import React from 'react';
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { WorkspaceQaRpaPanel } from './WorkspaceQaRpaPanel';

function makeEvidenceEvent({ governance = null, autocorrection = null, checks = {}, status = 'passed' } = {}) {
  return {
    id: 'ev-1',
    type: 'evidence',
    refId: 'ev-1',
    summary: 'Wave QA executada',
    payload: {
      metadata: {
        qaWaveStatus: status,
        governance,
        autocorrection,
        checks,
        wave: 'workspace-core',
      },
    },
  };
}

describe('WorkspaceQaRpaPanel', () => {
  it('renderiza estado vazio sem falhas', () => {
    render(<WorkspaceQaRpaPanel autocorrections={{ items: [] }} loading={false} timeline={{ items: [] }} />);
    expect(screen.getByText('Sem falhas QA/RPA vinculadas.')).toBeInTheDocument();
  });

  it('exibe decisão GO na evidence wave card', () => {
    const event = makeEvidenceEvent({
      governance: { decision: 'GO', reason: 'All critical checks passed', severity: 'low', failedChecks: [] },
      autocorrection: { required: false, created: false, reason: 'ok' },
      status: 'passed',
    });
    render(
      <WorkspaceQaRpaPanel
        autocorrections={{ items: [] }}
        loading={false}
        timeline={{ items: [event] }}
      />,
    );
    expect(screen.getByText('Decisão: GO')).toBeInTheDocument();
    expect(screen.getByText('passed')).toBeInTheDocument();
  });

  it('exibe decisão NO_GO e campos de autocorrection', () => {
    const event = makeEvidenceEvent({
      governance: { decision: 'NO_GO', reason: 'Critical checks failed', severity: 'critical', failedChecks: ['entityCreated'] },
      autocorrection: { required: true, created: true, reason: 'Autocorrection criada para revisão humana.' },
      status: 'failed',
    });
    render(
      <WorkspaceQaRpaPanel
        autocorrections={{ items: [] }}
        loading={false}
        timeline={{ items: [event] }}
      />,
    );
    expect(screen.getByText('Decisão: NO_GO')).toBeInTheDocument();
    expect(screen.getByText(/required=true.*created=true/)).toBeInTheDocument();
    expect(screen.getByText('Autocorrection criada para revisão humana.')).toBeInTheDocument();
  });

  it('exibe REVIEW com failedChecks', () => {
    const event = makeEvidenceEvent({
      governance: { decision: 'REVIEW', reason: 'High severity checks require review', severity: 'high', failedChecks: ['ticketLinked'] },
      autocorrection: { required: true, created: true, reason: 'autocorrection criada' },
      status: 'passed',
    });
    render(
      <WorkspaceQaRpaPanel
        autocorrections={{ items: [] }}
        loading={false}
        timeline={{ items: [event] }}
      />,
    );
    expect(screen.getByText('Decisão: REVIEW')).toBeInTheDocument();
    expect(screen.getByText(/failedChecks:/)).toBeInTheDocument();
    expect(screen.getByText(/ticketLinked/)).toBeInTheDocument();
  });

  it('exibe GO_WITH_WARNINGS sem autocorrection obrigatória', () => {
    const event = makeEvidenceEvent({
      governance: { decision: 'GO_WITH_WARNINGS', reason: 'Only medium checks failed', severity: 'medium', failedChecks: ['insightCreated'] },
      autocorrection: { required: false, created: false, reason: null },
      status: 'passed',
    });
    render(
      <WorkspaceQaRpaPanel
        autocorrections={{ items: [] }}
        loading={false}
        timeline={{ items: [event] }}
      />,
    );
    expect(screen.getByText('Decisão: GO_WITH_WARNINGS')).toBeInTheDocument();
    expect(screen.getByText(/required=false.*created=false/)).toBeInTheDocument();
  });

  it('exibe lista de autocorrection runs', () => {
    const run = {
      id: 'run-1',
      status: 'pending_review',
      source_type: 'qa_mesh_governance',
      diagnosis: {
        affectedModule: 'workspace',
        rootCause: 'Critical checks failed',
        risk: 'critical',
        confidence: 0.95,
        failedChecks: ['entityCreated'],
        governance: { decision: 'NO_GO', severity: 'critical', reason: 'Critical checks failed' },
      },
      proposed_patch: { patchSummary: 'Revisar contrato de API.', filesToChange: [], testsToRun: [] },
      validation_result: { summary: 'Pendente revisão humana.', steps: [] },
      actions: [{ id: 'a1', type: 'human_review', status: 'pending' }],
    };
    render(
      <WorkspaceQaRpaPanel
        autocorrections={{ items: [run] }}
        loading={false}
        timeline={{ items: [] }}
      />,
    );
    expect(screen.getByText('1 autocorrection')).toBeInTheDocument();
    expect(screen.getByText('AutoCorrection')).toBeInTheDocument();
    expect(screen.getByText('Revisar contrato de API.')).toBeInTheDocument();
    expect(screen.getByText('Governance: NO_GO')).toBeInTheDocument();
    expect(screen.getByText(/human_review: pending/)).toBeInTheDocument();
  });

  it('inferência de decisão operacional quando não há governance explícita', () => {
    const event = makeEvidenceEvent({
      governance: null,
      autocorrection: { required: true, created: false, reason: 'missing' },
      status: 'failed',
    });
    render(
      <WorkspaceQaRpaPanel
        autocorrections={{ items: [] }}
        loading={false}
        timeline={{ items: [event] }}
      />,
    );
    expect(screen.getByText('Decisão: NO_GO')).toBeInTheDocument();
  });
});
