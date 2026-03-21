import React from 'react';

export function PbxRoutingTabs({
  tab,
  loading,
  AGENTS_FIELD_CLASS,
  AGENTS_SELECT_CLASS,
  formTrunk,
  setFormTrunk,
  canSaveTrunk,
  handleSaveTrunk,
  filteredTrunks,
  formRoute,
  setFormRoute,
  canSaveRoute,
  handleSaveRoute,
  trunks,
  queues,
  filteredRoutes,
  formDid,
  setFormDid,
  canSaveDid,
  handleSaveDid,
  ivrRules,
  filteredDids,
  formIvr,
  setFormIvr,
  canSaveIvr,
  handleSaveIvr,
  filteredIvrRules,
  Button,
}) {
  return (
    <>
      {tab === 'trunks' ? (
        <>
          <h3 style={{ marginTop: 0 }}>Troncos (PJSIP mínimo)</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '220px 160px 180px 1fr 1fr auto', gap: 8, marginBottom: 12 }}>
            <input placeholder="Nome" value={formTrunk.name} onChange={(e) => setFormTrunk((s) => ({ ...s, name: e.target.value }))} />
            <select value={formTrunk.type} onChange={(e) => setFormTrunk((s) => ({ ...s, type: e.target.value }))}>
              <option value="pjsip">pjsip</option>
              <option value="iax">iax</option>
            </select>
            <input placeholder="Transport" value={formTrunk.transport} onChange={(e) => setFormTrunk((s) => ({ ...s, transport: e.target.value }))} />
            <input placeholder="Auth username" value={formTrunk.authUsername} onChange={(e) => setFormTrunk((s) => ({ ...s, authUsername: e.target.value }))} />
            <input placeholder="Auth password" value={formTrunk.authPassword} onChange={(e) => setFormTrunk((s) => ({ ...s, authPassword: e.target.value }))} />
            <button onClick={handleSaveTrunk} disabled={!canSaveTrunk || loading} style={{ padding: '8px 12px' }}>Salvar</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: 8, marginBottom: 12 }}>
            <input placeholder="AOR contact (ex: sip:provider.com)" value={formTrunk.aorContact} onChange={(e) => setFormTrunk((s) => ({ ...s, aorContact: e.target.value }))} />
            <input placeholder="Allow codecs" value={formTrunk.endpointAllow} onChange={(e) => setFormTrunk((s) => ({ ...s, endpointAllow: e.target.value }))} />
          </div>

          <div style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Nome</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Tipo</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Transport</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredTrunks.map((t) => (
                  <tr key={t.id}>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{t.name}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{t.type}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{t.transport || '—'}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{t.status}</td>
                  </tr>
                ))}
                {!filteredTrunks.length ? <tr><td colSpan={4} style={{ padding: 8, opacity: 0.75 }}>Nenhum tronco encontrado.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {tab === 'routes' ? (
        <>
          <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
            <h3 className="text-xl font-semibold text-text-primary mb-2">Rotas (produto)</h3>
            <p className="text-sm text-text-secondary mb-6">
              Configure como a discagem deve ser reconhecida e para onde a chamada deve ir.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-4 mb-4">
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">Direção</label>
                <select className={AGENTS_SELECT_CLASS} value={formRoute.direction} onChange={(e) => setFormRoute((s) => ({ ...s, direction: e.target.value }))}>
                  <option value="inbound">Entrada</option>
                  <option value="outbound">Saída</option>
                </select>
              </div>
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">Nome</label>
                <input className={AGENTS_FIELD_CLASS} placeholder="Nome" value={formRoute.name} onChange={(e) => setFormRoute((s) => ({ ...s, name: e.target.value }))} />
              </div>
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">Prioridade</label>
                <input className={AGENTS_FIELD_CLASS} placeholder="Prioridade" type="number" value={formRoute.priority} onChange={(e) => setFormRoute((s) => ({ ...s, priority: e.target.value }))} />
              </div>
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">Status</label>
                <label className="h-[42px] px-3 border border-border-default rounded-lg bg-bg-secondary flex items-center gap-2 text-sm text-text-primary">
                  <input className="w-auto h-auto" type="checkbox" checked={!!formRoute.enabled} onChange={(e) => setFormRoute((s) => ({ ...s, enabled: e.target.checked }))} />
                  ativo
                </label>
              </div>
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">Discagem</label>
                <select className={AGENTS_SELECT_CLASS} value={formRoute.matchMode} onChange={(e) => setFormRoute((s) => ({ ...s, matchMode: e.target.value }))}>
                  <option value="prefix_any">Discagem com prefixo</option>
                  <option value="exact">Número exato</option>
                </select>
              </div>
              <div className="flex items-end">
                <Button onClick={handleSaveRoute} disabled={!canSaveRoute || loading} variant="primary" className="w-full">
                  Salvar
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">{formRoute.matchMode === 'exact' ? 'Número exato' : 'Prefixo da discagem'}</label>
                {formRoute.matchMode === 'exact' ? (
                  <input className={AGENTS_FIELD_CLASS} placeholder="Ex: 011" value={formRoute.exactExten} onChange={(e) => setFormRoute((s) => ({ ...s, exactExten: e.target.value }))} />
                ) : (
                  <input className={AGENTS_FIELD_CLASS} placeholder="Ex: 9" value={formRoute.dialPrefix} onChange={(e) => setFormRoute((s) => ({ ...s, dialPrefix: e.target.value }))} />
                )}
              </div>
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">Destino</label>
                <select className={AGENTS_SELECT_CLASS} value={formRoute.actionType} onChange={(e) => setFormRoute((s) => ({ ...s, actionType: e.target.value, actionRef: '' }))}>
                  <option value="hangup">Desligar</option>
                  <option value="trunk">Tronco</option>
                  <option value="extension">Ramal</option>
                  <option value="queue">Fila</option>
                </select>
              </div>
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">Referência</label>
                {formRoute.actionType === 'trunk' ? (
                  <select className={AGENTS_SELECT_CLASS} value={formRoute.actionRef} onChange={(e) => setFormRoute((s) => ({ ...s, actionRef: e.target.value }))}>
                    <option value="">Selecione…</option>
                    {(trunks || []).map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
                  </select>
                ) : formRoute.actionType === 'queue' ? (
                  <select className={AGENTS_SELECT_CLASS} value={formRoute.actionRef} onChange={(e) => setFormRoute((s) => ({ ...s, actionRef: e.target.value }))}>
                    <option value="">Selecione…</option>
                    {(queues || []).map((q) => <option key={q.id} value={q.name}>{q.name}</option>)}
                  </select>
                ) : formRoute.actionType === 'hangup' ? (
                  <input className={AGENTS_FIELD_CLASS} value="(não se aplica)" disabled />
                ) : (
                  <input className={AGENTS_FIELD_CLASS} placeholder="Ex: 1001" value={formRoute.actionRef} onChange={(e) => setFormRoute((s) => ({ ...s, actionRef: e.target.value }))} />
                )}
              </div>
            </div>

            {formRoute.actionType === 'trunk' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">Remover prefixo (dígitos)</label>
                  <input className={AGENTS_FIELD_CLASS} placeholder="Ex: 1" type="number" value={formRoute.stripPrefixLen} onChange={(e) => setFormRoute((s) => ({ ...s, stripPrefixLen: e.target.value }))} />
                </div>
                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">Adicionar prefixo</label>
                  <input className={AGENTS_FIELD_CLASS} placeholder="Ex: 0" value={formRoute.addPrefix} onChange={(e) => setFormRoute((s) => ({ ...s, addPrefix: e.target.value }))} />
                </div>
              </div>
            ) : null}
          </div>

          <div className="bg-bg-elevated rounded-xl border border-border-default overflow-hidden shadow-lg">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-bg-secondary border-b border-border-default">
                    <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">Direção</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">Nome</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">Discagem</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">Destino</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">Prioridade</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">Enabled</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRoutes.map((r) => (
                    <tr key={r.id} className="border-b border-border-default hover:bg-bg-hover transition-colors">
                      <td className="px-4 py-3 text-sm text-text-primary">{r.direction === 'inbound' ? 'Entrada' : r.direction === 'outbound' ? 'Saída' : (r.direction || '—')}</td>
                      <td className="px-4 py-3 text-sm text-text-primary">{r.name}</td>
                      <td className="px-4 py-3 text-sm text-text-primary">{r?.match?.exten || r?.match?.pattern || '—'}</td>
                      <td className="px-4 py-3 text-sm text-text-primary">
                        {r?.actions?.[0]?.type ? `${r.actions[0].type}${r.actions[0].ref ? `: ${r.actions[0].ref}` : ''}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-text-secondary">{r.priority}</td>
                      <td className="px-4 py-3 text-sm text-text-secondary">{r.enabled ? 'sim' : 'não'}</td>
                    </tr>
                  ))}
                  {!filteredRoutes.length ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-4 text-sm text-text-secondary">Nenhuma rota encontrada.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}

      {tab === 'dids' ? (
        <>
          <h3 style={{ marginTop: 0 }}>DIDs (entrada)</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '220px 120px 220px 1fr auto', gap: 8, marginBottom: 12 }}>
            <input placeholder="DID (ex: 551199999999)" value={formDid.did} onChange={(e) => setFormDid((s) => ({ ...s, did: e.target.value }))} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={!!formDid.enabled} onChange={(e) => setFormDid((s) => ({ ...s, enabled: e.target.checked }))} />
              ativo
            </label>
            <select value={formDid.destinationType} onChange={(e) => setFormDid((s) => ({ ...s, destinationType: e.target.value, destinationRef: '' }))}>
              <option value="extension">Ramal</option>
              <option value="queue">Fila</option>
              <option value="ivr">URA</option>
              <option value="hangup">Desligar</option>
            </select>
            {formDid.destinationType === 'queue' ? (
              <select value={formDid.destinationRef} onChange={(e) => setFormDid((s) => ({ ...s, destinationRef: e.target.value }))}>
                <option value="">Selecione…</option>
                {(queues || []).map((q) => <option key={q.id} value={q.name}>{q.name}</option>)}
              </select>
            ) : formDid.destinationType === 'ivr' ? (
              <select value={formDid.destinationRef} onChange={(e) => setFormDid((s) => ({ ...s, destinationRef: e.target.value }))}>
                <option value="">Selecione…</option>
                {(ivrRules || []).map((r) => {
                  const suffix = String(r?.definition?.contextSuffix || r?.name || r?.id || '').replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 24);
                  return <option key={r.id} value={suffix}>{r.name || suffix}</option>;
                })}
              </select>
            ) : formDid.destinationType === 'hangup' ? (
              <input value="(não se aplica)" disabled />
            ) : (
              <input placeholder="Ex: 1001" value={formDid.destinationRef} onChange={(e) => setFormDid((s) => ({ ...s, destinationRef: e.target.value }))} />
            )}
            <button onClick={handleSaveDid} disabled={!canSaveDid || loading} style={{ padding: '8px 12px' }}>Salvar</button>
          </div>
          <div style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>DID</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Destino</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Enabled</th>
                </tr>
              </thead>
              <tbody>
                {filteredDids.map((d) => (
                  <tr key={d.id}>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{d.did}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      {d?.actions?.[0]?.type ? `${d.actions[0].type}${d.actions[0].ref ? `: ${d.actions[0].ref}` : ''}` : '—'}
                    </td>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{d.enabled ? 'sim' : 'não'}</td>
                  </tr>
                ))}
                {!filteredDids.length ? <tr><td colSpan={3} style={{ padding: 8, opacity: 0.75 }}>Nenhum DID encontrado.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {tab === 'ivr' ? (
        <>
          <h3 style={{ marginTop: 0 }}>IVR (dialplan raw)</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '220px 220px 120px auto', gap: 8, marginBottom: 12 }}>
            <input placeholder="Nome" value={formIvr.name} onChange={(e) => setFormIvr((s) => ({ ...s, name: e.target.value }))} />
            <input placeholder="Context suffix (opcional)" value={formIvr.contextSuffix} onChange={(e) => setFormIvr((s) => ({ ...s, contextSuffix: e.target.value }))} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={!!formIvr.enabled} onChange={(e) => setFormIvr((s) => ({ ...s, enabled: e.target.checked }))} />
              ativo
            </label>
            <button onClick={handleSaveIvr} disabled={!canSaveIvr || loading} style={{ padding: '8px 12px' }}>Salvar</button>
          </div>
          <textarea
            value={formIvr.dialplanText}
            onChange={(e) => setFormIvr((s) => ({ ...s, dialplanText: e.target.value }))}
            rows={10}
            style={{ width: '100%', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}
          />
          <div style={{ marginTop: 12, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Nome</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Enabled</th>
                </tr>
              </thead>
              <tbody>
                {filteredIvrRules.map((r) => (
                  <tr key={r.id}>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{r.name}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{String(r.enabled)}</td>
                  </tr>
                ))}
                {!filteredIvrRules.length ? <tr><td colSpan={2} style={{ padding: 8, opacity: 0.75 }}>Nenhuma regra IVR encontrada.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </>
  );
}