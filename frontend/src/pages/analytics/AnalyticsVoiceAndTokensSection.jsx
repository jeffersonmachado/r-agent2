import React from 'react';

export function AnalyticsVoiceAndTokensSection({
  voiceMetrics,
  publicTokenStats,
  formatMoney,
  exportVoiceCsv,
  exportPublicTokensCsv,
}) {
  return (
    <>
      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold text-text-primary flex items-center gap-2">
            <span>📞</span>
            <span>Voz (ultimos 7 dias)</span>
          </h3>
          <button
            type="button"
            onClick={exportVoiceCsv}
            className="px-3 py-2 rounded-lg border border-border-default bg-bg-secondary text-text-primary hover:bg-bg-hover transition-colors text-sm"
          >
            Exportar CSV
          </button>
        </div>
        {voiceMetrics?.ok ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div>
                <div className="text-sm text-text-secondary">Chamadas</div>
                <div className="text-lg font-semibold">{voiceMetrics.totals?.totalCalls || 0}</div>
              </div>
              <div>
                <div className="text-sm text-text-secondary">Minutos</div>
                <div className="text-lg font-semibold">{voiceMetrics.totals?.totalMinutes || 0}</div>
              </div>
              <div>
                <div className="text-sm text-text-secondary">Custo estimado</div>
                <div className="text-lg font-semibold">{formatMoney(voiceMetrics.totals?.estimatedCost || 0)}</div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {Object.entries(voiceMetrics.byType || {}).map(([type, total]) => (
                <div key={type}>
                  <div className="text-sm text-text-secondary">{type}</div>
                  <div className="text-lg font-semibold">{total}</div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="text-text-secondary">Metricas de voz indisponiveis.</div>
        )}
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold text-text-primary flex items-center gap-2">
            <span>🔑</span>
            <span>Tokens publicos</span>
          </h3>
          <button
            type="button"
            onClick={exportPublicTokensCsv}
            className="px-3 py-2 rounded-lg border border-border-default bg-bg-secondary text-text-primary hover:bg-bg-hover transition-colors text-sm"
          >
            Exportar CSV
          </button>
        </div>
        {publicTokenStats?.ok ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
              <div>
                <div className="text-sm text-text-secondary">Total</div>
                <div className="text-lg font-semibold">{publicTokenStats.totals?.total || 0}</div>
              </div>
              <div>
                <div className="text-sm text-text-secondary">Ativos</div>
                <div className="text-lg font-semibold">{publicTokenStats.totals?.active || 0}</div>
              </div>
              <div>
                <div className="text-sm text-text-secondary">Revogados</div>
                <div className="text-lg font-semibold">{publicTokenStats.totals?.revoked || 0}</div>
              </div>
              <div>
                <div className="text-sm text-text-secondary">Expirados</div>
                <div className="text-lg font-semibold">{publicTokenStats.totals?.expired || 0}</div>
              </div>
            </div>
            <div className="overflow-auto">
              <table style={{ width: '100%', fontSize: '13px' }}>
                <thead>
                  <tr>
                    <th align="left">Kind</th>
                    <th align="left">Total</th>
                    <th align="left">Ativos</th>
                    <th align="left">Usados 24h</th>
                    <th align="left">Ultimo uso</th>
                  </tr>
                </thead>
                <tbody>
                  {(publicTokenStats.items || []).map((item) => (
                    <tr key={item.kind}>
                      <td>{item.kind}</td>
                      <td>{item.total}</td>
                      <td>{item.active}</td>
                      <td>{item.usedLastDay}</td>
                      <td>{item.lastUsedAtMax || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="text-text-secondary">Stats de tokens indisponiveis.</div>
        )}
      </div>
    </>
  );
}
