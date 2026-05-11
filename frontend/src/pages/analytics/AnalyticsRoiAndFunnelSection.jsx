import React from 'react';

export function AnalyticsRoiAndFunnelSection({
  selectedWindowDays,
  selectedChannel,
  setSelectedWindowDays,
  setSelectedChannel,
  selectedLocationId,
  setSelectedLocationId,
  channelOptions,
  exportRoiCsv,
  copyFiltersLink,
  resetAnalyticsFilters,
  formatMoney,
  formatRate,
  formatSeconds,
  roiRevenue,
  roiCost,
  roiPercent,
  roiMargin,
  operationalCosts,
  blendedCost,
  blendedRoiPercent,
  blendedMargin,
  funnelMetrics,
  funnelStageMax,
  filteredChannels,
  leadsByChannel,
  orderByChannel,
  attributionRows,
  attributionAlerts,
  roiMetrics,
  orderMetrics,
}) {
  return (
    <>
      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <div className="flex flex-col lg:flex-row lg:items-end gap-4 mb-4">
          <div className="flex-1">
            <h3 className="text-xl font-semibold text-text-primary">ROI v1</h3>
            <p className="text-sm text-text-secondary">Funil + custos por canal + KPIs operacionais</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <label className="text-sm text-text-secondary">
              Período
              <select
                value={selectedWindowDays}
                onChange={(e) => setSelectedWindowDays(Number(e.target.value))}
                className="ml-2 px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary"
              >
                <option value={7}>Últimos 7 dias</option>
                <option value={30}>Últimos 30 dias</option>
                <option value={90}>Últimos 90 dias</option>
              </select>
            </label>
            <label className="text-sm text-text-secondary">
              Unidade (`locationId`)
              <input
                value={selectedLocationId}
                onChange={(e) => setSelectedLocationId(e.target.value)}
                placeholder="ex.: loja-centro"
                className="ml-2 px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary"
              />
            </label>
            <label className="text-sm text-text-secondary">
              Canal
              <select
                value={selectedChannel}
                onChange={(e) => setSelectedChannel(e.target.value)}
                className="ml-2 px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary"
              >
                <option value="all">Todos</option>
                {channelOptions.map((channel) => (
                  <option key={channel} value={channel}>{channel}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={exportRoiCsv}
              className="px-4 py-2 rounded-lg border border-border-default bg-bg-secondary text-text-primary hover:bg-bg-hover transition-colors"
            >
              Exportar CSV
            </button>
            <button
              type="button"
              onClick={copyFiltersLink}
              className="px-4 py-2 rounded-lg border border-border-default bg-bg-secondary text-text-primary hover:bg-bg-hover transition-colors"
            >
              Copiar link
            </button>
            <button
              type="button"
              onClick={resetAnalyticsFilters}
              className="px-4 py-2 rounded-lg border border-border-default bg-bg-secondary text-text-primary hover:bg-bg-hover transition-colors"
            >
              Limpar filtros
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="p-4 rounded-lg border border-border-default bg-bg-secondary">
            <div className="text-sm text-text-secondary">Receita</div>
            <div className="text-xl font-semibold text-text-primary">{formatMoney(roiRevenue)}</div>
          </div>
          <div className="p-4 rounded-lg border border-border-default bg-bg-secondary">
            <div className="text-sm text-text-secondary">Custo</div>
            <div className="text-xl font-semibold text-text-primary">{formatMoney(roiCost)}</div>
          </div>
          <div className="p-4 rounded-lg border border-border-default bg-bg-secondary">
            <div className="text-sm text-text-secondary">ROI</div>
            <div className="text-xl font-semibold text-text-primary">{roiPercent == null ? 'N/A' : formatRate(roiPercent)}</div>
          </div>
          <div className="p-4 rounded-lg border border-border-default bg-bg-secondary">
            <div className="text-sm text-text-secondary">Margem</div>
            <div className="text-xl font-semibold text-text-primary">{formatMoney(roiMargin)}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="p-4 rounded-lg border border-border-default bg-bg-secondary">
            <div className="text-sm text-text-secondary">Custo operacional</div>
            <div className="text-lg font-semibold text-text-primary">{formatMoney(operationalCosts?.total || 0)}</div>
            <div className="text-xs text-text-secondary">Voz: {formatMoney(operationalCosts?.voice?.estimatedCost || 0)}</div>
          </div>
          <div className="p-4 rounded-lg border border-border-default bg-bg-secondary">
            <div className="text-sm text-text-secondary">Custo blended</div>
            <div className="text-lg font-semibold text-text-primary">{formatMoney(blendedCost)}</div>
            <div className="text-xs text-text-secondary">Marketing + operacional ponta a ponta</div>
          </div>
          <div className="p-4 rounded-lg border border-border-default bg-bg-secondary">
            <div className="text-sm text-text-secondary">ROI blended</div>
            <div className="text-lg font-semibold text-text-primary">{blendedRoiPercent == null ? 'N/A' : formatRate(blendedRoiPercent)}</div>
            <div className="text-xs text-text-secondary">Margem blended: {formatMoney(blendedMargin)}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className="p-4 rounded-lg border border-border-default bg-bg-secondary">
            <div className="text-sm font-medium text-text-primary mb-3">Funil (visual)</div>
            {funnelMetrics?.locationScope?.requested && (
              <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                Escopo estrito por unidade ativo: o funil considera apenas registros com <strong>`location_id`</strong> persistido no marketing. Sem fallback para JSON legado em tempo de consulta.
                <div className="mt-2 space-y-1 text-amber-100/90">
                  <div>
                    Cobertura de leads na janela: <strong>{formatRate(funnelMetrics?.locationScope?.coverage?.leads?.rate)}</strong>
                    {' '}
                    ({funnelMetrics?.locationScope?.coverage?.leads?.withLocation || 0}/{funnelMetrics?.locationScope?.coverage?.leads?.total || 0} com `location_id`).
                  </div>
                  <div>
                    Cobertura de envios de formulário: <strong>{formatRate(funnelMetrics?.locationScope?.coverage?.submissions?.rate)}</strong>
                    {' '}
                    ({funnelMetrics?.locationScope?.coverage?.submissions?.withLocation || 0}/{funnelMetrics?.locationScope?.coverage?.submissions?.total || 0} com `location_id`).
                  </div>
                  <div>
                    Registros fora do recorte por falta de localização persistida: {funnelMetrics?.locationScope?.coverage?.leads?.withoutLocation || 0} leads e {funnelMetrics?.locationScope?.coverage?.submissions?.withoutLocation || 0} envios.
                  </div>
                </div>
              </div>
            )}
            {(funnelMetrics?.stages || []).map((s) => (
              <div key={s.stage} className="mb-3">
                <div className="flex justify-between text-xs text-text-secondary mb-1">
                  <span>{s.stage}</span>
                  <span>{s.total}</span>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 6, height: 8, width: '100%' }}>
                  <div
                    style={{
                      width: `${Math.max(2, Math.round((Number(s.total || 0) / funnelStageMax) * 100))}%`,
                      height: 8,
                      borderRadius: 6,
                      background: 'linear-gradient(90deg, #22c55e, #16a34a)',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="p-4 rounded-lg border border-border-default bg-bg-secondary">
            <div className="text-sm font-medium text-text-primary mb-3">Conversão</div>
            <div className="space-y-2 text-sm text-text-secondary">
              <div className="flex justify-between"><span>Visitante -&gt; Lead</span><strong className="text-text-primary">{formatRate(funnelMetrics?.conversionRates?.visitorToLead)}</strong></div>
              <div className="flex justify-between"><span>Lead -&gt; Cliente</span><strong className="text-text-primary">{formatRate(funnelMetrics?.conversionRates?.leadToCustomer)}</strong></div>
              <div className="flex justify-between"><span>Pedidos</span><strong className="text-text-primary">{funnelMetrics?.totals?.orders || 0}</strong></div>
              <div className="flex justify-between"><span>Receita</span><strong className="text-text-primary">{formatMoney(funnelMetrics?.totals?.revenue || 0)}</strong></div>
            </div>
          </div>
        </div>

        <div className="overflow-auto mb-6">
          <table style={{ width: '100%', fontSize: '13px' }}>
            <thead>
              <tr>
                <th align="left">Canal</th>
                <th align="right">Leads</th>
                <th align="right">Pedidos</th>
                <th align="right">Receita</th>
                <th align="right">Custo</th>
                <th align="right">ROI</th>
                <th align="right">CPL</th>
                <th align="right">CPA</th>
              </tr>
            </thead>
            <tbody>
              {filteredChannels.map((channel) => {
                const leads = Number(leadsByChannel.get(channel) || 0);
                const order = orderByChannel.get(channel) || {};
                const orders = Number(order.orders || 0);
                const revenue = Number(order.revenue || 0);
                const cost = Number(order.cost || 0);
                const rowRoi = cost > 0 ? ((revenue - cost) / cost) : null;
                const cpl = leads > 0 ? (cost / leads) : null;
                const cpa = orders > 0 ? (cost / orders) : null;
                return (
                  <tr key={channel}>
                    <td>{channel}</td>
                    <td align="right">{leads}</td>
                    <td align="right">{orders}</td>
                    <td align="right">{formatMoney(revenue)}</td>
                    <td align="right">{formatMoney(cost)}</td>
                    <td align="right">{rowRoi == null ? '-' : formatRate(rowRoi)}</td>
                    <td align="right">{cpl == null ? '-' : formatMoney(cpl)}</td>
                    <td align="right">{cpa == null ? '-' : formatMoney(cpa)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="overflow-auto mb-6">
          <div className="text-sm font-medium text-text-primary mb-3">Atribuicao ponta a ponta por canal</div>
          <table style={{ width: '100%', fontSize: '13px' }}>
            <thead>
              <tr>
                <th align="left">Canal</th>
                <th align="right">Pedidos</th>
                <th align="right">Receita</th>
                <th align="right">Custo marketing</th>
                <th align="right">Custo operacional</th>
                <th align="right">Custo blended</th>
                <th align="right">Margem</th>
                <th align="right">ROI blended</th>
              </tr>
            </thead>
            <tbody>
              {attributionRows.map((row) => (
                <tr key={`attr-${row.source}`}>
                  <td>{row.source}</td>
                  <td align="right">{Number(row.orders || 0)}</td>
                  <td align="right">{formatMoney(row.revenue || 0)}</td>
                  <td align="right">{formatMoney(row.cost || 0)}</td>
                  <td align="right">{formatMoney(row.operationalCost || 0)}</td>
                  <td align="right">{formatMoney(row.blendedCost || (Number(row.cost || 0) + Number(row.operationalCost || 0)))}</td>
                  <td align="right">{formatMoney(row.margin || 0)}</td>
                  <td align="right">{row.blendedRoi == null ? '-' : formatRate(row.blendedRoi)}</td>
                </tr>
              ))}
              {attributionRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-text-secondary" align="left">Sem dados de atribuição para o filtro atual.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {attributionAlerts.length > 0 && (
          <div className="p-4 rounded-lg border border-border-default bg-bg-secondary mb-6">
            <div className="text-sm font-medium text-text-primary mb-2">Alertas de eficiência</div>
            <ul className="text-sm text-text-secondary space-y-1">
              {attributionAlerts.map((alert) => (
                <li key={alert}>- {alert}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-lg border border-border-default bg-bg-secondary">
            <div className="text-sm text-text-secondary">Pedido -&gt; Pronto</div>
            <div className="text-lg font-semibold text-text-primary">{formatSeconds(orderMetrics?.today?.avgOrderToReadySeconds)}</div>
            <div className="text-xs text-text-secondary">
              SLA {orderMetrics?.today?.slaOrderToReadyMinutes || 0}m • Estouro {orderMetrics?.today?.slaOrderToReadyBreachedCount || 0}
            </div>
          </div>
          <div className="p-4 rounded-lg border border-border-default bg-bg-secondary">
            <div className="text-sm text-text-secondary">Pedido -&gt; Entregue</div>
            <div className="text-lg font-semibold text-text-primary">{formatSeconds(orderMetrics?.today?.avgOrderToDeliverSeconds)}</div>
            <div className="text-xs text-text-secondary">
              SLA {orderMetrics?.today?.slaOrderToDeliverMinutes || 0}m • Estouro {orderMetrics?.today?.slaOrderToDeliverBreachedCount || 0}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <h3 className="text-xl font-semibold text-text-primary mb-4 flex items-center gap-2">
          <span>💰</span>
          <span>ROI (janela {selectedWindowDays} dias)</span>
        </h3>
        {roiMetrics?.ok ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <div className="text-sm text-text-secondary">Receita</div>
                <div className="text-lg font-semibold">{formatMoney(roiMetrics.orders?.totalRevenue || 0)}</div>
                <div className="text-xs text-text-secondary">Pedidos: {roiMetrics.orders?.total || 0}</div>
              </div>
              <div>
                <div className="text-sm text-text-secondary">Leads</div>
                <div className="text-lg font-semibold">{roiMetrics.leads?.total || 0}</div>
                <div className="text-xs text-text-secondary">Receita por lead: {formatMoney(roiMetrics.revenuePerLead || 0)}</div>
              </div>
              <div>
                <div className="text-sm text-text-secondary">ROI</div>
                <div className="text-lg font-semibold">{roiMetrics.roi == null ? 'N/A' : `${Math.round(roiMetrics.roi * 100)}%`}</div>
                <div className="text-xs text-text-secondary">
                  Custo total: {formatMoney(roiMetrics.marketingCost || 0)} • Custo por canal: {formatMoney(roiMetrics.totalChannelCost || 0)}
                </div>
              </div>
            </div>
            {(roiMetrics.orderSources || []).length > 0 && (
              <div className="overflow-auto mt-4">
                <table style={{ width: '100%', fontSize: '13px' }}>
                  <thead>
                    <tr>
                      <th align="left">Fonte</th>
                      <th align="right">Pedidos</th>
                      <th align="right">Receita</th>
                      <th align="right">Custo</th>
                      <th align="right">Custo/Pedido</th>
                      <th align="right">ROI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(roiMetrics.orderSources || []).map((row) => (
                      <tr key={row.source}>
                        <td>{row.source}</td>
                        <td align="right">{row.orders || 0}</td>
                        <td align="right">{formatMoney(row.revenue || 0)}</td>
                        <td align="right">{formatMoney(row.cost || 0)}</td>
                        <td align="right">{row.costPerOrder == null ? '-' : formatMoney(row.costPerOrder)}</td>
                        <td align="right">{row.roi == null ? '-' : formatRate(row.roi)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <div className="text-text-secondary">ROI indisponível.</div>
        )}
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <h3 className="text-xl font-semibold text-text-primary mb-4 flex items-center gap-2">
          <span>🧭</span>
          <span>Funil (janela {selectedWindowDays} dias)</span>
        </h3>
        {funnelMetrics?.ok ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
              <div>
                <div className="text-sm text-text-secondary">Leads</div>
                <div className="text-lg font-semibold">{funnelMetrics.totals?.leads || 0}</div>
              </div>
              <div>
                <div className="text-sm text-text-secondary">Submissões</div>
                <div className="text-lg font-semibold">{funnelMetrics.totals?.formSubmissions || 0}</div>
              </div>
              <div>
                <div className="text-sm text-text-secondary">Pedidos</div>
                <div className="text-lg font-semibold">{funnelMetrics.totals?.orders || 0}</div>
              </div>
              <div>
                <div className="text-sm text-text-secondary">Receita</div>
                <div className="text-lg font-semibold">R$ {Number(funnelMetrics.totals?.revenue || 0).toFixed(2)}</div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div>
                <div className="text-sm text-text-secondary">Conversão Lead -&gt; Cliente</div>
                <div className="text-lg font-semibold">{formatRate(funnelMetrics.conversionRates?.leadToCustomer)}</div>
              </div>
              <div>
                <div className="text-sm text-text-secondary">Leads com Form</div>
                <div className="text-lg font-semibold">{funnelMetrics.totals?.formSubmissionLeads || 0}</div>
              </div>
              <div>
                <div className="text-sm text-text-secondary">Canais (leads)</div>
                <div className="text-lg font-semibold">{funnelMetrics.channels?.length || 0}</div>
              </div>
            </div>
            <div className="overflow-auto">
              <table style={{ width: '100%', fontSize: '13px' }}>
                <thead>
                  <tr>
                    <th align="left">Etapa</th>
                    <th align="left">Total</th>
                    <th align="left">Visual</th>
                  </tr>
                </thead>
                <tbody>
                  {(funnelMetrics.stages || []).map((s) => (
                    <tr key={s.stage}>
                      <td>{s.stage}</td>
                      <td>{s.total}</td>
                      <td>
                        <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 6, height: 8, width: '100%' }}>
                          <div
                            style={{
                              width: `${Math.max(2, Math.round((Number(s.total || 0) / funnelStageMax) * 100))}%`,
                              height: 8,
                              borderRadius: 6,
                              background: 'linear-gradient(90deg, #22c55e, #16a34a)',
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(funnelMetrics.channels || []).length > 0 && (
              <div className="overflow-auto mt-4">
                <table style={{ width: '100%', fontSize: '13px' }}>
                  <thead>
                    <tr>
                      <th align="left">Canal</th>
                      <th align="right">Leads</th>
                      <th align="right">Custo</th>
                      <th align="right">Custo/Lead</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(funnelMetrics.channels || []).map((c) => (
                      <tr key={c.channel}>
                        <td>{c.channel}</td>
                        <td align="right">{c.leads || 0}</td>
                        <td align="right">{formatMoney(c.cost || 0)}</td>
                        <td align="right">{c.costPerLead == null ? '-' : formatMoney(c.costPerLead)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {(funnelMetrics.orderSources || []).length > 0 && (
              <div className="overflow-auto mt-4">
                <table style={{ width: '100%', fontSize: '13px' }}>
                  <thead>
                    <tr>
                      <th align="left">Fonte (Pedidos)</th>
                      <th align="right">Pedidos</th>
                      <th align="right">Receita</th>
                      <th align="right">Custo</th>
                      <th align="right">Custo/Pedido</th>
                      <th align="right">ROI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(funnelMetrics.orderSources || []).map((row) => (
                      <tr key={row.source}>
                        <td>{row.source}</td>
                        <td align="right">{row.orders || 0}</td>
                        <td align="right">{formatMoney(row.revenue || 0)}</td>
                        <td align="right">{formatMoney(row.cost || 0)}</td>
                        <td align="right">{row.costPerOrder == null ? '-' : formatMoney(row.costPerOrder)}</td>
                        <td align="right">{row.roi == null ? '-' : formatRate(row.roi)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <div className="text-text-secondary">Funil indisponível.</div>
        )}
      </div>
    </>
  );
}
