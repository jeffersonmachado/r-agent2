import React, { useEffect, useMemo, useState } from 'react';
import {
  dialplanApply,
  dialplanPreview,
  listAudioAssets,
  listCallRules,
  listCdr,
  listDids,
  listExtensions,
  listQueueMembers,
  listQueues,
  listRecordings,
  listRoutes,
  listTrunks,
  scanRecordings,
  upsertCallRule,
  upsertDid,
  upsertExtension,
  bulkUpsertExtensions,
  upsertQueue,
  upsertQueueMember,
  upsertRoute,
  upsertTrunk,
  pbxReload,
  getProvisioningToken,
  rotateProvisioningToken,
  uploadAudioAsset,
  deleteQueueMember,
} from '../api/pbx';
import { buildApiUrl } from '../api/client';
import logger from '../utils/logger';

function safeJsonParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function PbxPage() {
  const [tab, setTab] = useState('extensions');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [extensions, setExtensions] = useState([]);
  const [trunks, setTrunks] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [queues, setQueues] = useState([]);
  const [dids, setDids] = useState([]);
  const [ivrRules, setIvrRules] = useState([]);

  const [queueMembers, setQueueMembers] = useState([]);
  const [selectedQueueId, setSelectedQueueId] = useState('');

  const [audioKind, setAudioKind] = useState('ivr');
  const [audioAssets, setAudioAssets] = useState([]);
  const [audioFile, setAudioFile] = useState(null);

  const [recordings, setRecordings] = useState([]);

  const [cdrFilters, setCdrFilters] = useState({ limit: 200, from: '', to: '', src: '', dst: '', uniqueid: '' });
  const [cdrItems, setCdrItems] = useState([]);

  const [dialplanRows, setDialplanRows] = useState(null);

  const [formExt, setFormExt] = useState({
    extension: '',
    displayName: '',
    authUsername: '',
    authPassword: '',
    provisioningEnabled: false,
    provisioningVendor: 'grandstream',
    provisioningMac: '',
    provisioningModel: '',
  });
  const [provisioningToken, setProvisioningToken] = useState(null);
  const [provisioningTokenExpiresAt, setProvisioningTokenExpiresAt] = useState(null);
  const [provisioningTokenUpdatedAt, setProvisioningTokenUpdatedAt] = useState(null);
  const [rotateExpiresInSec, setRotateExpiresInSec] = useState('');
  const [rotatedToken, setRotatedToken] = useState(null);
  const [bulkJson, setBulkJson] = useState('[\n  {\n    "extension": "1001",\n    "displayName": "Ramal 1001",\n    "authUsername": "1001",\n    "authPassword": "SenhaForte123",\n    "provisioning": {\n      "enabled": true,\n      "vendor": "grandstream",\n      "mac": "001122AABBCC",\n      "model": "GXP1620"\n    }\n  }\n]');
  const [bulkResult, setBulkResult] = useState(null);
  const canSaveExt = useMemo(() => {
    const extOk = (formExt.extension || '').trim().length > 0;
    if (!extOk) return false;
    if (!formExt.provisioningEnabled) return true;
    const vendor = String(formExt.provisioningVendor || '').trim().toLowerCase();
    const vendorOk = vendor === 'grandstream' || vendor === 'avaya';
    const mac = String(formExt.provisioningMac || '').trim().replace(/[^a-fA-F0-9]/g, '').toUpperCase();
    return vendorOk && mac.length === 12;
  }, [
    formExt.extension,
    formExt.provisioningEnabled,
    formExt.provisioningVendor,
    formExt.provisioningMac,
  ]);

  const [formTrunk, setFormTrunk] = useState({
    name: '',
    type: 'pjsip',
    transport: '',
    authUsername: '',
    authPassword: '',
    aorContact: '',
    endpointAllow: 'ulaw,alaw',
  });
  const canSaveTrunk = useMemo(() => (formTrunk.name || '').trim().length > 0, [formTrunk.name]);

  const [formRoute, setFormRoute] = useState({
    direction: 'outbound',
    name: '',
    priority: 100,
    enabled: true,
    matchJson: '{"pattern":"_X."}',
    actionsJson: '[{"type":"hangup"}]',
  });
  const canSaveRoute = useMemo(() => (formRoute.name || '').trim().length > 0, [formRoute.name]);

  const [formQueue, setFormQueue] = useState({ name: '', displayName: '', strategy: 'ringall', optionsJson: '{"timeout":15}' });
  const canSaveQueue = useMemo(() => (formQueue.name || '').trim().length > 0, [formQueue.name]);

  const [formDid, setFormDid] = useState({ did: '', enabled: true, matchJson: '{}', actionsJson: '[{"type":"extension","ref":"1001"}]' });
  const canSaveDid = useMemo(() => (formDid.did || '').trim().length > 0, [formDid.did]);

  const [formIvr, setFormIvr] = useState({
    name: '',
    contextSuffix: '',
    dialplanText: `[ivr]\nexten => s,1,NoOp(IVR)\nexten => s,n,Hangup()`,
    enabled: true,
  });
  const canSaveIvr = useMemo(() => (formIvr.name || '').trim().length > 0, [formIvr.name]);

  const [formQm, setFormQm] = useState({ memberType: 'extension', memberRef: '', penalty: '', paused: false });
  const canSaveQm = useMemo(() => selectedQueueId && (formQm.memberRef || '').trim().length > 0, [selectedQueueId, formQm.memberRef]);

  async function refreshCore() {
    const [rExt, rTrunks, rRoutes, rQueues, rDids, rRules] = await Promise.all([
      listExtensions(),
      listTrunks(),
      listRoutes(),
      listQueues(),
      listDids(),
      listCallRules('ivr_dialplan_text'),
    ]);
    setExtensions(rExt?.items || []);
    setTrunks(rTrunks?.items || []);
    setRoutes(rRoutes?.items || []);
    setQueues(rQueues?.items || []);
    setDids(rDids?.items || []);
    setIvrRules(rRules?.items || []);

    try {
      const tokenInfo = await getProvisioningToken();
      if (tokenInfo?.ok) {
        setProvisioningToken(tokenInfo.token || null);
        setProvisioningTokenExpiresAt(tokenInfo.expiresAt || null);
        setProvisioningTokenUpdatedAt(tokenInfo.updatedAt || null);
      }
    } catch (_) {}

    // Keep selected queue id stable when possible
    const qItems = rQueues?.items || [];
    if (!selectedQueueId && qItems[0]?.id) setSelectedQueueId(String(qItems[0].id));
  }

  async function refreshAux() {
    const [rAudio, rRec] = await Promise.all([
      listAudioAssets(audioKind),
      listRecordings(200),
    ]);
    setAudioAssets(rAudio?.items || []);
    setRecordings(rRec?.items || []);
  }

  async function refreshAll() {
    setLoading(true);
    setError(null);
    try {
      await refreshCore();
      await refreshAux();
    } catch (e) {
      logger.error('[PbxPage] refresh failed', e);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshQueueMembers(queueId) {
    if (!queueId) {
      setQueueMembers([]);
      return;
    }
    const r = await listQueueMembers(queueId);
    setQueueMembers(r?.items || []);
  }

  useEffect(() => {
    refreshQueueMembers(selectedQueueId).catch((e) => {
      logger.error('[PbxPage] refreshQueueMembers failed', e);
      setError(e?.message || String(e));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedQueueId]);

  async function handleSaveExtension() {
    if (!canSaveExt) return;
    setLoading(true);
    setError(null);
    try {
      const provisioning = formExt.provisioningEnabled ? {
        enabled: true,
        vendor: (formExt.provisioningVendor || '').trim().toLowerCase(),
        mac: (formExt.provisioningMac || '').trim(),
        model: (formExt.provisioningModel || '').trim() || null,
      } : null;

      await upsertExtension({
        extension: (formExt.extension || '').trim(),
        displayName: (formExt.displayName || '').trim() || null,
        authUsername: (formExt.authUsername || '').trim() || null,
        authPassword: (formExt.authPassword || '').trim() || null,
        provisioning,
      });
      setFormExt({
        extension: '',
        displayName: '',
        authUsername: '',
        authPassword: '',
        provisioningEnabled: false,
        provisioningVendor: 'grandstream',
        provisioningMac: '',
        provisioningModel: '',
      });
      await refreshCore();
    } catch (e) {
      logger.error('[PbxPage] save extension failed', e);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleRotateProvisioningToken() {
    setLoading(true);
    setError(null);
    try {
      const exp = rotateExpiresInSec ? Number(rotateExpiresInSec) : null;
      const out = await rotateProvisioningToken(Number.isFinite(exp) ? exp : null);
      if (out?.ok && out?.token) {
        setRotatedToken(out.token);
        await refreshCore();
      }
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleBulkProvisioning() {
    setLoading(true);
    setError(null);
    setBulkResult(null);
    try {
      const parsed = safeJsonParse(bulkJson, null);
      const items = Array.isArray(parsed)
        ? parsed
        : (parsed && Array.isArray(parsed.items) ? parsed.items : null);
      if (!items || items.length === 0) {
        setError('JSON inválido. Envie um array de itens.');
        return;
      }
      const out = await bulkUpsertExtensions(items);
      setBulkResult(out);
      await refreshCore();
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveTrunk() {
    if (!canSaveTrunk) return;
    setLoading(true);
    setError(null);
    try {
      await upsertTrunk({
        name: (formTrunk.name || '').trim(),
        type: (formTrunk.type || 'pjsip').trim(),
        transport: (formTrunk.transport || '').trim() || null,
        auth: {
          username: (formTrunk.authUsername || '').trim() || null,
          password: (formTrunk.authPassword || '').trim() || null,
        },
        aor: { contact: (formTrunk.aorContact || '').trim() || null, maxContacts: 1 },
        endpoint: { allow: (formTrunk.endpointAllow || '').trim() || null, disallow: 'all', direct_media: 'no' },
      });
      setFormTrunk({
        name: '',
        type: 'pjsip',
        transport: '',
        authUsername: '',
        authPassword: '',
        aorContact: '',
        endpointAllow: 'ulaw,alaw',
      });
      await refreshCore();
    } catch (e) {
      logger.error('[PbxPage] save trunk failed', e);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveRoute() {
    if (!canSaveRoute) return;
    setLoading(true);
    setError(null);
    try {
      await upsertRoute({
        direction: formRoute.direction,
        name: (formRoute.name || '').trim(),
        enabled: !!formRoute.enabled,
        priority: Number(formRoute.priority || 100),
        match: safeJsonParse(formRoute.matchJson, {}),
        actions: safeJsonParse(formRoute.actionsJson, []),
      });
      setFormRoute({
        direction: 'outbound',
        name: '',
        priority: 100,
        enabled: true,
        matchJson: '{"pattern":"_X."}',
        actionsJson: '[{"type":"hangup"}]',
      });
      await refreshCore();
    } catch (e) {
      logger.error('[PbxPage] save route failed', e);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveQueue() {
    if (!canSaveQueue) return;
    setLoading(true);
    setError(null);
    try {
      await upsertQueue({
        name: (formQueue.name || '').trim(),
        displayName: (formQueue.displayName || '').trim() || null,
        strategy: (formQueue.strategy || '').trim() || null,
        options: safeJsonParse(formQueue.optionsJson, {}),
      });
      setFormQueue({ name: '', displayName: '', strategy: 'ringall', optionsJson: '{"timeout":15}' });
      await refreshCore();
    } catch (e) {
      logger.error('[PbxPage] save queue failed', e);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveDid() {
    if (!canSaveDid) return;
    setLoading(true);
    setError(null);
    try {
      await upsertDid({
        did: (formDid.did || '').trim(),
        enabled: !!formDid.enabled,
        match: safeJsonParse(formDid.matchJson, {}),
        actions: safeJsonParse(formDid.actionsJson, []),
      });
      setFormDid({ did: '', enabled: true, matchJson: '{}', actionsJson: '[{"type":"extension","ref":"1001"}]' });
      await refreshCore();
    } catch (e) {
      logger.error('[PbxPage] save did failed', e);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveIvr() {
    if (!canSaveIvr) return;
    setLoading(true);
    setError(null);
    try {
      await upsertCallRule({
        type: 'ivr_dialplan_text',
        name: (formIvr.name || '').trim(),
        enabled: !!formIvr.enabled,
        definition: {
          contextSuffix: (formIvr.contextSuffix || '').trim() || (formIvr.name || '').trim(),
          dialplanText: String(formIvr.dialplanText || ''),
        },
      });
      setFormIvr({
        name: '',
        contextSuffix: '',
        dialplanText: `[ivr]\nexten => s,1,NoOp(IVR)\nexten => s,n,Hangup()`,
        enabled: true,
      });
      await refreshCore();
    } catch (e) {
      logger.error('[PbxPage] save ivr failed', e);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveQueueMember() {
    if (!canSaveQm) return;
    setLoading(true);
    setError(null);
    try {
      await upsertQueueMember({
        queueId: selectedQueueId,
        memberType: formQm.memberType,
        memberRef: (formQm.memberRef || '').trim(),
        penalty: formQm.penalty === '' ? null : Number(formQm.penalty),
        paused: !!formQm.paused,
      });
      setFormQm({ memberType: 'extension', memberRef: '', penalty: '', paused: false });
      await refreshQueueMembers(selectedQueueId);
    } catch (e) {
      logger.error('[PbxPage] save queue member failed', e);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteQueueMember(id) {
    setLoading(true);
    setError(null);
    try {
      await deleteQueueMember(id);
      await refreshQueueMembers(selectedQueueId);
    } catch (e) {
      logger.error('[PbxPage] delete queue member failed', e);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleDialplanPreview() {
    setLoading(true);
    setError(null);
    try {
      const r = await dialplanPreview();
      setDialplanRows(r?.rows || []);
    } catch (e) {
      logger.error('[PbxPage] dialplan preview failed', e);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleDialplanApply() {
    setLoading(true);
    setError(null);
    try {
      await dialplanApply();
      await handleDialplanPreview();
    } catch (e) {
      logger.error('[PbxPage] dialplan apply failed', e);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleAsteriskReload() {
    setLoading(true);
    setError(null);
    try {
      await pbxReload();
    } catch (e) {
      logger.error('[PbxPage] asterisk reload failed', e);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleAudioRefresh() {
    setLoading(true);
    setError(null);
    try {
      const r = await listAudioAssets(audioKind);
      setAudioAssets(r?.items || []);
    } catch (e) {
      logger.error('[PbxPage] audio refresh failed', e);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleAudioUpload() {
    setLoading(true);
    setError(null);
    try {
      await uploadAudioAsset({ kind: audioKind, file: audioFile });
      setAudioFile(null);
      await handleAudioRefresh();
    } catch (e) {
      logger.error('[PbxPage] audio upload failed', e);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleRecordingsRefresh() {
    setLoading(true);
    setError(null);
    try {
      const r = await listRecordings(200);
      setRecordings(r?.items || []);
    } catch (e) {
      logger.error('[PbxPage] recordings refresh failed', e);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleRecordingsScan() {
    setLoading(true);
    setError(null);
    try {
      await scanRecordings();
      await handleRecordingsRefresh();
    } catch (e) {
      logger.error('[PbxPage] recordings scan failed', e);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleCdrSearch() {
    setLoading(true);
    setError(null);
    try {
      const r = await listCdr({
        ...cdrFilters,
        from: (cdrFilters.from || '').trim() || null,
        to: (cdrFilters.to || '').trim() || null,
        src: (cdrFilters.src || '').trim() || null,
        dst: (cdrFilters.dst || '').trim() || null,
        uniqueid: (cdrFilters.uniqueid || '').trim() || null,
      });
      setCdrItems(r?.items || []);
    } catch (e) {
      logger.error('[PbxPage] cdr search failed', e);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  const tabs = [
    ['extensions', 'Ramais'],
    ['trunks', 'Troncos'],
    ['routes', 'Rotas'],
    ['dids', 'DIDs'],
    ['ivr', 'IVR'],
    ['queues', 'Filas'],
    ['queueMembers', 'Membros'],
    ['dialplan', 'Dialplan'],
    ['media', 'Mídia'],
    ['recordings', 'Gravações'],
    ['cdr', 'CDR'],
  ];

  return (
    <div style={{ padding: 16, maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0 }}>PBX v1 (Postgres + Asterisk Realtime)</h2>
          <p style={{ margin: '6px 0 0 0', opacity: 0.8 }}>
            CRUD no Postgres + materialização no Realtime. Use “Dialplan” para gerar/aplicar o dialplan realtime.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={refreshAll} disabled={loading} style={{ padding: '8px 12px' }}>
            {loading ? 'Atualizando…' : 'Atualizar tudo'}
          </button>
          <button onClick={handleDialplanApply} disabled={loading} style={{ padding: '8px 12px' }}>
            Aplicar dialplan
          </button>
          <button onClick={handleAsteriskReload} disabled={loading} style={{ padding: '8px 12px' }}>
            Reload Asterisk
          </button>
        </div>
      </div>

      {error ? (
        <div style={{ marginTop: 12, padding: 12, border: '1px solid rgba(255,0,0,0.35)', borderRadius: 8 }}>
          <strong>Erro:</strong> {error}
        </div>
      ) : null}

      <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {tabs.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            disabled={loading}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.12)',
              background: tab === k ? 'rgba(255,255,255,0.08)' : 'transparent',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 16, padding: 12, border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8 }}>
        {tab === 'extensions' ? (
          <>
            <h3 style={{ marginTop: 0 }}>Ramais</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr 1fr auto', gap: 8, marginBottom: 8 }}>
              <input placeholder="Ramal" value={formExt.extension} onChange={(e) => setFormExt((s) => ({ ...s, extension: e.target.value }))} />
              <input placeholder="Nome" value={formExt.displayName} onChange={(e) => setFormExt((s) => ({ ...s, displayName: e.target.value }))} />
              <input placeholder="Usuário" value={formExt.authUsername} onChange={(e) => setFormExt((s) => ({ ...s, authUsername: e.target.value }))} />
              <input placeholder="Senha" value={formExt.authPassword} onChange={(e) => setFormExt((s) => ({ ...s, authPassword: e.target.value }))} />
              <button onClick={handleSaveExtension} disabled={!canSaveExt || loading} style={{ padding: '8px 12px' }}>Salvar</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '180px 180px 240px 1fr', gap: 8, marginBottom: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={!!formExt.provisioningEnabled}
                  onChange={(e) => setFormExt((s) => ({ ...s, provisioningEnabled: e.target.checked }))}
                />
                Provisionamento (Grandstream/Avaya)
              </label>
              <select
                value={formExt.provisioningVendor}
                disabled={!formExt.provisioningEnabled}
                onChange={(e) => setFormExt((s) => ({ ...s, provisioningVendor: e.target.value }))}
              >
                <option value="grandstream">grandstream</option>
                <option value="avaya">avaya</option>
              </select>
              <input
                placeholder="MAC (12 hex, ex: 001122AABBCC)"
                value={formExt.provisioningMac}
                disabled={!formExt.provisioningEnabled}
                onChange={(e) => setFormExt((s) => ({ ...s, provisioningMac: e.target.value }))}
              />
              <input
                placeholder="Modelo (opcional)"
                value={formExt.provisioningModel}
                disabled={!formExt.provisioningEnabled}
                onChange={(e) => setFormExt((s) => ({ ...s, provisioningModel: e.target.value }))}
              />
            </div>
            <div style={{ marginBottom: 16, padding: 12, border: '1px dashed rgba(255,255,255,0.2)', borderRadius: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <strong>Token de Provisionamento</strong>
                <span style={{ opacity: 0.75 }}>{provisioningToken || '—'}</span>
                {provisioningTokenExpiresAt ? (
                  <span style={{ opacity: 0.75 }}>expira: {new Date(provisioningTokenExpiresAt).toLocaleString()}</span>
                ) : null}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <input
                  placeholder="expiresInSec (opcional)"
                  value={rotateExpiresInSec}
                  onChange={(e) => setRotateExpiresInSec(e.target.value)}
                  style={{ maxWidth: 220 }}
                />
                <button onClick={handleRotateProvisioningToken} disabled={loading} style={{ padding: '6px 10px' }}>
                  Rotacionar token
                </button>
                {rotatedToken ? (
                  <span style={{ opacity: 0.9 }}>Novo token: <code>{rotatedToken}</code></span>
                ) : null}
              </div>
              <div style={{ marginTop: 6, opacity: 0.7 }}>
                URL: <code>{buildApiUrl('/provision/<tenant>/<token>/<vendor>/<mac>')}</code>
              </div>
            </div>
            <div style={{ marginBottom: 16, padding: 12, border: '1px dashed rgba(255,255,255,0.2)', borderRadius: 8 }}>
              <strong>Provisionamento em Lote</strong>
              <p style={{ opacity: 0.75, marginTop: 4 }}>
                Envie um array JSON de ramais (máx. 500). Itens com erro retornam detalhes.
              </p>
              <textarea
                rows={8}
                value={bulkJson}
                onChange={(e) => setBulkJson(e.target.value)}
                style={{ width: '100%', marginTop: 8 }}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <button onClick={handleBulkProvisioning} disabled={loading} style={{ padding: '6px 10px' }}>
                  Enviar lote
                </button>
                {bulkResult ? (
                  <span style={{ opacity: 0.9 }}>
                    OK: {bulkResult.okCount || 0} | Erros: {bulkResult.errorCount || 0}
                  </span>
                ) : null}
              </div>
            </div>
            <div style={{ overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Ramal</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Nome</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Usuário</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Provisionamento</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {extensions.map((r) => (
                    <tr key={r.id}>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{r.extension}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{r.displayName || '—'}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{r.authUsername || '—'}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        {r?.endpointOptions?.provisioning?.enabled
                          ? `${r.endpointOptions.provisioning.vendor || '—'} / ${r.endpointOptions.provisioning.mac || '—'}`
                          : '—'}
                      </td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{r.status || '—'}</td>
                    </tr>
                  ))}
                  {!extensions.length ? (
                    <tr><td colSpan={5} style={{ padding: 8, opacity: 0.75 }}>Nenhum ramal encontrado.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

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
                  {trunks.map((t) => (
                    <tr key={t.id}>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{t.name}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{t.type}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{t.transport || '—'}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{t.status}</td>
                    </tr>
                  ))}
                  {!trunks.length ? <tr><td colSpan={4} style={{ padding: 8, opacity: 0.75 }}>Nenhum tronco encontrado.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {tab === 'routes' ? (
          <>
            <h3 style={{ marginTop: 0 }}>Rotas (produto)</h3>
            <p style={{ marginTop: 0, opacity: 0.8 }}>
              Dica: para outbound use match com <code>pattern</code> (ex: <code>{"{\"pattern\":\"_9X.\"}"}</code>) e actions com <code>hangup</code> / <code>trunk</code>.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '140px 220px 120px 120px 1fr auto', gap: 8, marginBottom: 12 }}>
              <select value={formRoute.direction} onChange={(e) => setFormRoute((s) => ({ ...s, direction: e.target.value }))}>
                <option value="inbound">inbound</option>
                <option value="outbound">outbound</option>
              </select>
              <input placeholder="Nome" value={formRoute.name} onChange={(e) => setFormRoute((s) => ({ ...s, name: e.target.value }))} />
              <input placeholder="Prioridade" type="number" value={formRoute.priority} onChange={(e) => setFormRoute((s) => ({ ...s, priority: e.target.value }))} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={!!formRoute.enabled} onChange={(e) => setFormRoute((s) => ({ ...s, enabled: e.target.checked }))} />
                enabled
              </label>
              <input placeholder='Match JSON (ex: {"pattern":"_X."})' value={formRoute.matchJson} onChange={(e) => setFormRoute((s) => ({ ...s, matchJson: e.target.value }))} />
              <button onClick={handleSaveRoute} disabled={!canSaveRoute || loading} style={{ padding: '8px 12px' }}>Salvar</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8, marginBottom: 12 }}>
              <input placeholder='Actions JSON (ex: [{"type":"hangup"}])' value={formRoute.actionsJson} onChange={(e) => setFormRoute((s) => ({ ...s, actionsJson: e.target.value }))} />
            </div>
            <div style={{ overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Direção</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Nome</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Prioridade</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Enabled</th>
                  </tr>
                </thead>
                <tbody>
                  {routes.map((r) => (
                    <tr key={r.id}>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{r.direction}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{r.name}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{r.priority}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{String(r.enabled)}</td>
                    </tr>
                  ))}
                  {!routes.length ? <tr><td colSpan={4} style={{ padding: 8, opacity: 0.75 }}>Nenhuma rota encontrada.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {tab === 'dids' ? (
          <>
            <h3 style={{ marginTop: 0 }}>DIDs (entrada)</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '220px 120px 1fr auto', gap: 8, marginBottom: 12 }}>
              <input placeholder="DID (ex: 551199999999)" value={formDid.did} onChange={(e) => setFormDid((s) => ({ ...s, did: e.target.value }))} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={!!formDid.enabled} onChange={(e) => setFormDid((s) => ({ ...s, enabled: e.target.checked }))} />
                enabled
              </label>
              <input placeholder="Actions JSON" value={formDid.actionsJson} onChange={(e) => setFormDid((s) => ({ ...s, actionsJson: e.target.value }))} />
              <button onClick={handleSaveDid} disabled={!canSaveDid || loading} style={{ padding: '8px 12px' }}>Salvar</button>
            </div>
            <div style={{ marginBottom: 12 }}>
              <input placeholder="Match JSON (opcional)" value={formDid.matchJson} onChange={(e) => setFormDid((s) => ({ ...s, matchJson: e.target.value }))} style={{ width: '100%' }} />
            </div>
            <div style={{ overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>DID</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Enabled</th>
                  </tr>
                </thead>
                <tbody>
                  {dids.map((d) => (
                    <tr key={d.id}>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{d.did}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{String(d.enabled)}</td>
                    </tr>
                  ))}
                  {!dids.length ? <tr><td colSpan={2} style={{ padding: 8, opacity: 0.75 }}>Nenhum DID encontrado.</td></tr> : null}
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
                enabled
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
                  {ivrRules.map((r) => (
                    <tr key={r.id}>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{r.name}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{String(r.enabled)}</td>
                    </tr>
                  ))}
                  {!ivrRules.length ? <tr><td colSpan={2} style={{ padding: 8, opacity: 0.75 }}>Nenhuma regra IVR encontrada.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {tab === 'queues' ? (
          <>
            <h3 style={{ marginTop: 0 }}>Filas</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr 180px 1fr auto', gap: 8, marginBottom: 12 }}>
              <input placeholder="Nome da fila" value={formQueue.name} onChange={(e) => setFormQueue((s) => ({ ...s, name: e.target.value }))} />
              <input placeholder="Nome exibido" value={formQueue.displayName} onChange={(e) => setFormQueue((s) => ({ ...s, displayName: e.target.value }))} />
              <input placeholder="Strategy" value={formQueue.strategy} onChange={(e) => setFormQueue((s) => ({ ...s, strategy: e.target.value }))} />
              <input placeholder='Options JSON (ex: {"timeout":15})' value={formQueue.optionsJson} onChange={(e) => setFormQueue((s) => ({ ...s, optionsJson: e.target.value }))} />
              <button onClick={handleSaveQueue} disabled={!canSaveQueue || loading} style={{ padding: '8px 12px' }}>Salvar</button>
            </div>
            <div style={{ overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Nome</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Display</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Strategy</th>
                  </tr>
                </thead>
                <tbody>
                  {queues.map((q) => (
                    <tr key={q.id}>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{q.name}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{q.displayName || '—'}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{q.strategy || '—'}</td>
                    </tr>
                  ))}
                  {!queues.length ? <tr><td colSpan={3} style={{ padding: 8, opacity: 0.75 }}>Nenhuma fila encontrada.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {tab === 'queueMembers' ? (
          <>
            <h3 style={{ marginTop: 0 }}>Membros de fila (realtime)</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 1fr 120px 120px auto', gap: 8, marginBottom: 12 }}>
              <select value={selectedQueueId} onChange={(e) => setSelectedQueueId(e.target.value)}>
                <option value="">Selecione uma fila…</option>
                {queues.map((q) => (
                  <option key={q.id} value={q.id}>{q.name}</option>
                ))}
              </select>
              <select value={formQm.memberType} onChange={(e) => setFormQm((s) => ({ ...s, memberType: e.target.value }))}>
                <option value="extension">extension</option>
                <option value="external">external</option>
              </select>
              <input placeholder="memberRef (ex: 1001 ou PJSIP/x)" value={formQm.memberRef} onChange={(e) => setFormQm((s) => ({ ...s, memberRef: e.target.value }))} />
              <input placeholder="penalty" value={formQm.penalty} onChange={(e) => setFormQm((s) => ({ ...s, penalty: e.target.value }))} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={!!formQm.paused} onChange={(e) => setFormQm((s) => ({ ...s, paused: e.target.checked }))} />
                paused
              </label>
              <button onClick={handleSaveQueueMember} disabled={!canSaveQm || loading} style={{ padding: '8px 12px' }}>Adicionar</button>
            </div>
            <div style={{ overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Tipo</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Ref</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Penalty</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Paused</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }} />
                  </tr>
                </thead>
                <tbody>
                  {queueMembers.map((m) => (
                    <tr key={m.id}>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{m.memberType}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{m.memberRef}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{m.penalty ?? '—'}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{String(!!m.paused)}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        <button onClick={() => handleDeleteQueueMember(m.id)} disabled={loading} style={{ padding: '6px 10px' }}>
                          Remover
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!queueMembers.length ? <tr><td colSpan={5} style={{ padding: 8, opacity: 0.75 }}>Nenhum membro encontrado.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {tab === 'dialplan' ? (
          <>
            <h3 style={{ marginTop: 0 }}>Dialplan (realtime)</h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <button onClick={handleDialplanPreview} disabled={loading} style={{ padding: '8px 12px' }}>Preview</button>
              <button onClick={handleDialplanApply} disabled={loading} style={{ padding: '8px 12px' }}>Aplicar</button>
            </div>
            <div style={{ opacity: 0.85, marginBottom: 8 }}>
              {Array.isArray(dialplanRows) ? `Linhas: ${dialplanRows.length}` : 'Clique em Preview para ver o dialplan.'}
            </div>
            {Array.isArray(dialplanRows) ? (
              <pre style={{ padding: 12, borderRadius: 8, background: 'rgba(255,255,255,0.04)', overflow: 'auto' }}>
                {dialplanRows.slice(0, 500).map((r, idx) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <div key={idx}>
                    [{r.context}] exten=&gt; {r.exten},{r.priority},{r.app}({r.appdata})
                  </div>
                ))}
                {dialplanRows.length > 500 ? <div>… (truncado)</div> : null}
              </pre>
            ) : null}
          </>
        ) : null}

        {tab === 'media' ? (
          <>
            <h3 style={{ marginTop: 0 }}>Mídia (áudios)</h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                kind:
                <input value={audioKind} onChange={(e) => setAudioKind(e.target.value)} style={{ width: 140 }} />
              </label>
              <button onClick={handleAudioRefresh} disabled={loading} style={{ padding: '8px 12px' }}>Atualizar</button>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
              <input type="file" accept="audio/*" onChange={(e) => setAudioFile(e.target.files?.[0] || null)} />
              <button onClick={handleAudioUpload} disabled={loading || !audioFile} style={{ padding: '8px 12px' }}>Upload</button>
            </div>
            <div style={{ overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Nome</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Download</th>
                  </tr>
                </thead>
                <tbody>
                  {audioAssets.map((a) => (
                    <tr key={a.id}>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{a.name}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        <a href={buildApiUrl(`/api/pbx/audio-assets/file?id=${encodeURIComponent(a.id)}`)}>baixar</a>
                      </td>
                    </tr>
                  ))}
                  {!audioAssets.length ? <tr><td colSpan={2} style={{ padding: 8, opacity: 0.75 }}>Nenhum áudio encontrado.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {tab === 'recordings' ? (
          <>
            <h3 style={{ marginTop: 0 }}>Gravações</h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <button onClick={handleRecordingsRefresh} disabled={loading} style={{ padding: '8px 12px' }}>Atualizar</button>
              <button onClick={handleRecordingsScan} disabled={loading} style={{ padding: '8px 12px' }}>Scan volume</button>
            </div>
            <div style={{ overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Uniqueid</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Download</th>
                  </tr>
                </thead>
                <tbody>
                  {recordings.map((r) => (
                    <tr key={r.id}>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{r.uniqueid || '—'}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        <a href={buildApiUrl(`/api/pbx/recordings/file?id=${encodeURIComponent(r.id)}`)}>baixar</a>
                      </td>
                    </tr>
                  ))}
                  {!recordings.length ? <tr><td colSpan={2} style={{ padding: 8, opacity: 0.75 }}>Nenhuma gravação encontrada.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {tab === 'cdr' ? (
          <>
            <h3 style={{ marginTop: 0 }}>CDR</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr 1fr 1fr 1fr auto', gap: 8, marginBottom: 12 }}>
              <input placeholder="limit" value={cdrFilters.limit} onChange={(e) => setCdrFilters((s) => ({ ...s, limit: e.target.value }))} />
              <input placeholder="from (ISO)" value={cdrFilters.from} onChange={(e) => setCdrFilters((s) => ({ ...s, from: e.target.value }))} />
              <input placeholder="to (ISO)" value={cdrFilters.to} onChange={(e) => setCdrFilters((s) => ({ ...s, to: e.target.value }))} />
              <input placeholder="src" value={cdrFilters.src} onChange={(e) => setCdrFilters((s) => ({ ...s, src: e.target.value }))} />
              <input placeholder="dst" value={cdrFilters.dst} onChange={(e) => setCdrFilters((s) => ({ ...s, dst: e.target.value }))} />
              <input placeholder="uniqueid" value={cdrFilters.uniqueid} onChange={(e) => setCdrFilters((s) => ({ ...s, uniqueid: e.target.value }))} />
              <button onClick={handleCdrSearch} disabled={loading} style={{ padding: '8px 12px' }}>Buscar</button>
            </div>
            <div style={{ overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Calldate</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Src</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Dst</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Disposition</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Duration</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Uniqueid</th>
                  </tr>
                </thead>
                <tbody>
                  {cdrItems.map((c) => (
                    <tr key={c.id}>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{c.calldate ? new Date(c.calldate).toISOString() : '—'}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{c.src || '—'}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{c.dst || '—'}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{c.disposition || '—'}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{c.duration ?? '—'}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{c.uniqueid}</td>
                    </tr>
                  ))}
                  {!cdrItems.length ? <tr><td colSpan={6} style={{ padding: 8, opacity: 0.75 }}>Nenhum CDR encontrado (ainda).</td></tr> : null}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

