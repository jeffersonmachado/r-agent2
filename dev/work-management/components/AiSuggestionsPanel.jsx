import React from 'react';
import PriorityBadge from './PriorityBadge.jsx';

export function AiSuggestionsPanel({ suggestions = [], compact = false }) {
  return (
    <section className="wm-panel">
      <div className="wm-panel-header">
        <h2>AI Suggestions</h2>
        <span>{suggestions.length}</span>
      </div>

      {suggestions.length ? (
        <div className={compact ? 'wm-stack-sm' : 'wm-card-grid'}>
          {suggestions.map((suggestion) => (
            <article key={suggestion.id} className="wm-suggestion-card">
              <div className="wm-split-row wm-gap-sm">
                <strong>{suggestion.summary}</strong>
                <PriorityBadge priority={suggestion.priority} />
              </div>
              <p>{suggestion.recommendation}</p>
              <div className="wm-inline-meta">
                <span>{suggestion.type}</span>
                <span>{Math.round(suggestion.confidence * 100)}% confidence</span>
                <span>{suggestion.status}</span>
              </div>
            </article>
          ))}
        </div>
      ) : <div className="wm-empty-state">Nenhuma recomendacao da IA para este recorte.</div>}
    </section>
  );
}

export default AiSuggestionsPanel;