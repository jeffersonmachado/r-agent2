import { Loader2, RefreshCw } from 'lucide-react';
import { JourneyCard } from '../components/business-rules';
import { useBusinessRules } from '../hooks/useBusinessRules';
import { businessRulesService } from '../services/businessRulesService';

export default function BusinessRulesPage() {
  const { data, loading, error, refresh } = useBusinessRules();

  async function handleUpdateGap(gapId, newStatus) {
    try {
      await businessRulesService.updateGap(gapId, { status: newStatus });
      await refresh();
    } catch (_err) {
      // silent
    }
  }

  if (loading) {
    return (
      <section className="panel">
        <div className="loading-state">
          <Loader2 size={24} className="spin" style={{ color: 'var(--muted)' }} />
          <span>Analisando jornadas de negocio...</span>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="panel">
        <p className="error-text">{error}</p>
      </section>
    );
  }

  const verticals = data?.verticals || [];

  return (
    <section className="panel">
      <div className="toolbar">
        <div>
          <h3 style={{ margin: 0 }}>Regras de Negócio por Vertical</h3>
          <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 13 }}>
            {verticals.length} verticais analisadas — inferencia de fluxos e cobertura cruzada com cenários QA
          </p>
        </div>
        <button className="secondary" onClick={refresh} title="Reanalisar todas as verticais">
          <RefreshCw size={14} /> Reanalisar
        </button>
      </div>

      {verticals.length === 0 ? (
        <div className="empty-state">
          <p>Nenhuma vertical configurada. Adicione business models em backend/src/data/business-models.json.</p>
        </div>
      ) : (
        <div className="journeys-grid">
          {verticals.map((vertical) => (
            <JourneyCard
              key={vertical.verticalId}
              vertical={vertical}
              onUpdateGap={handleUpdateGap}
            />
          ))}
        </div>
      )}
    </section>
  );
}
