import React from 'react';
import TimelineView from '../components/TimelineView.jsx';

export function TimelinePage({ model }) {
  return (
    <section className="wm-stack-lg">
      <div className="wm-panel-header">
        <h2>Timeline</h2>
        <span>fases, marcos e dependencias visuais</span>
      </div>
      <TimelineView projects={model.projects} />
    </section>
  );
}

export default TimelinePage;