import { Radar, Repeat2, Workflow } from 'lucide-react';
import { useState } from 'react';
import BusinessRulesPage from './pages/BusinessRulesPage';
import ReplayPage from './pages/ReplayPage';
import WavesPage from './pages/WavesPage';

export default function App() {
  const [activeTab, setActiveTab] = useState('waves');
  const [replayRefreshKey, setReplayRefreshKey] = useState(0);

  function handleExecutionCompleted() {
    setReplayRefreshKey((key) => key + 1);
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <p className="eyebrow">Ambiente isolado /dev - QA, RPA, Replay</p>
        <h1>Wave Control Room</h1>
        <p>Painel operacional para selecao por onda/item, execucao seletiva e analise de replays.</p>
      </header>

      <nav className="tab-nav">
        <button className={activeTab === 'waves' ? 'tab active' : 'tab'} onClick={() => setActiveTab('waves')}>
          <Radar size={16} /> Ondas e Execucao
        </button>
        <button className={activeTab === 'replays' ? 'tab active' : 'tab'} onClick={() => setActiveTab('replays')}>
          <Repeat2 size={16} /> Replays
        </button>
        <button className={activeTab === 'business-rules' ? 'tab active' : 'tab'} onClick={() => setActiveTab('business-rules')}>
          <Workflow size={16} /> Engenharia
        </button>
      </nav>

      {activeTab === 'waves' && <WavesPage onExecutionCompleted={handleExecutionCompleted} />}
      {activeTab === 'replays' && <ReplayPage refreshKey={replayRefreshKey} />}
      {activeTab === 'business-rules' && <BusinessRulesPage />}
    </main>
  );
}
