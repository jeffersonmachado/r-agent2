import React from 'react';

export function PbxDashboardShell({
  isSectionMode,
  currentSectionLabel,
  sectionHint,
  lastUpdatedAt,
  formatDateTime,
  navigate,
  refreshAll,
  loading,
  handleDialplanApply,
  handleAsteriskReload,
  error,
  searchText,
  setSearchText,
  navSearchTerm,
  setNavSearchTerm,
  tab,
  openPbxSection,
  dashboardSections,
  hasTopFilters,
  setNavCategory,
  overviewTopCards,
  getDashboardIconPalette,
  PbxDashboardIcon,
  queueSnapshotTop,
  filteredDashboardSections,
  getDashboardIconName,
  Button,
}) {
  return (
    <>
      <div className="pbx-toolbar-row">
        <div>
          {isSectionMode ? (
            <>
              <h1>📞 PBX • {currentSectionLabel}</h1>
              <p>
                {sectionHint || 'Gerencie esta seção do PBX com o mesmo padrão visual do painel de agentes.'}
              </p>
            </>
          ) : (
            <>
              <h1>📞 PBX (Postgres + Asterisk Realtime)</h1>
              <p>
                CRUD no Postgres + materialização no Realtime. Use “Dialplan” para gerar/aplicar o dialplan realtime.
              </p>
            </>
          )}
          {lastUpdatedAt ? (
            <p style={{ marginTop: 8, marginBottom: 0, fontSize: 12, opacity: 0.8 }}>
              Atualizado em: {formatDateTime(lastUpdatedAt)}
            </p>
          ) : null}
        </div>
        <div className="pbx-actions support-controls">
          {isSectionMode ? (
            <>
              <button onClick={() => navigate('/pbx')} disabled={loading} className="btn-default px-4 py-2 text-sm">
                Voltar ao Dashboard PBX
              </button>
              <button onClick={refreshAll} disabled={loading} className="btn-default px-4 py-2 text-sm">
                {loading ? 'Atualizando…' : 'Atualizar seção'}
              </button>
            </>
          ) : (
            <>
              <button onClick={refreshAll} disabled={loading} className="btn-default px-4 py-2 text-sm">
                {loading ? 'Atualizando…' : 'Atualizar tudo'}
              </button>
              <button onClick={() => navigate('/pbx/provisioning-lote')} disabled={loading} className="btn-default px-4 py-2 text-sm">
                Provisionamento em lote
              </button>
              <button onClick={handleDialplanApply} disabled={loading} className="btn-primary px-4 py-2 text-sm">
                Aplicar dialplan
              </button>
              <button onClick={handleAsteriskReload} disabled={loading} className="btn-default px-4 py-2 text-sm">
                Reload Asterisk
              </button>
            </>
          )}
        </div>
      </div>

      {error ? (
        <div className="pbx-error">
          <strong>Erro:</strong> {error}
        </div>
      ) : null}

      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
          <span>🔍</span>
          <span>Filtros</span>
        </h3>
        <div className={`grid grid-cols-1 ${isSectionMode ? 'md:grid-cols-3' : 'md:grid-cols-4'} gap-6`}>
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">Buscar</label>
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Nome, ID, ramal, DID..."
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
              disabled={loading}
            />
          </div>
          {!isSectionMode ? (
            <div>
              <label className="block mb-2 text-sm font-medium text-text-primary">Buscar card</label>
              <input
                type="text"
                value={navSearchTerm}
                onChange={(e) => setNavSearchTerm(e.target.value)}
                placeholder="Nome ou descrição do card..."
                className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
              />
            </div>
          ) : null}
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">Seção PBX</label>
            <select
              value={tab}
              onChange={(e) => openPbxSection(e.target.value)}
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all appearance-none cursor-pointer hover:border-border-hover"
              disabled={loading}
            >
              {dashboardSections.flatMap((section) => (section.items || []).map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              )))}
            </select>
          </div>
          <div className="flex items-end">
            <Button
              onClick={() => {
                setSearchText('');
                setNavSearchTerm('');
                setNavCategory('');
              }}
              disabled={!hasTopFilters}
              className="w-full"
            >
              Limpar Filtros
            </Button>
          </div>
        </div>
      </div>

      {!isSectionMode ? (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
          {overviewTopCards.map((card, idx) => {
            const palette = getDashboardIconPalette('PBX: Operação', idx);
            return (
              <button
                key={card.key}
                onClick={() => openPbxSection(card.key)}
                disabled={loading}
                className="pbx-top-overview-card bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg text-left"
              >
                <div className="pbx-top-overview-head">
                  <div className="text-xs text-text-tertiary">{card.label}</div>
                  <div className={`${palette} w-12 h-12 rounded-lg flex items-center justify-center text-2xl`}>
                    <PbxDashboardIcon name={card.icon} />
                  </div>
                </div>
                <div className="text-2xl font-semibold text-text-primary">{card.value}</div>
                <div className="text-xs text-text-secondary">{card.subtitle}</div>
              </button>
            );
          })}
        </div>
      ) : null}

      {!isSectionMode ? (
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
          <h3 className="text-xl font-semibold text-text-primary mb-4 flex items-center gap-2">
            <span>📥</span>
            <span>Snapshot de filas</span>
          </h3>
          {queueSnapshotTop.length === 0 ? (
            <div className="text-sm text-text-secondary">Sem métricas de fila para exibir.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              {queueSnapshotTop.map((q, idx) => (
                <div key={q?.id || q?.name || `queue-${idx}`} className="bg-bg-secondary rounded-lg border border-border-default p-4">
                  <div className="text-xs text-text-tertiary truncate">{q?.name || 'Fila'}</div>
                  <div className="text-lg font-semibold text-text-primary">{Number(q?.totalMembers) || 0}</div>
                  <div className="text-xs text-text-secondary">
                    ativos: {Number(q?.activeMembers) || 0} · pausados: {Number(q?.pausedMembers) || 0}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {!isSectionMode ? (
        <div className="pbx-dashboard-nav">
          {filteredDashboardSections.length === 0 ? (
            <div className="bg-bg-elevated rounded-xl border border-border-default p-6 text-sm text-text-secondary">
              Nenhum card encontrado para o filtro aplicado.
            </div>
          ) : filteredDashboardSections.map((section) => (
            <div key={section.title} className="pbx-dashboard-section">
              <h4 className="pbx-dashboard-title">{section.title}</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {section.items.map((item, itemIndex) => (
                  <button
                    key={item.key}
                    onClick={() => openPbxSection(item.key)}
                    disabled={loading}
                    className={`bg-bg-elevated rounded-xl border border-border-default hover:shadow-lg transition-shadow p-4 text-left ${tab === item.key ? 'ring-2 ring-accent-primary border-accent-primary' : ''}`}
                  >
                    {(() => {
                      const palette = getDashboardIconPalette(section.title, itemIndex);
                      const sectionTitle = String(section?.title || 'PBX');
                      return (
                        <div className="flex items-start justify-between mb-3">
                          <div className={`${palette} w-12 h-12 rounded-lg flex items-center justify-center text-2xl`}>
                            <PbxDashboardIcon name={getDashboardIconName(item, sectionTitle.replace(/^Referência:\s*/, ''), itemIndex)} />
                          </div>
                          <span className="text-xs text-text-tertiary bg-bg-secondary px-2 py-1 rounded">
                            {sectionTitle}
                          </span>
                        </div>
                      );
                    })()}
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-base font-semibold text-text-primary">{item.label}</span>
                      {Number.isFinite(item.count) ? (
                        <span className="text-xs text-text-tertiary bg-bg-secondary px-2 py-1 rounded">{item.count}</span>
                      ) : null}
                    </div>
                    {item.hint ? (
                      <div className="text-sm text-text-secondary mt-1">{item.hint}</div>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}