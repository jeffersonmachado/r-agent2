import React from 'react';

export function AnalyticsSupportMetricsSection({
  dateRange,
  setDateRange,
  resetAnalyticsFilters,
  metrics,
  exportSupportMetricsCsv,
  formatTime,
  formatSeconds,
  formatRate,
}) {
  return (
    <>
      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-semibold text-text-primary flex items-center gap-2">
            <span>🔍</span>
            <span>Filtros</span>
          </h3>
          <button
            type="button"
            onClick={resetAnalyticsFilters}
            className="px-3 py-2 rounded-lg border border-border-default bg-bg-secondary text-text-primary hover:bg-bg-hover transition-colors text-sm"
          >
            Resetar
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">Data Inicial</label>
            <input
              type="date"
              value={dateRange.startDate}
              onChange={(e) => setDateRange({ ...dateRange, startDate: e.target.value })}
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
            />
          </div>
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">Data Final</label>
            <input
              type="date"
              value={dateRange.endDate}
              onChange={(e) => setDateRange({ ...dateRange, endDate: e.target.value })}
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
            />
          </div>
        </div>
      </div>

      {metrics && (
        <>
          <div className="flex justify-end mb-3">
            <button
              type="button"
              onClick={exportSupportMetricsCsv}
              className="px-3 py-2 rounded-lg border border-border-default bg-bg-secondary text-text-primary hover:bg-bg-hover transition-colors text-sm"
            >
              Exportar atendimento CSV
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
            <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
              <div className="text-sm text-text-secondary mb-1">Total de Tickets</div>
              <div className="text-3xl font-bold text-text-primary">{metrics.general?.totalTickets || 0}</div>
            </div>
            <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
              <div className="text-sm text-text-secondary mb-1">Tickets Abertos</div>
              <div className="text-3xl font-bold text-status-warning">{metrics.general?.openTickets || 0}</div>
            </div>
            <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
              <div className="text-sm text-text-secondary mb-1">Tickets Fechados</div>
              <div className="text-3xl font-bold text-status-success">{metrics.general?.closedTickets || 0}</div>
            </div>
            <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
              <div className="text-sm text-text-secondary mb-1">Tempo Medio de Resolucao</div>
              <div className="text-3xl font-bold text-accent-primary">{formatTime(metrics.general?.avgResolutionTime)}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
            <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
              <div className="text-sm text-text-secondary mb-1">TME (1a resposta)</div>
              <div className="text-3xl font-bold text-accent-primary">{formatSeconds(metrics.general?.avgFirstResponseTimeSeconds)}</div>
            </div>
            <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
              <div className="text-sm text-text-secondary mb-1">TMA (atendimento)</div>
              <div className="text-3xl font-bold text-accent-primary">{formatSeconds(metrics.general?.avgHandlingTimeSeconds)}</div>
            </div>
            <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
              <div className="text-sm text-text-secondary mb-1">Taxa de Abandono</div>
              <div className="text-3xl font-bold text-status-warning">{formatRate(metrics.general?.abandonmentRate)}</div>
            </div>
            <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
              <div className="text-sm text-text-secondary mb-1">Contencao Bot</div>
              <div className="text-3xl font-bold text-status-success">{formatRate(metrics.general?.botContainmentRate)}</div>
            </div>
          </div>

          {metrics.agents && metrics.agents.length > 0 && (
            <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
              <h2 className="text-xl font-semibold text-text-primary mb-4">Metricas por Agente</h2>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-bg-secondary border-b border-border-default">
                      <th className="text-left py-3 px-4 text-sm font-semibold text-text-primary">Agente</th>
                      <th className="text-right py-3 px-4 text-sm font-semibold text-text-primary">Total</th>
                      <th className="text-right py-3 px-4 text-sm font-semibold text-text-primary">Fechados</th>
                      <th className="text-right py-3 px-4 text-sm font-semibold text-text-primary">Abertos</th>
                      <th className="text-right py-3 px-4 text-sm font-semibold text-text-primary">Tempo Medio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.agents.map((agent) => (
                      <tr key={agent.agentId} className="border-b border-border-default hover:bg-bg-hover transition-colors">
                        <td className="py-3 px-4 text-text-primary">{agent.agentName}</td>
                        <td className="py-3 px-4 text-right text-text-primary">{agent.totalTickets}</td>
                        <td className="py-3 px-4 text-right text-status-success">{agent.closedTickets}</td>
                        <td className="py-3 px-4 text-right text-status-warning">{agent.openTickets}</td>
                        <td className="py-3 px-4 text-right text-text-secondary">{formatTime(agent.avgResolutionTime)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {metrics.departments && metrics.departments.length > 0 && (
            <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
              <h2 className="text-xl font-semibold text-text-primary mb-4">Metricas por Departamento</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {metrics.departments.map((dept) => (
                  <div key={dept.departmentId} className="border border-border-default rounded-xl p-4 bg-bg-secondary">
                    <h3 className="font-semibold text-text-primary mb-2">{dept.departmentName}</h3>
                    <div className="text-sm text-text-secondary space-y-1">
                      <div>Total: {dept.totalTickets}</div>
                      <div>Fechados: {dept.closedTickets}</div>
                      <div>Tempo Medio: {formatTime(dept.avgResolutionTime)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {metrics.queues && metrics.queues.length > 0 && (
            <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
              <h2 className="text-xl font-semibold text-text-primary mb-4">Metricas por Fila</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {metrics.queues.map((queue) => (
                  <div key={queue.queueName} className="border border-border-default rounded-xl p-4 bg-bg-secondary">
                    <h3 className="font-semibold text-text-primary mb-2">{queue.queueName}</h3>
                    <div className="text-sm text-text-secondary space-y-1">
                      <div>Total: {queue.totalTickets}</div>
                      <div>Esperando: {queue.waitingTickets}</div>
                      <div>Em Andamento: {queue.inProgressTickets}</div>
                      <div>Fechados: {queue.closedTickets}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
