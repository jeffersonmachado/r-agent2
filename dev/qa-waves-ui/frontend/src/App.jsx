import { Radar, Repeat2 } from 'lucide-react';
import { useState } from 'react';
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
      </nav>

      {activeTab === 'waves' && <WavesPage onExecutionCompleted={handleExecutionCompleted} />}
      {activeTab === 'replays' && <ReplayPage refreshKey={replayRefreshKey} />}
    </main>
  );
}
