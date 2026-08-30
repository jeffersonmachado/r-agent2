/**
 * Superfície técnica da DemoPage (apenas classificação DEVELOPMENT).
 *
 * Este módulo vive em components/qa-waves/ (área de engenharia, fora das
 * superfícies PRODUCTION varridas pelo validate-experience-segregation).
 * A DemoPage consome estes componentes/helpers atrás de um gate de
 * classificação e nunca carrega literais técnicos em seu próprio arquivo.
 */
import React from 'react';
import { CrmBadge, CrmCard } from '../crm';
import JourneyStatusCard from './JourneyStatusCard';
import { ReplayDetailsModal } from './ReplayDetailsModal';

/** Subtítulo técnico completo da demo (somente DEVELOPMENT). */
export const DEMO_TECHNICAL_SUBTITLE = 'Cliente -> IA -> Operacao -> Automacao -> Resultado -> QA -> Replay';

/** Subtítulo sanitizado da demo operacional (PRODUCTION/SUPPORT). */
export const DEMO_OPERATIONAL_SUBTITLE = 'Cliente -> IA -> Operacao -> Automacao -> Resultado';

/**
 * Etapa exibida no mini-card de jornada: para DEVELOPMENT reflete a wave de
 * QA em execução; para os demais perfis reflete a etapa operacional da jornada.
 */
export function getDemoJourneyStage(state, isDevelopment) {
  if (isDevelopment) {
    return state?.qaWaves?.stage || '-';
  }
  return state?.journey?.active?.stage || '-';
}

/** Detalhes do replay vinculado à demo (somente DEVELOPMENT). */
export function getDemoReplayDetails(state) {
  return state?.replay?.details || null;
}

/**
 * Seção técnica da demo: status da jornada de QA + indicadores de QA Waves
 * com ações de replay/diagnóstico. Renderizar SOMENTE para DEVELOPMENT.
 */
export function DemoDevQaSection({ state, showToast }) {
  const qaJourney = state?.journey?.qaJourneyStatus || state?.journey?.active || null;
  const qaStepStatuses = state?.journey?.qaStepStatuses || [];

  return (
    <section className="demo-grid demo-grid--qa">
      <JourneyStatusCard journey={qaJourney} stepStatuses={qaStepStatuses} />
      <CrmCard>
        <h3 className="demo-card-title">QA Waves visivel</h3>
        <div className="demo-list">
          <div><span>Wave atual</span><strong>{state?.qaWaves?.wave || '-'}</strong></div>
          <div><span>Etapa</span><strong>{state?.qaWaves?.stage || '-'}</strong></div>
          <div><span>Coverage</span><strong>{state?.qaWaves?.coverage ?? '-'}%</strong></div>
          <div><span>Gaps</span><strong>{state?.qaWaves?.gaps ?? '-'}</strong></div>
          <div><span>Go/No-Go</span><strong>{state?.qaWaves?.goNoGo || '-'}</strong></div>
          <div><span>Replay vinculado</span><strong>{state?.qaWaves?.replayLinked || '-'}</strong></div>
        </div>
        <div className="demo-actions-row">
          <button
            type="button"
            className="demo-link-button"
            onClick={() => {
              if (!state?.replay?.replayId) {
                showToast('Nenhum replay disponivel para esta demo.', 'warning');
                return;
              }
              window.open(`/dev/rpa-replays?source=qa-waves&search=${encodeURIComponent(state.replay.replayId)}`, '_blank', 'noopener,noreferrer');
            }}
          >
            Abrir replay
          </button>
          <button
            type="button"
            className="demo-link-button"
            onClick={() => window.open('/dev/qa-waves', '_blank', 'noopener,noreferrer')}
          >
            Abrir QA Waves
          </button>
        </div>
      </CrmCard>
    </section>
  );
}

/** Badge técnico de status de replay no card de CRM (somente DEVELOPMENT). */
export function DemoDevReplayBadge({ indicators }) {
  return <CrmBadge label={`Replay ${indicators?.replayStatus || '-'}`} variant="warning" />;
}

/** Modal de detalhes do replay (somente DEVELOPMENT). */
export function DemoDevDetailsModal({ details, onClose }) {
  return <ReplayDetailsModal details={details} onClose={onClose} />;
}
