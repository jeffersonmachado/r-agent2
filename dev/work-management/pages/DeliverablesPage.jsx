import React from 'react';
import DeliverablesList from '../components/DeliverablesList.jsx';

export function DeliverablesPage({ model }) {
  return (
    <section className="wm-panel">
      <div className="wm-panel-header">
        <h2>Deliverables</h2>
        <span>release, rollout, campanha, validacao</span>
      </div>
      <DeliverablesList deliverables={model.deliverables} />
    </section>
  );
}

export default DeliverablesPage;