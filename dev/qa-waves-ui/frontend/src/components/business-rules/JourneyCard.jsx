import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, GitBranch, Layers, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import FlowCoverageCard from './FlowCoverageCard';
import GapTable from './GapTable';

export default function JourneyCard({ vertical, onUpdateGap }) {
  const [expanded, setExpanded] = useState(false);
  const { summary, flows, gaps, qaCrossReference, sourceInfo } = vertical;
  const hasGaps = summary.gapsCount > 0;
  const scenariosAtRisk = qaCrossReference?.scenariosAtRisk || [];
  const matchedGaps = qaCrossReference?.matchedGaps || [];

  return (
    <motion.article
      className="journey-card"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <header className="journey-card-header" onClick={() => setExpanded((p) => !p)} style={{ cursor: 'pointer' }}>
        <div className="journey-card-left">
          <h3>{vertical.label}</h3>
          <span className="journey-source">{sourceInfo}</span>
        </div>
        <div className="journey-card-right">
          {/* Coverage badge */}
          <span
            className="journey-coverage-badge"
            style={{
              backgroundColor: summary.overallCoverage === 100
                ? 'rgba(55,197,131,0.12)'
                : hasGaps ? 'rgba(255,107,107,0.12)' : 'rgba(255,183,77,0.12)',
              border: `1px solid ${summary.overallCoverage === 100 ? 'var(--ok)' : hasGaps ? 'var(--err)' : 'var(--warn)'}`,
              color: summary.overallCoverage === 100 ? 'var(--ok)' : hasGaps ? 'var(--err)' : 'var(--warn)'
            }}
          >
            {summary.overallCoverage}%
          </span>
          <button className="icon-btn">
            {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
        </div>
      </header>

      {/* Summary stats row */}
      <div className="journey-stats">
        <span title="Regras avaliadas">
          <Layers size={14} style={{ color: 'var(--run)' }} />
          {summary.rulesEvaluated} regras
        </span>
        <span title="Regras OK">
          <CheckCircle2 size={14} style={{ color: 'var(--ok)' }} />
          {summary.rulesOk} ok
        </span>
        {hasGaps && (
          <span title="Gaps" style={{ color: 'var(--err)' }}>
            <AlertTriangle size={14} />
            {summary.gapsCount} gaps
          </span>
        )}
        <span title="Fluxos">
          <GitBranch size={14} style={{ color: 'var(--accent)' }} />
          {summary.flowsCount} fluxos
        </span>
        {scenariosAtRisk.length > 0 && (
          <span title="Cenários QA em risco" style={{ color: 'var(--err)' }}>
            <ShieldAlert size={14} />
            {scenariosAtRisk.length} cenários QA em risco
          </span>
        )}
        {summary.totalScenarios > 0 && scenariosAtRisk.length === 0 && (
          <span title="Cenários QA cobertos" style={{ color: 'var(--ok)' }}>
            <ShieldAlert size={14} />
            {summary.approvedScenarios} cenários QA cobertos
          </span>
        )}
      </div>

      {expanded && (
        <motion.div
          className="journey-expanded"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          transition={{ duration: 0.25 }}
        >
          {/* QA cross-reference warning */}
          {scenariosAtRisk.length > 0 && (
            <div className="qa-risk-banner">
              <ShieldAlert size={16} style={{ color: 'var(--err)' }} />
              <span>
                <strong>{scenariosAtRisk.length} cenário(s) QA</strong> referenciam entidades com gap de cobertura:
              </span>
              <ul className="qa-risk-list">
                {scenariosAtRisk.map((s) => (
                  <li key={s.scenarioId}>
                    <strong>{s.scenario}</strong> ({s.journey}) — entidade <code>{s.entity}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Matched gaps (QA-relevant) */}
          {matchedGaps.length > 0 && (
            <div className="gaps-subsection">
              <h4>
                <ShieldAlert size={14} style={{ color: 'var(--err)' }} />
                Gaps com impacto QA ({matchedGaps.length})
              </h4>
              <GapTable gaps={matchedGaps} onUpdateGap={onUpdateGap} />
            </div>
          )}

          {/* Flows */}
          {flows.length > 0 && (
            <div className="flows-subsection">
              <h4>Fluxos de Negócio ({flows.length})</h4>
              <div className="flows-grid">
                {flows.map((flow, idx) => (
                  <FlowCoverageCard key={flow.flowId} flow={flow} index={idx} />
                ))}
              </div>
            </div>
          )}

          {/* All gaps */}
          {gaps.length > 0 && (
            <div className="gaps-subsection">
              <h4>Todos os Gaps ({gaps.length})</h4>
              <GapTable gaps={gaps} onUpdateGap={onUpdateGap} />
            </div>
          )}

          {gaps.length === 0 && (
            <div className="all-clear">
              <CheckCircle2 size={18} style={{ color: 'var(--ok)' }} />
              Todos os fluxos com cobertura completa.
            </div>
          )}
        </motion.div>
      )}
    </motion.article>
  );
}
