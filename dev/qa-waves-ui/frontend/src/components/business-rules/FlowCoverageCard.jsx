import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import FlowStepBadge from './FlowStepBadge';

export default function FlowCoverageCard({ flow, index }) {
  const coverageOk = flow.coverage === 100;
  const barColor = coverageOk ? 'var(--ok)' : flow.coverage >= 50 ? 'var(--warn)' : 'var(--err)';

  return (
    <motion.article
      className="flow-card"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.05 }}
    >
      <header className="flow-card-header">
        <div>
          <h4>{flow.flowName}</h4>
          <p>{flow.description}</p>
        </div>
        <span className="flow-coverage" style={{ color: barColor }}>
          {flow.coverage}%
        </span>
      </header>

      <div className="flow-progress-bar">
        <div
          className="flow-progress-fill"
          style={{ width: `${flow.coverage}%`, backgroundColor: barColor }}
        />
      </div>

      <div className="flow-steps">
        {flow.steps.map((step, sIdx) => (
          <span key={step.entity} className="flow-step-wrapper">
            <FlowStepBadge step={step} />
            {sIdx < flow.steps.length - 1 && (
              <ChevronRight size={14} style={{ color: 'var(--muted)', margin: '0 2px' }} />
            )}
          </span>
        ))}
      </div>

      <div className="flow-meta">
        {flow.coveredEntities}/{flow.totalEntities} entidades cobertas
      </div>
    </motion.article>
  );
}
