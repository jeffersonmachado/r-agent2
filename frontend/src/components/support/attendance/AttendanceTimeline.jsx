import React from 'react';

export function AttendanceTimeline({ timeline, formatDate }) {
  return (
    <section className="attendance-timeline-panel">
      <div className="attendance-timeline-header">
        <h3>Historico</h3>
      </div>
      <div className="attendance-timeline-list">
        {(timeline || []).map((item) => (
          <div className="attendance-timeline-item" key={item.id}>
            <div className="attendance-timeline-dot" aria-hidden="true" />
            <div className="attendance-timeline-content">
              <div className="attendance-timeline-title">{String(item.type || 'evento').replace(/_/g, ' ')}</div>
              <div className="attendance-timeline-description">{item.description || '-'}</div>
              <div className="attendance-timeline-date">{item.timestamp ? formatDate(item.timestamp) : '-'}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
