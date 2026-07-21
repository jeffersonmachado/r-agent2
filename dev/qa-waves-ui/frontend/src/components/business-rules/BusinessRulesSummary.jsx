import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, GitBranch, Scale } from 'lucide-react';

const cardDefs = [
  { key: 'rulesEvaluated', label: 'Regras avaliadas', icon: Scale, color: 'var(--run)' },
  { key: 'rulesOk', label: 'Regras OK', icon: CheckCircle2, color: 'var(--ok)' },
  { key: 'rulesBroken', label: 'Gaps detectados', icon: AlertTriangle, color: 'var(--err)' },
  { key: 'journeys', label: 'Jornadas geradas', icon: GitBranch, color: 'var(--accent)' }
];

export default function BusinessRulesSummary({ state }) {
  if (!state) {
    return (
      <div className="summary-grid">
        {cardDefs.map((def) => (
          <div key={def.key} className="summary-card muted">
            <def.icon size={22} style={{ color: 'var(--muted)' }} />
            <span className="summary-value">-</span>
            <span className="summary-label">{def.label}</span>
          </div>
        ))}
      </div>
    );
  }

  const values = {
    rulesEvaluated: state.rulesEvaluated ?? 0,
    rulesOk: state.rulesOk ?? 0,
    rulesBroken: state.rulesBroken ?? state.gaps?.length ?? 0,
    journeys: state.flows?.length ?? 0
  };

  return (
    <div className="summary-grid">
      {cardDefs.map((def, idx) => {
        const value = values[def.key];
        const isError = def.key === 'rulesBroken' && value > 0;

        return (
          <motion.div
            key={def.key}
            className={`summary-card${isError ? ' error' : ''}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: idx * 0.06 }}
          >
            <def.icon size={22} style={{ color: isError ? 'var(--err)' : def.color }} />
            <span className="summary-value" style={isError ? { color: 'var(--err)' } : undefined}>
              {value}
            </span>
            <span className="summary-label">{def.label}</span>
          </motion.div>
        );
      })}
    </div>
  );
}
