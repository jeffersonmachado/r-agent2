import { Check, X } from 'lucide-react';

export default function FlowStepBadge({ step }) {
  const isCovered = step.covered;

  return (
    <span
      className="flow-step-badge"
      title={step.why}
      style={{
        backgroundColor: isCovered ? 'rgba(55,197,131,0.12)' : 'rgba(255,107,107,0.12)',
        border: `1px solid ${isCovered ? 'var(--ok)' : 'var(--err)'}`,
        color: isCovered ? 'var(--ok)' : 'var(--err)'
      }}
    >
      {isCovered ? <Check size={12} /> : <X size={12} />}
      {step.entity}
    </span>
  );
}
