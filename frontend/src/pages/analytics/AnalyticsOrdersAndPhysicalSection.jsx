import React from 'react';

export function AnalyticsOrdersAndPhysicalSection({
  selectedLocationId,
  exportOrdersByHourCsv,
  orderMetrics,
  formatSeconds,
  selectedOrderHourMetric,
  setSelectedOrderHourMetric,
  hourStart,
  setHourStart,
  hourEnd,
  setHourEnd,
  selectedHourPreset,
  setSelectedHourPreset,
  HOUR_PRESETS,
  applyHourPreset,
  orderMetricLabels,
  filteredOrderByHour,
  orderByHourMax,
  exportPhysicalByHourCsv,
  physicalMetrics,
  formatRate,
  selectedPhysicalHourMetric,
  setSelectedPhysicalHourMetric,
  physicalMetricLabels,
  rangeStartHour,
  rangeEndHour,
  filteredPhysicalByHour,
  physicalByHourMax,
}) {
  return (
    <>
      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold text-text-primary flex items-center gap-2">
            <span>🧾</span>
            <span>Pedidos (hoje{selectedLocationId ? ` • ${selectedLocationId}` : ''})</span>
          </h3>
          <button
            type="button"
            onClick={exportOrdersByHourCsv}
            className="px-3 py-2 rounded-lg border border-border-default bg-bg-secondary text-text-primary hover:bg-bg-hover transition-colors text-sm"
          >
            Exportar por hora
          </button>
        </div>
        {orderMetrics?.ok ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div>
                <div className="text-sm text-text-secondary">Criados</div>
                <div className="text-lg font-semibold">{orderMetrics.today?.createdCount || 0}</div>
                <div className="text-xs text-text-secondary">Cancelados: {orderMetrics.today?.cancelledCount || 0}</div>
              </div>
              <div>
                <div className="text-sm text-text-secondary">Order → Ready</div>
                <div className="text-lg font-semibold">{formatSeconds(orderMetrics.today?.avgOrderToReadySeconds)}</div>
                <div className="text-xs text-text-secondary">
                  SLA {orderMetrics.today?.slaOrderToReadyMinutes || 0}m • Estourados: {orderMetrics.today?.slaOrderToReadyBreachedCount || 0}
                </div>
              </div>
              <div>
                <div className="text-sm text-text-secondary">Order → Deliver</div>
                <div className="text-lg font-semibold">{formatSeconds(orderMetrics.today?.avgOrderToDeliverSeconds)}</div>
                <div className="text-xs text-text-secondary">
                  SLA {orderMetrics.today?.slaOrderToDeliverMinutes || 0}m • Estourados: {orderMetrics.today?.slaOrderToDeliverBreachedCount || 0}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              <div className="p-3 rounded-lg border border-border-default bg-bg-secondary">
                <div className="text-xs text-text-secondary">Confirmados</div>
                <div className="text-lg font-semibold">{orderMetrics.today?.confirmedCount || 0}</div>
              </div>
              <div className="p-3 rounded-lg border border-border-default bg-bg-secondary">
                <div className="text-xs text-text-secondary">Preparando</div>
                <div className="text-lg font-semibold">{orderMetrics.today?.preparingCount || 0}</div>
              </div>
              <div className="p-3 rounded-lg border border-border-default bg-bg-secondary">
                <div className="text-xs text-text-secondary">Prontos</div>
                <div className="text-lg font-semibold">{orderMetrics.today?.readyCount || 0}</div>
              </div>
              <div className="p-3 rounded-lg border border-border-default bg-bg-secondary">
                <div className="text-xs text-text-secondary">Despachados</div>
                <div className="text-lg font-semibold">{orderMetrics.today?.dispatchedCount || 0}</div>
              </div>
              <div className="p-3 rounded-lg border border-border-default bg-bg-secondary">
                <div className="text-xs text-text-secondary">Entregues</div>
                <div className="text-lg font-semibold">{orderMetrics.today?.deliveredCount || 0}</div>
              </div>
              <div className="p-3 rounded-lg border border-border-default bg-bg-secondary">
                <div className="text-xs text-text-secondary">Cancelados</div>
                <div className="text-lg font-semibold">{orderMetrics.today?.cancelledCount || 0}</div>
              </div>
            </div>

            {(orderMetrics.byHour || []).length > 0 && (
              <div className="mt-4">
                <div className="flex flex-col md:flex-row gap-3 mb-3">
                  <label className="text-xs text-text-secondary">
                    Métrica
                    <select
                      value={selectedOrderHourMetric}
                      onChange={(e) => setSelectedOrderHourMetric(e.target.value)}
                      className="ml-2 px-2 py-1 bg-bg-secondary border border-border-default rounded text-text-primary"
                    >
                      {Object.entries(orderMetricLabels).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs text-text-secondary">
                    Hora início
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={hourStart}
                      onChange={(e) => {
                        setSelectedHourPreset('custom');
                        setHourStart(e.target.value);
                      }}
                      className="ml-2 w-16 px-2 py-1 bg-bg-secondary border border-border-default rounded text-text-primary"
                    />
                  </label>
                  <label className="text-xs text-text-secondary">
                    Hora fim
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={hourEnd}
                      onChange={(e) => {
                        setSelectedHourPreset('custom');
                        setHourEnd(e.target.value);
                      }}
                      className="ml-2 w-16 px-2 py-1 bg-bg-secondary border border-border-default rounded text-text-primary"
                    />
                  </label>
                </div>
                <div className="flex flex-wrap gap-2 mb-3">
                  {Object.entries(HOUR_PRESETS)
                    .filter(([key]) => key !== 'custom')
                    .map(([key, preset]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => applyHourPreset(key)}
                        className={`px-2 py-1 rounded border text-xs ${
                          selectedHourPreset === key
                            ? 'border-accent-primary text-accent-primary'
                            : 'border-border-default text-text-secondary'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                </div>
                <div className="text-sm font-medium text-text-primary mb-3">Volume por hora ({orderMetricLabels[selectedOrderHourMetric] || 'Criados'})</div>
                <div className="space-y-2 mb-4">
                  {filteredOrderByHour.map((row) => (
                    <div key={row.hour}>
                      <div className="flex justify-between text-xs text-text-secondary mb-1">
                        <span>{String(row.hour).padStart(2, '0')}:00</span>
                        <span>{row[selectedOrderHourMetric] || 0}</span>
                      </div>
                      <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 6, height: 8, width: '100%' }}>
                        <div
                          style={{
                            width: `${Math.max(2, Math.round((Number(row[selectedOrderHourMetric] || 0) / orderByHourMax) * 100))}%`,
                            height: 8,
                            borderRadius: 6,
                            background: 'linear-gradient(90deg, #38bdf8, #0284c7)',
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="overflow-auto">
                  <table style={{ width: '100%', fontSize: '13px' }}>
                    <thead>
                      <tr>
                        <th align="left">Hora</th>
                        <th align="right">Criados</th>
                        <th align="right">Confirmados</th>
                        <th align="right">Preparando</th>
                        <th align="right">Prontos</th>
                        <th align="right">Despachados</th>
                        <th align="right">Entregues</th>
                        <th align="right">Cancelados</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredOrderByHour.map((row) => (
                        <tr key={row.hour}>
                          <td>{String(row.hour).padStart(2, '0')}:00</td>
                          <td align="right">{row.created_count || 0}</td>
                          <td align="right">{row.confirmed_count || 0}</td>
                          <td align="right">{row.preparing_count || 0}</td>
                          <td align="right">{row.ready_count || 0}</td>
                          <td align="right">{row.dispatched_count || 0}</td>
                          <td align="right">{row.delivered_count || 0}</td>
                          <td align="right">{row.cancelled_count || 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-text-secondary">Métricas de pedidos indisponíveis.</div>
        )}
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold text-text-primary flex items-center gap-2">
            <span>🏷️</span>
            <span>Filas físicas (hoje{selectedLocationId ? ` • ${selectedLocationId}` : ''})</span>
          </h3>
          <button
            type="button"
            onClick={exportPhysicalByHourCsv}
            className="px-3 py-2 rounded-lg border border-border-default bg-bg-secondary text-text-primary hover:bg-bg-hover transition-colors text-sm"
          >
            Exportar por hora
          </button>
        </div>
        {physicalMetrics?.ok ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div>
                <div className="text-sm text-text-secondary">Atendidas</div>
                <div className="text-lg font-semibold">{physicalMetrics.today?.doneCount || 0}</div>
                <div className="text-xs text-text-secondary">Abandonos: {physicalMetrics.today?.abandonedCount || 0}</div>
              </div>
              <div>
                <div className="text-sm text-text-secondary">Espera média</div>
                <div className="text-lg font-semibold">{formatSeconds(physicalMetrics.today?.avgWaitSeconds)}</div>
                <div className="text-xs text-text-secondary">Ativas: {physicalMetrics.today?.activeCount || 0}</div>
              </div>
              <div>
                <div className="text-sm text-text-secondary">Atendimento médio</div>
                <div className="text-lg font-semibold">{formatSeconds(physicalMetrics.today?.avgServiceSeconds)}</div>
                <div className="text-xs text-text-secondary">Abandono: {formatRate(physicalMetrics.today?.abandonmentRate)}</div>
              </div>
            </div>

            {(physicalMetrics.byQueue || []).length > 0 && (
              <div className="overflow-auto mt-4">
                <table style={{ width: '100%', fontSize: '13px' }}>
                  <thead>
                    <tr>
                      <th align="left">Fila</th>
                      <th align="right">Done</th>
                      <th align="right">Abandonados</th>
                      <th align="right">Ativos</th>
                      <th align="right">Espera média</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(physicalMetrics.byQueue || []).map((row) => (
                      <tr key={row.physical_queue_id}>
                        <td>{row.physical_queue_id}</td>
                        <td align="right">{row.done_count || 0}</td>
                        <td align="right">{row.abandoned_count || 0}</td>
                        <td align="right">{row.active_count || 0}</td>
                        <td align="right">{formatSeconds(row.avg_wait_seconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {(physicalMetrics.byStation || []).length > 0 && (
              <div className="overflow-auto mt-4">
                <table style={{ width: '100%', fontSize: '13px' }}>
                  <thead>
                    <tr>
                      <th align="left">Estação</th>
                      <th align="right">Done</th>
                      <th align="right">Abandonados</th>
                      <th align="right">Atendimento médio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(physicalMetrics.byStation || []).map((row) => (
                      <tr key={row.station_id}>
                        <td>{row.station_id}</td>
                        <td align="right">{row.done_count || 0}</td>
                        <td align="right">{row.abandoned_count || 0}</td>
                        <td align="right">{formatSeconds(row.avg_service_seconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {(physicalMetrics.byHour || []).length > 0 && (
              <div className="mt-4">
                <div className="flex flex-col md:flex-row gap-3 mb-3">
                  <label className="text-xs text-text-secondary">
                    Métrica
                    <select
                      value={selectedPhysicalHourMetric}
                      onChange={(e) => setSelectedPhysicalHourMetric(e.target.value)}
                      className="ml-2 px-2 py-1 bg-bg-secondary border border-border-default rounded text-text-primary"
                    >
                      {Object.entries(physicalMetricLabels).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <div className="text-xs text-text-secondary">Faixa horária compartilhada com Pedidos: {String(rangeStartHour).padStart(2, '0')}:00-{String(rangeEndHour).padStart(2, '0')}:59</div>
                </div>
                <div className="text-sm font-medium text-text-primary mb-3">Volume por hora ({physicalMetricLabels[selectedPhysicalHourMetric] || 'Criados'})</div>
                <div className="space-y-2 mb-4">
                  {filteredPhysicalByHour.map((row) => (
                    <div key={row.hour}>
                      <div className="flex justify-between text-xs text-text-secondary mb-1">
                        <span>{String(row.hour).padStart(2, '0')}:00</span>
                        <span>{row[selectedPhysicalHourMetric] || 0}</span>
                      </div>
                      <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 6, height: 8, width: '100%' }}>
                        <div
                          style={{
                            width: `${Math.max(2, Math.round((Number(row[selectedPhysicalHourMetric] || 0) / physicalByHourMax) * 100))}%`,
                            height: 8,
                            borderRadius: 6,
                            background: 'linear-gradient(90deg, #f59e0b, #d97706)',
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="overflow-auto">
                  <table style={{ width: '100%', fontSize: '13px' }}>
                    <thead>
                      <tr>
                        <th align="left">Hora</th>
                        <th align="right">Criados</th>
                        <th align="right">Done</th>
                        <th align="right">Abandonados</th>
                        <th align="right">Espera média</th>
                        <th align="right">Atendimento médio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPhysicalByHour.map((row) => (
                        <tr key={row.hour}>
                          <td>{String(row.hour).padStart(2, '0')}:00</td>
                          <td align="right">{row.created_count || 0}</td>
                          <td align="right">{row.done_count || 0}</td>
                          <td align="right">{row.abandoned_count || 0}</td>
                          <td align="right">{formatSeconds(row.avg_wait_seconds)}</td>
                          <td align="right">{formatSeconds(row.avg_service_seconds)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-text-secondary">Métricas de filas físicas indisponíveis.</div>
        )}
      </div>
    </>
  );
}
