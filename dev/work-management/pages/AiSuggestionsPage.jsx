import React from 'react';
import AiSuggestionsPanel from '../components/AiSuggestionsPanel.jsx';

export function AiSuggestionsPage({ model }) {
  return <AiSuggestionsPanel suggestions={model.aiSuggestions} />;
}

export default AiSuggestionsPage;