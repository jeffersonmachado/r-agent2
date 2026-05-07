import React, { useCallback, useEffect, useMemo, useState } from 'react';
import './PbxPage.css';
import { useToast } from '../components/Toast';
import {
  dialplanApply,
  dialplanPreview,
  rollbackDialplan,
  listConfigVersions,
  listAudioAssets,
  listCallRules,
  listCdr,
  listDids,
  listExtensions,
  listAcls,
  listQueueMembers,
  listQueueMetrics,
  listQueues,
  listRecordings,
  getRecordingPolicy,
  listRoutes,
  listTrunks,
  saveRecordingPolicy,
  scanRecordings,
  upsertCallRule,
  upsertDid,
  upsertExtension,
  upsertAcl,
  bulkUpsertExtensions,
  upsertQueue,
  upsertQueueMember,
  upsertRoute,
  upsertTrunk,
  pbxReload,
  getProvisioningToken,
  rotateProvisioningToken,
  revokeProvisioningToken,
  listPbxAuditEvents,
  uploadAudioAsset,
  deleteAcl,
  deleteQueueMember,
} from '../api/pbx';
import {
  listPauseReasons,
  upsertPauseReason,
  listContactReasons,
  upsertContactReason,
  listCampaigns,
  upsertCampaign,
  listCampaignList,
  addCampaignListItems,
  listScheduledCallbacks,
  upsertScheduledCallback,
  listClick2CallRequests,
  createClick2CallRequest,
} from '../api/cc';
import {
  listLegacyXmlEntity,
  upsertLegacyXmlEntity,
  deleteLegacyXmlEntity,
} from '../api/pbxLegacy';
import { buildApiUrl } from '../api/client';
import logger from '../utils/logger';
import { PlatformGrid, usePlatformGridState } from '../modules/platform-grid';
import { Button } from '../styles/Button';
import { useRouter } from '../hooks/useRouter';
import { CrudPageBase } from '../modules/crud-base';
import { PbxDashboardShell } from './pbx/PbxDashboardShell';
import { PbxExtensionsAclsTabs } from './pbx/PbxExtensionsAclsTabs';
import { PbxOverviewLegacyTabs } from './pbx/PbxOverviewLegacyTabs';
import { PbxRoutingTabs } from './pbx/PbxRoutingTabs';
import { PbxOperationsTabs } from './pbx/PbxOperationsTabs';
import { PbxContactCenterGovernanceTabs } from './pbx/PbxContactCenterGovernanceTabs';
import { PbxCcReportsTabs } from './pbx/PbxCcReportsTabs';
import { PbxFaxTabs } from './pbx/PbxFaxTabs';
import { PbxInfraConfigTabs } from './pbx/PbxInfraConfigTabs';
import { PbxCdrAnalysisTabs } from './pbx/PbxCdrAnalysisTabs';
import { PbxRoutingDetailTabs } from './pbx/PbxRoutingDetailTabs';
import { PbxConfigDetailTabs } from './pbx/PbxConfigDetailTabs';
import {
  AGENTS_FIELD_CLASS,
  AGENTS_SELECT_CLASS,
  INITIAL_EXTENSION_FORM,
  LEGACY_CONTEXT_OPTIONS,
  LEGACY_DASHBOARD_ITEMS,
  LEGACY_MENU_TAB_MAP,
  LEGACY_PROTOCOL_OPTIONS,
  LEGACY_TIPO_OPTIONS,
  PBX_STATIC_TAB_ROUTES,
  PbxDashboardIcon,
  QUEUE_STRATEGY_OPTIONS,
  getDashboardIconName,
  getDashboardIconPalette,
  normalizeLegacyLabel,
} from './pbx/pbxPageShared';

function safeJsonParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function formatRemainingMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 'expirado';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function formatDateTime(value, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleString();
}

export function PbxPage() {
  const { currentPath, navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();
  const isBulkProvisioningScreen = currentPath === '/pbx/provisioning-lote' || currentPath.startsWith('/pbx/provisioning-lote?');
  const [tab, setTab] = useState('overview');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchText, setSearchText] = useState('');
  const [navSearchTerm, setNavSearchTerm] = useState('');
  const [navCategory, setNavCategory] = useState('');
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);

  const [extensions, setExtensions] = useState([]);
  const [acls, setAcls] = useState([]);
  const [trunks, setTrunks] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [queues, setQueues] = useState([]);
  const [queueMetrics, setQueueMetrics] = useState([]);
  const [dids, setDids] = useState([]);
  const [ivrRules, setIvrRules] = useState([]);

  const [queueMembers, setQueueMembers] = useState([]);
  const [selectedQueueId, setSelectedQueueId] = useState('');

  const [audioKind, setAudioKind] = useState('ivr');
  const [audioAssets, setAudioAssets] = useState([]);
  const [audioFile, setAudioFile] = useState(null);
  const [audioAssetsError, setAudioAssetsError] = useState(null);

  const [recordings, setRecordings] = useState([]);
  const [recordingsError, setRecordingsError] = useState(null);
  const [recordingPolicy, setRecordingPolicy] = useState({
    enabled: false,
    retentionDays: 30,
    maskPhoneNumbers: true,
    requireConsent: false,
  });
  const [recordingPolicyError, setRecordingPolicyError] = useState(null);

  const [cdrFilters, setCdrFilters] = useState({ limit: 200, from: '', to: '', src: '', dst: '', uniqueid: '' });
  const [cdrItems, setCdrItems] = useState([]);

  const [dialplanRows, setDialplanRows] = useState(null);
  const [configVersions, setConfigVersions] = useState([]);

  const [formExt, setFormExt] = useState({ ...INITIAL_EXTENSION_FORM });
  const [formAcl, setFormAcl] = useState({
    id: '',
    name: '',
    description: '',
    enabled: true,
    deny: '',
    permit: '',
  });
  const [provisioningToken, setProvisioningToken] = useState(null);
  const [provisioningTokenExpiresAt, setProvisioningTokenExpiresAt] = useState(null);
  const [provisioningTokenUpdatedAt, setProvisioningTokenUpdatedAt] = useState(null);
  const [rotateExpiresInSec, setRotateExpiresInSec] = useState('');
  const [rotatedToken, setRotatedToken] = useState(null);
  const [pbxAuditHours, setPbxAuditHours] = useState('72');
  const [pbxAuditItems, setPbxAuditItems] = useState([]);
  const [pbxAuditByAction, setPbxAuditByAction] = useState({});
  const [bulkRow, setBulkRow] = useState({
    extension: '',
    displayName: '',
    authUsername: '',
    authPassword: '',
    provisioningEnabled: false,
    provisioningVendor: 'grandstream',
    provisioningMac: '',
    provisioningModel: '',
  });
  const [bulkItems, setBulkItems] = useState([]);
  const [bulkResult, setBulkResult] = useState(null);
  const [showExtensionEditModal, setShowExtensionEditModal] = useState(false);
  const [isEditingExtension, setIsEditingExtension] = useState(false);
  const canSaveExt = useMemo(() => {
    const ext = String(formExt.extension || '').trim();
    const nome = String(formExt.displayName || '').trim();
    const usuario = String(formExt.authUsername || '').trim();
    const senha = String(formExt.authPassword || '').trim();
    const contexto = String(formExt.contexto || '').trim();
    const protocolo = String(formExt.protocolo || '').trim();
    const bloqueio = String(formExt.bloqueio || '').trim();
    const permissao = String(formExt.permissao || '').trim();
    const tipo = String(formExt.tipo || '').trim();
    const senhad = String(formExt.senhad || '').trim();
    const chamadas = Number.parseInt(String(formExt.chamadas || '').trim(), 10);
    const tempo = Number.parseInt(String(formExt.tempo || '').trim(), 10);

    if (!ext || !nome || !usuario || !senha || !contexto || !protocolo || !bloqueio || !permissao || !tipo) return false;
    if (tipo === 'Senha' && !senhad) return false;
    if (!Number.isFinite(chamadas) || chamadas < 1 || chamadas > 15) return false;
    if (!Number.isFinite(tempo) || tempo < 1) return false;
    if (!formExt.provisioningEnabled) return true;
    const pw = String(formExt.authPassword || '').trim();
    if (pw.length < 8) return false;
    const vendor = String(formExt.provisioningVendor || '').trim().toLowerCase();
    const vendorOk = vendor === 'grandstream' || vendor === 'avaya';
    const mac = String(formExt.provisioningMac || '').trim().replace(/[^a-fA-F0-9]/g, '').toUpperCase();
    return vendorOk && mac.length === 12;
  }, [
    formExt.extension,
    formExt.displayName,
    formExt.authUsername,
    formExt.authPassword,
    formExt.contexto,
    formExt.protocolo,
    formExt.bloqueio,
    formExt.permissao,
    formExt.tipo,
    formExt.senhad,
    formExt.chamadas,
    formExt.tempo,
    formExt.provisioningEnabled,
    formExt.provisioningVendor,
    formExt.provisioningMac,
  ]);
  const canSaveAcl = useMemo(() => (formAcl.name || '').trim().length > 0, [formAcl.name]);

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
    matchMode: 'prefix_any', // prefix_any | exact
    dialPrefix: '',
    exactExten: '',
    actionType: 'hangup', // hangup | trunk | extension | queue
    actionRef: '',
    stripPrefixLen: '',
    addPrefix: '',
  });
  const canSaveRoute = useMemo(() => {
    if (!(formRoute.name || '').trim()) return false;
    const mode = String(formRoute.matchMode || 'prefix_any');
    if (mode === 'exact' && !(formRoute.exactExten || '').trim()) return false;
    const t = String(formRoute.actionType || 'hangup');
    if (t !== 'hangup' && !(formRoute.actionRef || '').trim()) return false;
    return true;
  }, [formRoute.name, formRoute.matchMode, formRoute.exactExten, formRoute.actionType, formRoute.actionRef]);

  const [formQueue, setFormQueue] = useState({
    name: '',
    displayName: '',
    strategy: 'ringall',
    queueNumber: '',
    tocar: false,
    anunciar: false,
    inclui: '',
    exclui: '',
    parar: '',
    retornar: '',
    transferir: '',
    url: '',
    autoatendimento: false,
    timeout: '15',
    retry: '',
    wrapuptime: '',
    maxlen: '',
  });
  const canSaveQueue = useMemo(() => {
    const ramal = String(formQueue.queueNumber || '').trim();
    const nome = String(formQueue.displayName || '').trim();
    const estrategia = String(formQueue.strategy || '').trim();
    const inclui = String(formQueue.inclui || '').trim();
    const exclui = String(formQueue.exclui || '').trim();
    const parar = String(formQueue.parar || '').trim();
    const retornar = String(formQueue.retornar || '').trim();
    if (!ramal || !nome || !estrategia || !inclui || !exclui || !parar || !retornar) return false;
    return true;
  }, [
    formQueue.queueNumber,
    formQueue.displayName,
    formQueue.strategy,
    formQueue.inclui,
    formQueue.exclui,
    formQueue.parar,
    formQueue.retornar,
  ]);

  const [formDid, setFormDid] = useState({
    did: '',
    enabled: true,
    destinationType: 'extension', // extension | queue | ivr | hangup
    destinationRef: '',
  });
  const canSaveDid = useMemo(() => {
    if (!(formDid.did || '').trim()) return false;
    const t = String(formDid.destinationType || 'extension');
    if (t !== 'hangup' && !(formDid.destinationRef || '').trim()) return false;
    return true;
  }, [formDid.did, formDid.destinationType, formDid.destinationRef]);

  const [formIvr, setFormIvr] = useState({
    name: '',
    contextSuffix: '',
    dialplanText: `[ivr]\nexten => s,1,NoOp(IVR)\nexten => s,n,Hangup()`,
    enabled: true,
  });
  const canSaveIvr = useMemo(() => (formIvr.name || '').trim().length > 0, [formIvr.name]);

  const [formQm, setFormQm] = useState({ memberType: 'extension', memberRef: '', penalty: '', paused: false });
  const canSaveQm = useMemo(() => selectedQueueId && (formQm.memberRef || '').trim().length > 0, [selectedQueueId, formQm.memberRef]);

  // Contact Center (CC)
  const [ccPauseReasons, setCcPauseReasons] = useState([]);
  const [ccContactReasons, setCcContactReasons] = useState([]);
  const [ccCampaigns, setCcCampaigns] = useState([]);
  const [ccSelectedCampaignId, setCcSelectedCampaignId] = useState('');
  const [ccCampaignList, setCcCampaignList] = useState([]);
  const [ccScheduledCallbacks, setCcScheduledCallbacks] = useState([]);
  const [ccClick2CallItems, setCcClick2CallItems] = useState([]);

  const [formPauseReason, setFormPauseReason] = useState({ code: '', description: '', active: true });
  const canSavePauseReason = useMemo(
    () => (formPauseReason.code || '').trim().length > 0 && (formPauseReason.description || '').trim().length > 0,
    [formPauseReason.code, formPauseReason.description],
  );
  const [formContactReason, setFormContactReason] = useState({ code: '', description: '', active: true });
  const canSaveContactReason = useMemo(
    () => (formContactReason.code || '').trim().length > 0 && (formContactReason.description || '').trim().length > 0,
    [formContactReason.code, formContactReason.description],
  );
  const [formCampaign, setFormCampaign] = useState({
    id: '',
    name: '',
    status: 'draft',
    startAt: '',
    endAt: '',
    click2callEnabled: false,
    recordEnabled: false,
  });
  const canSaveCampaign = useMemo(() => (formCampaign.name || '').trim().length > 0, [formCampaign.name]);
  const [campaignListDraftRow, setCampaignListDraftRow] = useState({ ddd: '', phone: '', key: '' });
  const [campaignListDraftItems, setCampaignListDraftItems] = useState([]);

  const [formScheduled, setFormScheduled] = useState({
    id: '',
    scheduledAt: '',
    phone: '',
    ddd: '',
    description: '',
    status: 'pending',
  });
  const canSaveScheduled = useMemo(
    () => (formScheduled.scheduledAt || '').trim().length > 0 && (formScheduled.phone || '').trim().length > 0,
    [formScheduled.scheduledAt, formScheduled.phone],
  );
  const [formClick2Call, setFormClick2Call] = useState({
    campaignId: '',
    target: '',
    phone: '',
    ddd: '',
    channel: '',
    context: '',
    exten: '',
    priority: '1',
    timeoutMs: '30000',
  });
  const [click2CallVars, setClick2CallVars] = useState([{ key: 'TENANT', value: '' }]);
  const canCreateClick2Call = useMemo(
    () => (formClick2Call.target || '').trim().length > 0 && (formClick2Call.phone || '').trim().length > 0,
    [formClick2Call.target, formClick2Call.phone],
  );

  // PBX Legado (XML): CRUD genérico para cobrir as telas XML do legado
  const [legacyXmlEntity, setLegacyXmlEntity] = useState('ddr');
  const [legacyXmlSupported, setLegacyXmlSupported] = useState([]);
  const [legacyXmlMeta, setLegacyXmlMeta] = useState({ entity: null, file: null, rootTag: null, itemTag: null });
  const [legacyXmlItems, setLegacyXmlItems] = useState([]);
  const [legacyXmlDraftId, setLegacyXmlDraftId] = useState('');
  const [legacyXmlDraftFields, setLegacyXmlDraftFields] = useState([{ key: '', value: '' }]);
  const [legacyXmlError, setLegacyXmlError] = useState(null);

  const tokenGovernance = useMemo(() => {
    if (!provisioningToken) {
      return { level: 'neutral', message: 'Sem token ativo', remainingLabel: null };
    }
    if (!provisioningTokenExpiresAt) {
      return { level: 'warn', message: 'Token sem expiração', remainingLabel: null };
    }
    const expiresMs = new Date(provisioningTokenExpiresAt).getTime() - Date.now();
    if (!Number.isFinite(expiresMs) || expiresMs <= 0) {
      return { level: 'critical', message: 'Token expirado', remainingLabel: 'expirado' };
    }
    if (expiresMs <= 24 * 60 * 60 * 1000) {
      return { level: 'critical', message: 'Expira em menos de 24h', remainingLabel: formatRemainingMs(expiresMs) };
    }
    if (expiresMs <= 72 * 60 * 60 * 1000) {
      return { level: 'warn', message: 'Expira em menos de 72h', remainingLabel: formatRemainingMs(expiresMs) };
    }
    return { level: 'ok', message: 'Token saudável', remainingLabel: formatRemainingMs(expiresMs) };
  }, [provisioningToken, provisioningTokenExpiresAt]);

  async function refreshCore() {
    const [rExt, rAcls, rTrunks, rRoutes, rQueues, rQueueMetrics, rDids, rRules, rVersions] = await Promise.all([
      listExtensions(),
      listAcls(),
      listTrunks(),
      listRoutes(),
      listQueues(),
      listQueueMetrics(),
      listDids(),
      listCallRules('ivr_dialplan_text'),
      listConfigVersions(30),
    ]);
    setExtensions(rExt?.items || []);
    setAcls(rAcls?.items || []);
    setTrunks(rTrunks?.items || []);
    setRoutes(rRoutes?.items || []);
    setQueues(rQueues?.items || []);
    setQueueMetrics(rQueueMetrics?.items || []);
    setDids(rDids?.items || []);
    setIvrRules(rRules?.items || []);
    setConfigVersions(rVersions?.items || []);

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
    // Aux endpoints are optional in some environments (dev/local). Keep the page usable even if they fail.
    try {
      const rAudio = await listAudioAssets(audioKind);
      setAudioAssets(rAudio?.items || []);
      setAudioAssetsError(null);
    } catch (e) {
      logger.error('[PbxPage] listAudioAssets failed', e);
      setAudioAssets([]);
      setAudioAssetsError(e?.message || String(e));
    }

    try {
      const rRec = await listRecordings(200);
      setRecordings(rRec?.items || []);
      setRecordingsError(null);
    } catch (e) {
      logger.error('[PbxPage] listRecordings failed', e);
      setRecordings([]);
      setRecordingsError(e?.message || String(e));
    }

    try {
      const rPolicy = await getRecordingPolicy();
      setRecordingPolicyError(null);
      if (rPolicy?.ok && rPolicy?.policy) {
        setRecordingPolicy((prev) => ({ ...prev, ...rPolicy.policy }));
      }
    } catch (e) {
      logger.error('[PbxPage] getRecordingPolicy failed', e);
      setRecordingPolicyError(e?.message || String(e));
    }
  }

  async function refreshPbxAudit() {
    const hours = Number(pbxAuditHours || 72);
    const r = await listPbxAuditEvents({
      hours: Number.isFinite(hours) ? hours : 72,
      limit: 300,
    });
    setPbxAuditItems(r?.items || []);
    setPbxAuditByAction(r?.byAction || {});
  }

  async function refreshCC() {
    const [rPause, rContact, rCampaigns, rSched, rC2c] = await Promise.all([
      listPauseReasons(),
      listContactReasons(),
      listCampaigns(),
      listScheduledCallbacks(),
      listClick2CallRequests(200),
    ]);
    setCcPauseReasons(rPause?.items || []);
    setCcContactReasons(rContact?.items || []);
    setCcCampaigns(rCampaigns?.items || []);
    setCcScheduledCallbacks(rSched?.items || []);
    setCcClick2CallItems(rC2c?.items || []);

    const cItems = rCampaigns?.items || [];
    if (!ccSelectedCampaignId && cItems[0]?.id) setCcSelectedCampaignId(String(cItems[0].id));
  }

  async function refreshLegacyXml(entityOverride = null) {
    const e = String(entityOverride || legacyXmlEntity || '').trim();
    if (!e) return;
    try {
      const r = await listLegacyXmlEntity(e);
      setLegacyXmlError(null);
      setLegacyXmlSupported(r?.supported || []);
      setLegacyXmlMeta({
        entity: r?.entity || e,
        file: r?.file || null,
        rootTag: r?.rootTag || null,
        itemTag: r?.itemTag || null,
      });
      setLegacyXmlItems(r?.items || []);
    } catch (err) {
      const msg = err?.message || String(err);
      if (msg === 'pbx_xml_dir_not_configured') {
        setLegacyXmlError('PBX Legado (XML) não está configurado neste servidor. Defina PBX_LEGACY_ROOT ou PBX_LEGACY_XML_DIR no backend.');
        setLegacyXmlMeta({ entity: e, file: null, rootTag: null, itemTag: null });
        setLegacyXmlItems([]);
        return;
      }
      setLegacyXmlError(msg);
      setLegacyXmlMeta({ entity: e, file: null, rootTag: null, itemTag: null });
      setLegacyXmlItems([]);
    }
  }

  async function refreshAll() {
    setLoading(true);
    try {
      await refreshCore();
      await refreshAux();
      await refreshPbxAudit();
      await refreshCC();
      setLastUpdatedAt(new Date().toISOString());
    } catch (e) {
      logger.error('[PbxPage] refresh failed', e);
      showToast(e?.message || String(e), 'error');
    } finally {
      setLoading(false);
    }
  }

  const normalizedQuery = useMemo(() => String(searchText || '').trim().toLowerCase(), [searchText]);
  const matchesQuery = useMemo(() => {
    if (!normalizedQuery) return () => true;
    return (obj, fields) => {
      for (const f of fields) {
        const v = obj && obj[f] != null ? String(obj[f]) : '';
        if (v.toLowerCase().includes(normalizedQuery)) return true;
      }
      return false;
    };
  }, [normalizedQuery]);

  const filteredExtensions = useMemo(
    () => (extensions || []).filter((e) => matchesQuery(e, ['extension', 'displayName', 'authUsername'])),
    [extensions, matchesQuery],
  );
  const aclById = useMemo(() => {
    const out = {};
    for (const a of (acls || [])) {
      if (a && a.id) out[String(a.id)] = a;
    }
    return out;
  }, [acls]);
  const filteredAcls = useMemo(
    () => (acls || []).filter((a) => matchesQuery(a, ['id', 'name', 'description', 'deny', 'permit'])),
    [acls, matchesQuery],
  );
  const getExtensionAclLabel = (ext) => {
    const id = ext?.endpointOptions?.aclId;
    if (!id) return '—';
    const a = aclById[String(id)];
    return a?.name || `#${String(id)}`;
  };
  const filteredTrunks = useMemo(
    () => (trunks || []).filter((t) => matchesQuery(t, ['name', 'type', 'transport', 'aorContact'])),
    [trunks, matchesQuery],
  );
  const filteredRoutes = useMemo(() => {
    if (!normalizedQuery) return routes || [];
    return (routes || []).filter((r) => {
      const a0 = (r && Array.isArray(r.actions) ? r.actions[0] : null) || {};
      const s = [
        r?.direction,
        r?.name,
        r?.match?.exten,
        r?.match?.pattern,
        a0?.type,
        a0?.ref,
      ].filter(Boolean).join(' ').toLowerCase();
      return s.includes(normalizedQuery);
    });
  }, [routes, normalizedQuery]);
  const filteredQueues = useMemo(
    () => (queues || []).filter((q) => matchesQuery(q, ['name', 'displayName', 'strategy'])),
    [queues, matchesQuery],
  );
  const filteredQueueMembers = useMemo(
    () => (queueMembers || []).filter((m) => matchesQuery(m, ['memberType', 'memberRef', 'queueId'])),
    [queueMembers, matchesQuery],
  );
  const filteredDids = useMemo(() => {
    if (!normalizedQuery) return dids || [];
    return (dids || []).filter((d) => {
      const a0 = (d && Array.isArray(d.actions) ? d.actions[0] : null) || {};
      const s = [
        d?.did,
        a0?.type,
        a0?.ref,
      ].filter(Boolean).join(' ').toLowerCase();
      return s.includes(normalizedQuery);
    });
  }, [dids, normalizedQuery]);
  const filteredIvrRules = useMemo(
    () => (ivrRules || []).filter((r) => matchesQuery(r, ['id', 'name'])),
    [ivrRules, matchesQuery],
  );
  const filteredAudioAssets = useMemo(
    () => (audioAssets || []).filter((a) => matchesQuery(a, ['id', 'kind', 'filename', 'originalName'])),
    [audioAssets, matchesQuery],
  );
  const filteredRecordings = useMemo(
    () => (recordings || []).filter((r) => matchesQuery(r, ['id', 'src', 'dst', 'uniqueid', 'queue', 'extension'])),
    [recordings, matchesQuery],
  );
  const filteredCdrItems = useMemo(
    () => (cdrItems || []).filter((c) => matchesQuery(c, ['src', 'dst', 'disposition', 'uniqueid', 'linkedid'])),
    [cdrItems, matchesQuery],
  );
  const filteredAuditItems = useMemo(
    () => (pbxAuditItems || []).filter((i) => matchesQuery(i, ['action', 'actor', 'entityType', 'entityId'])),
    [pbxAuditItems, matchesQuery],
  );
  const filteredPauseReasons = useMemo(
    () => (ccPauseReasons || []).filter((r) => matchesQuery(r, ['code', 'description'])),
    [ccPauseReasons, matchesQuery],
  );
  const filteredContactReasons = useMemo(
    () => (ccContactReasons || []).filter((r) => matchesQuery(r, ['code', 'description'])),
    [ccContactReasons, matchesQuery],
  );
  const filteredCampaigns = useMemo(
    () => (ccCampaigns || []).filter((c) => matchesQuery(c, ['id', 'name', 'status'])),
    [ccCampaigns, matchesQuery],
  );
  const filteredCampaignList = useMemo(
    () => (ccCampaignList || []).filter((c) => matchesQuery(c, ['phone', 'key', 'status', 'ddd'])),
    [ccCampaignList, matchesQuery],
  );
  const filteredScheduled = useMemo(
    () => (ccScheduledCallbacks || []).filter((c) => matchesQuery(c, ['phone', 'status', 'description', 'ddd'])),
    [ccScheduledCallbacks, matchesQuery],
  );
  const filteredC2c = useMemo(
    () => (ccClick2CallItems || []).filter((c) => matchesQuery(c, ['target', 'phone', 'status', 'campaignId'])),
    [ccClick2CallItems, matchesQuery],
  );

  const legacyXmlQueryFields = useMemo(() => {
    const set = new Set(['id']);
    for (const it of (legacyXmlItems || [])) {
      if (!it || typeof it !== 'object') continue;
      for (const k of Object.keys(it)) {
        if (k === '_attrs') continue;
        set.add(k);
      }
    }
    return Array.from(set);
  }, [legacyXmlItems]);

  const filteredLegacyXmlItems = useMemo(
    () => (legacyXmlItems || []).filter((it) => matchesQuery(it, legacyXmlQueryFields)),
    [legacyXmlItems, matchesQuery, legacyXmlQueryFields],
  );

  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Legado XML deve ser carregado apenas quando o usuário estiver na aba,
    // porque nem todo ambiente tem PBX_LEGACY_ROOT/PBX_LEGACY_XML_DIR configurado.
    if (tab !== 'legacyXml') return;
    refreshLegacyXml().catch((e) => {
      logger.error('[PbxPage] refreshLegacyXml failed', e);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, legacyXmlEntity]);

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
      showToast(e?.message || String(e), 'error');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedQueueId]);

  async function refreshCampaignList(campaignId) {
    if (!campaignId) {
      setCcCampaignList([]);
      return;
    }
    const r = await listCampaignList(campaignId);
    setCcCampaignList(r?.items || []);
  }

  useEffect(() => {
    refreshCampaignList(ccSelectedCampaignId).catch((e) => {
      logger.error('[PbxPage] refreshCampaignList failed', e);
      showToast(e?.message || String(e), 'error');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ccSelectedCampaignId]);

  async function handleSaveExtension() {
    if (!canSaveExt) return;
    setLoading(true);
    try {
      const parseIntOrNull = (v) => {
        const s = String(v || '').trim();
        if (!s) return null;
        const n = Number.parseInt(s, 10);
        return Number.isFinite(n) ? n : null;
      };
      const grupo = String(formExt.grupo || '')
        .split(/[,\s;]+/)
        .map((x) => x.trim())
        .filter(Boolean);
      const chamadasInt = parseIntOrNull(formExt.chamadas);
      const tempoInt = parseIntOrNull(formExt.tempo);
      const tipo = String(formExt.tipo || '').trim() || 'Livre';
      if (tipo === 'Senha' && !(formExt.senhad || '').trim()) {
        throw new Error('senhad_required_when_tipo_senha');
      }
      if (!Number.isFinite(chamadasInt) || chamadasInt < 1 || chamadasInt > 15) {
        throw new Error('chamadas_invalid_range_1_15');
      }
      if (!Number.isFinite(tempoInt) || tempoInt < 1) {
        throw new Error('tempo_invalid_min_1');
      }
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
        calleridName: (formExt.calleridName || '').trim() || null,
        calleridNumber: (formExt.calleridNumber || '').trim() || null,
        endpointOptions: {
          aclId: (formExt.aclId || '').trim() || null,
          contexto: (formExt.contexto || '').trim() || 'ramal',
          grupo,
          gsm: !!formExt.gsm,
          g729: !!formExt.g729,
          correio: !!formExt.correio,
          webfone: !!formExt.webfone,
          gravar: !!formExt.gravar,
          protocolo: (formExt.protocolo || '').trim() || 'PJSIP',
          bloqueio: (formExt.bloqueio || '').trim() || null,
          permissao: (formExt.permissao || '').trim() || null,
          calleridExternal: (formExt.calleridExternal || '').trim() || null,
          tipo,
          senhad: (formExt.senhad || '').trim() || null,
          chamadas: chamadasInt,
          tempo: tempoInt,
        },
        provisioning,
      });
      setFormExt({ ...INITIAL_EXTENSION_FORM });
      await refreshCore();
      if (showExtensionEditModal) {
        setShowExtensionEditModal(false);
      }
      setIsEditingExtension(false);
    } catch (e) {
      logger.error('[PbxPage] save extension failed', e);
      showToast(e?.message || String(e), 'error');
    } finally {
      setLoading(false);
    }
  }

  function handleEditExtension(row) {
    const r = row || {};
    const opts = r?.endpointOptions || {};
    const prov = r?.endpointOptions?.provisioning || null;
    const grupoVal = Array.isArray(opts?.grupo)
      ? opts.grupo.join(', ')
      : (opts?.grupo ? String(opts.grupo) : '');
    setFormExt({
      extension: String(r.extension || ''),
      displayName: String(r.displayName || ''),
      authUsername: String(r.authUsername || ''),
      authPassword: '',
      calleridName: String(r.calleridName || ''),
      calleridNumber: String(r.calleridNumber || ''),
      calleridExternal: String(opts?.calleridExternal || ''),
      contexto: String(opts?.contexto || 'ramal'),
      grupo: String(grupoVal || ''),
      gsm: !!opts?.gsm,
      g729: !!opts?.g729,
      correio: !!opts?.correio,
      webfone: !!opts?.webfone,
      gravar: !!opts?.gravar,
      protocolo: String(opts?.protocolo || 'PJSIP'),
      bloqueio: String(opts?.bloqueio || '0.0.0.0/0'),
      permissao: String(opts?.permissao || '0.0.0.0/0'),
      tipo: String(opts?.tipo || 'Livre'),
      senhad: String(opts?.senhad || ''),
      chamadas: String(opts?.chamadas ?? '10'),
      tempo: String(opts?.tempo ?? '60'),
      aclId: String(r?.endpointOptions?.aclId || ''),
      provisioningEnabled: !!prov?.enabled,
      provisioningVendor: String(prov?.vendor || 'grandstream'),
      provisioningMac: String(prov?.mac || ''),
      provisioningModel: String(prov?.model || ''),
    });
    setIsEditingExtension(true);
    setShowExtensionEditModal(true);
  }

  function handleNewExtension() {
    setFormExt({ ...INITIAL_EXTENSION_FORM });
    setIsEditingExtension(false);
    setShowExtensionEditModal(true);
  }

  function handleEditAcl(row) {
    const r = row || {};
    setFormAcl({
      id: String(r.id || ''),
      name: String(r.name || ''),
      description: String(r.description || ''),
      enabled: r.enabled === false ? false : true,
      deny: String(r.deny || ''),
      permit: String(r.permit || ''),
    });
  }

  async function handleSaveAcl() {
    if (!canSaveAcl) return;
    setLoading(true);
    try {
      await upsertAcl({
        id: (formAcl.id || '').trim() || undefined,
        name: (formAcl.name || '').trim(),
        description: (formAcl.description || '').trim() || null,
        enabled: formAcl.enabled !== false,
        deny: (formAcl.deny || '').trim() || null,
        permit: (formAcl.permit || '').trim() || null,
      });
      setFormAcl({
        id: '',
        name: '',
        description: '',
        enabled: true,
        deny: '',
        permit: '',
      });
      await refreshCore();
    } catch (e) {
      logger.error('[PbxPage] save acl failed', e);
      showToast(e?.message || String(e), 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteAcl(id) {
    const aclId = (id || '').trim();
    if (!aclId) return;
    setLoading(true);
    try {
      await deleteAcl(aclId);
      if (String(formAcl.id || '') === String(aclId)) {
        setFormAcl({
          id: '',
          name: '',
          description: '',
          enabled: true,
          deny: '',
          permit: '',
        });
      }
      await refreshCore();
    } catch (e) {
      logger.error('[PbxPage] delete acl failed', e);
      showToast(e?.message || String(e), 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleRotateProvisioningToken() {
    setLoading(true);
    try {
      const exp = rotateExpiresInSec ? Number(rotateExpiresInSec) : null;
      const out = await rotateProvisioningToken(Number.isFinite(exp) ? exp : null);
      if (out?.ok && out?.token) {
        setRotatedToken(out.token);
        await Promise.all([refreshCore(), refreshPbxAudit()]);
      }
    } catch (e) {
      showToast(e?.message || String(e), 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleQuickRotate(expiresInSec) {
    setRotateExpiresInSec(String(expiresInSec));
    setLoading(true);
    try {
      const out = await rotateProvisioningToken(expiresInSec);
      if (out?.ok && out?.token) {
        setRotatedToken(out.token);
        await Promise.all([refreshCore(), refreshPbxAudit()]);
      }
    } catch (e) {
      showToast(e?.message || String(e), 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleRevokeProvisioningToken() {
    setLoading(true);
    try {
      await revokeProvisioningToken();
      setRotatedToken(null);
      setRotateExpiresInSec('');
      await Promise.all([refreshCore(), refreshPbxAudit()]);
    } catch (e) {
      showToast(e?.message || String(e), 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleBulkProvisioning() {
    setLoading(true);
    setError(null);
    setBulkResult(null);
    try {
      if (!Array.isArray(bulkItems) || bulkItems.length === 0) {
        setError('Nenhum item no lote. Adicione ao menos um ramal.');
        return;
      }
      const out = await bulkUpsertExtensions(bulkItems.map((it) => {
        const pEnabled = !!it.provisioningEnabled;
        const provisioning = pEnabled ? {
          enabled: true,
          vendor: (it.provisioningVendor || '').trim().toLowerCase() || 'grandstream',
          mac: (it.provisioningMac || '').trim(),
          model: (it.provisioningModel || '').trim() || null,
        } : null;
        return {
          extension: (it.extension || '').trim(),
          displayName: (it.displayName || '').trim() || null,
          authUsername: (it.authUsername || '').trim() || null,
          authPassword: (it.authPassword || '').trim() || null,
          provisioning,
        };
      }));
      setBulkResult(out);
      await refreshCore();
    } catch (e) {
      showToast(e?.message || String(e), 'error');
    } finally {
      setLoading(false);
    }
  }

  function handleBulkAddRow() {
    const ext = String(bulkRow.extension || '').trim();
    if (!ext) {
      setError('Informe o número do ramal antes de adicionar ao lote.');
      return;
    }
    setBulkItems((prev) => ([
      ...prev,
      {
        extension: ext,
        displayName: String(bulkRow.displayName || '').trim(),
        authUsername: String(bulkRow.authUsername || '').trim(),
        authPassword: String(bulkRow.authPassword || '').trim(),
        provisioningEnabled: !!bulkRow.provisioningEnabled,
        provisioningVendor: String(bulkRow.provisioningVendor || 'grandstream'),
        provisioningMac: String(bulkRow.provisioningMac || ''),
        provisioningModel: String(bulkRow.provisioningModel || ''),
      },
    ]));
    setBulkRow({
      extension: '',
      displayName: '',
      authUsername: '',
      authPassword: '',
      provisioningEnabled: false,
      provisioningVendor: 'grandstream',
      provisioningMac: '',
      provisioningModel: '',
    });
  }

  function handleBulkRemoveItem(idx) {
    setBulkItems((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSaveTrunk() {
    if (!canSaveTrunk) return;
    setLoading(true);
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
      showToast(e?.message || String(e), 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveRoute() {
    if (!canSaveRoute) return;
    setLoading(true);
    try {
      const mode = String(formRoute.matchMode || 'prefix_any');
      const dialPrefix = String(formRoute.dialPrefix || '').trim();
      const exactExten = String(formRoute.exactExten || '').trim();
      let match = {};
      if (mode === 'exact') {
        match = { exten: exactExten };
      } else {
        // prefix_any: use Asterisk pattern under the hood, but keep UI friendly.
        const cleanPrefix = dialPrefix.replace(/[^0-9]/g, '');
        match = { pattern: `_${cleanPrefix || ''}X.` };
      }

      const t = String(formRoute.actionType || 'hangup');
      const ref = String(formRoute.actionRef || '').trim();
      const actions = [];
      if (t === 'hangup') actions.push({ type: 'hangup' });
      if (t === 'extension') actions.push({ type: 'extension', ref });
      if (t === 'queue') actions.push({ type: 'queue', ref });
      if (t === 'trunk') {
        const stripPrefixLen = String(formRoute.stripPrefixLen || '').trim();
        const addPrefix = String(formRoute.addPrefix || '').trim();
        const a = { type: 'trunk', ref };
        if (stripPrefixLen !== '' && Number.isFinite(Number(stripPrefixLen))) a.stripPrefixLen = Number(stripPrefixLen);
        if (addPrefix) a.prefix = addPrefix;
        actions.push(a);
      }

      await upsertRoute({
        direction: formRoute.direction,
        name: (formRoute.name || '').trim(),
        enabled: !!formRoute.enabled,
        priority: Number(formRoute.priority || 100),
        match,
        actions,
      });
      setFormRoute({
        direction: 'outbound',
        name: '',
        priority: 100,
        enabled: true,
        matchMode: 'prefix_any',
        dialPrefix: '',
        exactExten: '',
        actionType: 'hangup',
        actionRef: '',
        stripPrefixLen: '',
        addPrefix: '',
      });
      await refreshCore();
    } catch (e) {
      logger.error('[PbxPage] save route failed', e);
      showToast(e?.message || String(e), 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveQueue() {
    if (!canSaveQueue) return;
    setLoading(true);
    try {
      const toNum = (v) => {
        const s = String(v || '').trim();
        if (!s) return undefined;
        const n = Number(s);
        return Number.isFinite(n) ? n : undefined;
      };
      const options = {};
      const timeout = toNum(formQueue.timeout);
      const retry = toNum(formQueue.retry);
      const wrapuptime = toNum(formQueue.wrapuptime);
      const maxlen = toNum(formQueue.maxlen);
      const queueNumber = String(formQueue.queueNumber || '').trim();
      const queueName = queueNumber || String(formQueue.name || '').trim();
      if (!queueName) throw new Error('queue_number_required');
      if (!(formQueue.displayName || '').trim()) throw new Error('queue_name_required');
      if (!(formQueue.strategy || '').trim()) throw new Error('queue_strategy_required');
      if (!(formQueue.inclui || '').trim()) throw new Error('queue_inclui_required');
      if (!(formQueue.exclui || '').trim()) throw new Error('queue_exclui_required');
      if (!(formQueue.parar || '').trim()) throw new Error('queue_parar_required');
      if (!(formQueue.retornar || '').trim()) throw new Error('queue_retornar_required');
      if (timeout != null) options.timeout = timeout;
      if (retry != null) options.retry = retry;
      if (wrapuptime != null) options.wrapuptime = wrapuptime;
      if (maxlen != null) options.maxlen = maxlen;
      options.queueNumber = queueNumber || null;
      options.tocar = !!formQueue.tocar;
      options.anunciar = !!formQueue.anunciar;
      options.inclui = (formQueue.inclui || '').trim() || null;
      options.exclui = (formQueue.exclui || '').trim() || null;
      options.parar = (formQueue.parar || '').trim() || null;
      options.retornar = (formQueue.retornar || '').trim() || null;
      options.transferir = (formQueue.transferir || '').trim() || null;
      options.url = (formQueue.url || '').trim() || null;
      options.autoatendimento = !!formQueue.autoatendimento;

      await upsertQueue({
        name: queueName,
        displayName: (formQueue.displayName || '').trim() || null,
        strategy: (formQueue.strategy || '').trim() || null,
        options,
      });
      setFormQueue({
        name: '',
        displayName: '',
        strategy: 'ringall',
        queueNumber: '',
        tocar: false,
        anunciar: false,
        inclui: '',
        exclui: '',
        parar: '',
        retornar: '',
        transferir: '',
        url: '',
        autoatendimento: false,
        timeout: '15',
        retry: '',
        wrapuptime: '',
        maxlen: '',
      });
      await refreshCore();
    } catch (e) {
      logger.error('[PbxPage] save queue failed', e);
      showToast(e?.message || String(e), 'error');
    } finally {
      setLoading(false);
    }
  }

  function handleEditQueue(row) {
    const r = row || {};
    const o = r?.options || {};
    setFormQueue({
      name: String(r.name || ''),
      displayName: String(r.displayName || ''),
      strategy: String(r.strategy || 'ringall'),
      queueNumber: String(o.queueNumber || ''),
      tocar: !!o.tocar,
      anunciar: !!o.anunciar,
      inclui: String(o.inclui || ''),
      exclui: String(o.exclui || ''),
      parar: String(o.parar || ''),
      retornar: String(o.retornar || ''),
      transferir: String(o.transferir || ''),
      url: String(o.url || ''),
      autoatendimento: !!o.autoatendimento,
      timeout: String(o.timeout ?? '15'),
      retry: String(o.retry ?? ''),
      wrapuptime: String(o.wrapuptime ?? ''),
      maxlen: String(o.maxlen ?? ''),
    });
  }

  async function handleSaveDid() {
    if (!canSaveDid) return;
    setLoading(true);
    try {
      const t = String(formDid.destinationType || 'extension');
      const ref = String(formDid.destinationRef || '').trim();
      const actions = [];
      if (t === 'hangup') actions.push({ type: 'hangup' });
      if (t === 'extension') actions.push({ type: 'extension', ref });
      if (t === 'queue') actions.push({ type: 'queue', ref });
      if (t === 'ivr') actions.push({ type: 'ivr', ref });

      await upsertDid({
        did: (formDid.did || '').trim(),
        enabled: !!formDid.enabled,
        match: {},
        actions,
      });
      setFormDid({ did: '', enabled: true, destinationType: 'extension', destinationRef: '' });
      await refreshCore();
    } catch (e) {
      logger.error('[PbxPage] save did failed', e);
      showToast(e?.message || String(e), 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveIvr() {
    if (!canSaveIvr) return;
    setLoading(true);
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
      showToast(e?.message || String(e), 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveQueueMember() {
    if (!canSaveQm) return;
    setLoading(true);
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
      showToast(e?.message || String(e), 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteQueueMember(id) {
    setLoading(true);
    try {
      await deleteQueueMember(id);
      await refreshQueueMembers(selectedQueueId);
    } catch (e) {
      logger.error('[PbxPage] delete queue member failed', e);
      showToast(e?.message || String(e), 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleLegacyXmlUpsert() {
	    setLoading(true);
	    setError(null);
	    try {
	      const id = String(legacyXmlDraftId || '').trim();
	      if (!id) {
	        setError('Informe o ID do item.');
	        return;
	      }
	      const payload = { id };
	      for (const row of (Array.isArray(legacyXmlDraftFields) ? legacyXmlDraftFields : [])) {
	        const k = String(row?.key || '').trim();
	        if (!k || k === 'id') continue;
	        payload[k] = String(row?.value ?? '');
	      }
	      await upsertLegacyXmlEntity(legacyXmlEntity, payload);
	      await refreshLegacyXml();
	    } catch (e) {
	      logger.error('[PbxPage] legacy xml upsert failed', e);
	      showToast(e?.message || String(e), 'error');
    } finally {
      setLoading(false);
    }
  }

  function handleLegacyXmlEdit(it) {
    const obj = it && typeof it === 'object' ? it : {};
    setLegacyXmlDraftId(String(obj.id || ''));
    const fields = Object.keys(obj)
      .filter((k) => k !== 'id' && k !== '_attrs')
      .slice(0, 60)
      .map((k) => ({ key: k, value: obj[k] == null ? '' : String(obj[k]) }));
    setLegacyXmlDraftFields(fields.length ? fields : [{ key: '', value: '' }]);
  }

  function handleLegacyXmlAddField() {
    setLegacyXmlDraftFields((prev) => ([...(Array.isArray(prev) ? prev : []), { key: '', value: '' }]));
  }

  function handleLegacyXmlRemoveField(idx) {
    setLegacyXmlDraftFields((prev) => (Array.isArray(prev) ? prev.filter((_, i) => i !== idx) : []));
  }

  async function handleLegacyXmlDelete(id) {
    if (!id) return;
    setLoading(true);
    try {
      await deleteLegacyXmlEntity(legacyXmlEntity, id);
      await refreshLegacyXml();
    } catch (e) {
      logger.error('[PbxPage] legacy xml delete failed', e);
      showToast(e?.message || String(e), 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleDialplanPreview() {
    setLoading(true);
    try {
      const r = await dialplanPreview();
      setDialplanRows(r?.rows || []);
    } catch (e) {
      logger.error('[PbxPage] dialplan preview failed', e);
      showToast(e?.message || String(e), 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleDialplanApply() {
    setLoading(true);
    try {
      await dialplanApply();
      await Promise.all([handleDialplanPreview(), refreshCore()]);
    } catch (e) {
      logger.error('[PbxPage] dialplan apply failed', e);
      showToast(e?.message || String(e), 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleRollbackVersion(version) {
    if (!version) return;
    setLoading(true);
    try {
      await rollbackDialplan(version);
      await Promise.all([handleDialplanPreview(), refreshCore()]);
    } catch (e) {
      logger.error('[PbxPage] dialplan rollback failed', e);
      showToast(e?.message || String(e), 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleAsteriskReload() {
    setLoading(true);
    try {
      await pbxReload();
    } catch (e) {
      logger.error('[PbxPage] asterisk reload failed', e);
      showToast(e?.message || String(e), 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleAudioRefresh() {
    setLoading(true);
    try {
      const r = await listAudioAssets(audioKind);
      setAudioAssets(r?.items || []);
    } catch (e) {
      logger.error('[PbxPage] audio refresh failed', e);
      showToast(e?.message || String(e), 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleAudioUpload() {
    setLoading(true);
    try {
      await uploadAudioAsset({ kind: audioKind, file: audioFile });
      setAudioFile(null);
      await handleAudioRefresh();
    } catch (e) {
      logger.error('[PbxPage] audio upload failed', e);
      showToast(e?.message || String(e), 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleRecordingsRefresh() {
    setLoading(true);
    try {
      const r = await listRecordings(200);
      setRecordings(r?.items || []);
    } catch (e) {
      logger.error('[PbxPage] recordings refresh failed', e);
      showToast(e?.message || String(e), 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleRecordingsScan() {
    setLoading(true);
    try {
      await scanRecordings();
      await handleRecordingsRefresh();
    } catch (e) {
      logger.error('[PbxPage] recordings scan failed', e);
      showToast(e?.message || String(e), 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveRecordingPolicy() {
    setLoading(true);
    try {
      const payload = {
        enabled: !!recordingPolicy.enabled,
        retentionDays: Number(recordingPolicy.retentionDays || 30),
        maskPhoneNumbers: !!recordingPolicy.maskPhoneNumbers,
        requireConsent: !!recordingPolicy.requireConsent,
      };
      const out = await saveRecordingPolicy(payload);
      if (out?.ok && out?.policy) {
        setRecordingPolicy((prev) => ({ ...prev, ...out.policy }));
      }
      await handleRecordingsRefresh();
    } catch (e) {
      logger.error('[PbxPage] save recording policy failed', e);
      showToast(e?.message || String(e), 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleCdrSearch() {
    setLoading(true);
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
      showToast(e?.message || String(e), 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleSavePauseReason() {
    if (!canSavePauseReason) return;
    setLoading(true);
    try {
      await upsertPauseReason({
        code: (formPauseReason.code || '').trim(),
        description: (formPauseReason.description || '').trim(),
        active: !!formPauseReason.active,
      });
      setFormPauseReason({ code: '', description: '', active: true });
      await refreshCC();
    } catch (e) {
      logger.error('[PbxPage] save pause reason failed', e);
      showToast(e?.message || String(e), 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveContactReason() {
    if (!canSaveContactReason) return;
    setLoading(true);
    try {
      await upsertContactReason({
        code: (formContactReason.code || '').trim(),
        description: (formContactReason.description || '').trim(),
        active: !!formContactReason.active,
      });
      setFormContactReason({ code: '', description: '', active: true });
      await refreshCC();
    } catch (e) {
      logger.error('[PbxPage] save contact reason failed', e);
      showToast(e?.message || String(e), 'error');
    } finally {
      setLoading(false);
    }
  }

	  async function handleSaveCampaign() {
	    if (!canSaveCampaign) return;
	    setLoading(true);
	    setError(null);
	    try {
	      await upsertCampaign({
	        id: (formCampaign.id || '').trim() || undefined,
	        name: (formCampaign.name || '').trim(),
	        status: (formCampaign.status || 'draft').trim(),
	        startAt: (formCampaign.startAt || '').trim() ? new Date(formCampaign.startAt).toISOString() : null,
	        endAt: (formCampaign.endAt || '').trim() ? new Date(formCampaign.endAt).toISOString() : null,
	        click2callEnabled: !!formCampaign.click2callEnabled,
	        recordEnabled: !!formCampaign.recordEnabled,
	        settings: {},
	      });
	      setFormCampaign({
	        id: '',
	        name: '',
	        status: 'draft',
	        startAt: '',
	        endAt: '',
	        click2callEnabled: false,
	        recordEnabled: false,
	      });
	      await refreshCC();
	    } catch (e) {
	      logger.error('[PbxPage] save campaign failed', e);
	      showToast(e?.message || String(e), 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleAddCampaignListItems() {
	    if (!ccSelectedCampaignId) return;
	    setLoading(true);
	    setError(null);
	    try {
	      const items = Array.isArray(campaignListDraftItems) ? campaignListDraftItems : [];
	      if (items.length === 0) {
	        setError('Nenhum item para adicionar. Inclua pelo menos um telefone na lista.');
	        return;
	      }
	      await addCampaignListItems({ campaignId: ccSelectedCampaignId, items });
	      setCampaignListDraftItems([]);
	      await refreshCampaignList(ccSelectedCampaignId);
	    } catch (e) {
	      logger.error('[PbxPage] add campaign list items failed', e);
	      showToast(e?.message || String(e), 'error');
    } finally {
      setLoading(false);
    }
  }

  function handleCampaignListDraftAdd() {
    if (!ccSelectedCampaignId) {
      setError('Selecione uma campanha.');
      return;
    }
    const ddd = String(campaignListDraftRow.ddd || '').trim();
    const phone = String(campaignListDraftRow.phone || '').trim();
    const key = String(campaignListDraftRow.key || '').trim();
    if (!phone) {
      setError('Informe o telefone.');
      return;
    }
    setCampaignListDraftItems((prev) => ([...prev, { ddd: ddd || null, phone, key: key || null }]));
    setCampaignListDraftRow({ ddd: '', phone: '', key: '' });
  }

  function handleCampaignListDraftRemove(idx) {
    setCampaignListDraftItems((prev) => prev.filter((_, i) => i !== idx));
  }

	  async function handleSaveScheduledCallback() {
	    if (!canSaveScheduled) return;
	    setLoading(true);
	    setError(null);
	    try {
	      await upsertScheduledCallback({
	        id: (formScheduled.id || '').trim() || undefined,
	        scheduledAt: new Date(formScheduled.scheduledAt).toISOString(),
	        phone: (formScheduled.phone || '').trim(),
	        ddd: (formScheduled.ddd || '').trim() || null,
	        description: (formScheduled.description || '').trim() || null,
	        status: (formScheduled.status || 'pending').trim(),
	        settings: {},
	      });
	      setFormScheduled({
	        id: '',
	        scheduledAt: '',
	        phone: '',
	        ddd: '',
	        description: '',
	        status: 'pending',
	      });
	      await refreshCC();
	    } catch (e) {
	      logger.error('[PbxPage] save scheduled callback failed', e);
	      showToast(e?.message || String(e), 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateClick2Call() {
	    if (!canCreateClick2Call) return;
	    setLoading(true);
	    setError(null);
	    try {
	      const vars = {};
	      for (const row of (Array.isArray(click2CallVars) ? click2CallVars : [])) {
	        const k = String(row?.key || '').trim();
	        if (!k) continue;
	        vars[k] = String(row?.value || '');
	      }
	      const originate = {
	        channel: String(formClick2Call.channel || '').trim() || undefined,
	        context: String(formClick2Call.context || '').trim() || undefined,
	        exten: String(formClick2Call.exten || '').trim() || undefined,
	        priority: Number(formClick2Call.priority || 1),
	        timeoutMs: Number(formClick2Call.timeoutMs || 30000),
	        variables: vars,
	      };
	      await createClick2CallRequest({
	        campaignId: (formClick2Call.campaignId || '').trim() || null,
	        target: (formClick2Call.target || '').trim(),
	        phone: (formClick2Call.phone || '').trim(),
	        ddd: (formClick2Call.ddd || '').trim() || null,
	        originate,
	      });
	      setFormClick2Call({
	        campaignId: '',
	        target: '',
	        phone: '',
	        ddd: '',
	        channel: '',
	        context: '',
	        exten: '',
	        priority: '1',
	        timeoutMs: '30000',
	      });
	      setClick2CallVars([{ key: 'TENANT', value: '' }]);
	      await refreshCC();
	    } catch (e) {
	      logger.error('[PbxPage] create click2call failed', e);
	      showToast(e?.message || String(e), 'error');
    } finally {
      setLoading(false);
    }
  }

  function handleClick2CallVarAdd() {
    setClick2CallVars((prev) => ([...(Array.isArray(prev) ? prev : []), { key: '', value: '' }]));
  }

  function handleClick2CallVarRemove(idx) {
    setClick2CallVars((prev) => (Array.isArray(prev) ? prev.filter((_, i) => i !== idx) : []));
  }

  const legacyReferenceSections = useMemo(() => {
    const grouped = {};
    for (const item of LEGACY_DASHBOARD_ITEMS) {
      const section = item.section || 'Referência';
      if (!grouped[section]) grouped[section] = [];
      grouped[section].push({
        key: item.key,
        label: normalizeLegacyLabel(item.label),
        hint: item.href,
      });
    }
    return Object.entries(grouped).map(([section, items]) => ({
      title: `Referência: ${section}`,
      items,
    }));
  }, []);

  const dashboardSections = [
    {
      title: 'PBX: Operação',
      items: [
        { key: 'overview', label: 'Visão geral', hint: 'Resumo operacional' },
        { key: 'extensions', label: 'Ramais', hint: 'Cadastro de endpoints', count: extensions.length },
        { key: 'trunks', label: 'Troncos', hint: 'Operadoras e peers', count: trunks.length },
        { key: 'routes', label: 'Rotas', hint: 'Regras de roteamento', count: routes.length },
        { key: 'dids', label: 'DIDs', hint: 'Números de entrada', count: dids.length },
        { key: 'ivr', label: 'IVR', hint: 'URA e fluxo de voz', count: ivrRules.length },
        { key: 'queues', label: 'Filas', hint: 'Filas ACD', count: queues.length },
        { key: 'queueMembers', label: 'Membros', hint: 'Agentes por fila', count: queueMembers.length },
      ],
    },
    {
      title: 'PBX: Plataforma',
      items: [
        { key: 'acls', label: 'ACLs', hint: 'Permissões de rede', count: acls.length },
        { key: 'dialplan', label: 'Dialplan', hint: 'Preview e aplicação' },
        { key: 'media', label: 'Mídia', hint: 'Áudios da plataforma', count: audioAssets.length },
        { key: 'recordings', label: 'Gravações', hint: 'Arquivos e política', count: recordings.length },
        { key: 'cdr', label: 'CDR', hint: 'Histórico de chamadas', count: cdrItems.length },
        { key: 'governance', label: 'Governança', hint: 'Auditoria e controle', count: pbxAuditItems.length },
      ],
    },
    {
      title: 'Contact Center',
      items: [
        { key: 'ccPauseReasons', label: 'Motivo pausa', hint: 'Classificação de pausa', count: ccPauseReasons.length },
        { key: 'ccContactReasons', label: 'Motivo contato', hint: 'Classificação de contato', count: ccContactReasons.length },
        { key: 'ccCampaigns', label: 'Campanhas', hint: 'Campanhas ativas', count: ccCampaigns.length },
        { key: 'ccCampaignList', label: 'Lista campanha', hint: 'Base de discagem', count: ccCampaignList.length },
        { key: 'ccScheduled', label: 'Callbacks', hint: 'Retornos agendados', count: ccScheduledCallbacks.length },
        { key: 'ccClick2Call', label: 'Click2Call', hint: 'Disparos manuais', count: ccClick2CallItems.length },
      ],
    },
    {
      title: 'Relatórios CDR',
      items: [
        { key: 'ccRelAtendidas', label: 'Rel. Atendidas', hint: 'Chamadas atendidas por fila', count: null },
        { key: 'ccRelAbandonadas', label: 'Rel. Abandonadas', hint: 'Taxa de abandono por fila', count: null },
        { key: 'ccRelAgentes', label: 'Rel. Agentes', hint: 'Desempenho por agente', count: null },
        { key: 'ccRelHora', label: 'Rel. Por Hora', hint: 'Volume por hora do dia', count: null },
        { key: 'ccRelResumoCampanha', label: 'Resumo Campanha', hint: 'Totais por campanha', count: null },
        { key: 'ccRelPesquisa', label: 'Pesquisa SAC', hint: 'Avaliações pós-atendimento', count: null },
        { key: 'cdrResumo', label: 'CDR Resumo', hint: 'Totais por par Origem→Destino', count: null },
        { key: 'cdrHora', label: 'CDR Por Hora', hint: 'Distribuição por hora do dia', count: null },
        { key: 'cdrOrigem', label: 'CDR Por Origem', hint: 'Ranking por número de origem', count: null },
        { key: 'cdrDestino', label: 'CDR Por Destino', hint: 'Ranking por número de destino', count: null },
      ],
    },
    {
      title: 'Manutenção: Detalhe',
      items: [
        { key: 'routesDdr', label: 'DDR', hint: 'Discagem Direta a Ramal (inbound)', count: null },
        { key: 'routesDesvio', label: 'Desvio', hint: 'Regras de desvio de chamada', count: null },
        { key: 'routesTransbordo', label: 'Transbordo', hint: 'Overflow de fila e ramal', count: null },
        { key: 'routesRetorno', label: 'Retorno', hint: 'Callback e retorno automático', count: null },
        { key: 'routesRecusa', label: 'Recusa', hint: 'Rejeição de chamadas', count: null },
        { key: 'routesFeriado', label: 'Feriado', hint: 'Roteamento por feriado/horário', count: null },
        { key: 'routesTransferencia', label: 'Transferência', hint: 'Regras de transferência', count: null },
        { key: 'extensionsGrupos', label: 'Grupos', hint: 'Ring groups e grupos de ramal', count: null },
        { key: 'extensionsBloqueio', label: 'Bloqueio', hint: 'Ramais com bloqueio de discagem', count: null },
      ],
    },
    {
      title: 'Configurações: Detalhe',
      items: [
        { key: 'trunksOperadoras', label: 'Operadoras', hint: 'Troncos de operadoras SIP/IAX', count: null },
        { key: 'trunksInterconexao', label: 'Interconexão', hint: 'Troncos PBX-to-PBX', count: null },
        { key: 'extensionsCategoria', label: 'Categoria', hint: 'Ramais por perfil de discagem', count: null },
        { key: 'extensionsFacilidades', label: 'Facilidades', hint: 'Feature codes e códigos especiais', count: null },
        { key: 'queuesSala', label: 'Sala/Conf.', hint: 'Salas de conferência ConfBridge', count: null },
        { key: 'govConfiguracoes', label: 'Configurações', hint: 'Parâmetros gerais do PBX', count: null },
        { key: 'govLicenca', label: 'Licença', hint: 'Versão e licenciamento', count: null },
        { key: 'govAtualizacao', label: 'Atualização', hint: 'Procedimento de update', count: null },
        { key: 'govAssistencia', label: 'Assistência', hint: 'Diagnóstico e suporte', count: null },
        { key: 'govRecarga', label: 'Recarga', hint: 'Créditos e billing por ramal', count: null },
        { key: 'govServicos', label: 'Serviços', hint: 'Módulos e serviços ativos', count: null },
      ],
    },
    {
      title: 'Fax',
      items: [
        { key: 'faxReport', label: 'Relatório Fax', hint: 'Chamadas de fax no CDR', count: null },
        { key: 'faxConfig', label: 'Configuração Fax', hint: 'Parâmetros de hardware fax', count: null },
      ],
    },
    {
      title: 'Sistema',
      items: [
        { key: 'usuarios', label: 'Usuários', hint: 'Gerenciamento de usuários', count: null },
        { key: 'networkConfig', label: 'Rede', hint: 'Interfaces e roteamento', count: null },
        { key: 'dhcpConfig', label: 'DHCP', hint: 'Distribuição de endereços IP', count: null },
        { key: 'firewallConfig', label: 'Firewall', hint: 'Regras de acesso e portas', count: null },
        { key: 'vpnConfig', label: 'VPN', hint: 'Túneis IPsec/OpenVPN/WireGuard', count: null },
      ],
    },
    {
      title: 'Referência: XML',
      items: [
        { key: 'legacyXml', label: 'XML', hint: 'Entidades XML de referência', count: legacyXmlItems.length },
      ],
    },
    ...legacyReferenceSections,
  ];
  const tabRouteMap = useMemo(() => {
    const routeMap = { ...PBX_STATIC_TAB_ROUTES };
    for (const item of LEGACY_DASHBOARD_ITEMS) {
      routeMap[item.key] = `/pbx/referencia/${encodeURIComponent(item.key)}`;
    }
    return routeMap;
  }, []);
  const routeTabMap = useMemo(() => Object.fromEntries(Object.entries(tabRouteMap).map(([k, v]) => [v, k])), [tabRouteMap]);
  const openPbxSection = (sectionKey) => {
    setTab(sectionKey);
    const path = tabRouteMap[sectionKey];
    navigate(path || '/pbx');
  };
  const filteredDashboardSections = useMemo(() => {
    const query = String(navSearchTerm || '').trim().toLowerCase();
    return dashboardSections
      .map((section) => ({
        ...section,
        items: (section.items || []).filter((item) => {
          const matchCategory = !navCategory || section.title === navCategory;
          if (!matchCategory) return false;
          if (!query) return true;
          const label = String(item?.label || '').toLowerCase();
          const hint = String(item?.hint || '').toLowerCase();
          return label.includes(query) || hint.includes(query);
        }),
      }))
      .filter((section) => (section.items || []).length > 0);
  }, [dashboardSections, navSearchTerm, navCategory]);
  const queueSnapshotTop = useMemo(
    () => [...(queueMetrics || [])]
      .sort((a, b) => (Number(b?.totalMembers) || 0) - (Number(a?.totalMembers) || 0))
      .slice(0, 5),
    [queueMetrics],
  );
  const overviewTopCards = useMemo(
    () => ([
      { key: 'extensions', label: 'Ramais', value: extensions.length, subtitle: 'cadastros ativos', icon: 'phone' },
      { key: 'queues', label: 'Filas', value: queues.length, subtitle: 'distribuição de chamadas', icon: 'users' },
      { key: 'recordings', label: 'Gravações', value: recordings.length, subtitle: 'itens carregados', icon: 'mic' },
      { key: 'cdr', label: 'CDR', value: cdrItems.length, subtitle: 'registros no recorte', icon: 'file' },
      { key: 'governance', label: 'Provisionamento', value: tokenGovernance.message, subtitle: tokenGovernance.remainingLabel || 'sem validade definida', icon: 'shield' },
    ]),
    [extensions.length, queues.length, recordings.length, cdrItems.length, tokenGovernance.message, tokenGovernance.remainingLabel],
  );
  useEffect(() => {
    if (!currentPath.startsWith('/pbx')) return;
    if (currentPath.startsWith('/pbx/provisioning-lote')) return;
    const normalized = currentPath.endsWith('/') && currentPath.length > 1 ? currentPath.slice(0, -1) : currentPath;
    if (routeTabMap[normalized] && routeTabMap[normalized] !== tab) {
      setTab(routeTabMap[normalized]);
      return;
    }
    if (normalized.startsWith('/pbx/referencia/')) {
      const key = decodeURIComponent(normalized.replace('/pbx/referencia/', ''));
      if (tabRouteMap[key] && key !== tab) {
        setTab(key);
        return;
      }
    }
    if (normalized === '/pbx' && tab !== 'overview') {
      setTab('overview');
    }
  }, [currentPath, routeTabMap, tabRouteMap, tab]);
  const legacyTabMeta = LEGACY_MENU_TAB_MAP[tab] || null;
  const activeSectionMeta = useMemo(() => {
    for (const section of dashboardSections) {
      for (const item of section.items || []) {
        if (item.key === tab) {
          return {
            section: section.title,
            label: item.label,
            hint: item.hint || '',
          };
        }
      }
    }
    return null;
  }, [dashboardSections, tab]);
  const isOverviewTab = tab === 'overview';
  const isSectionMode = !isOverviewTab;
  const sectionTitle = activeSectionMeta?.label || (legacyTabMeta ? normalizeLegacyLabel(legacyTabMeta.label) : 'PBX');
  const sectionHint = activeSectionMeta?.hint || '';
  const hasTopFilters = Boolean(searchText || navCategory || (!isSectionMode && navSearchTerm));

  const bulkItemsColumns = useMemo(() => [
    { id: 'extension', header: 'Ramal', accessor: (r) => r.extension },
    { id: 'displayName', header: 'Nome', accessor: (r) => r.displayName || '—' },
    { id: 'authUsername', header: 'Usuário', accessor: (r) => r.authUsername || '—' },
    { id: 'prov', header: 'Provisionamento', sortable: false, render: (r) => (r.provisioningEnabled ? `${r.provisioningVendor || '—'} / ${r.provisioningMac || '—'}` : '—') },
    { id: 'actions', header: '', sortable: false, render: (r) => (<Button onClick={() => handleBulkRemoveItem(r._idx)} disabled={loading} size="sm" variant="danger">Remover</Button>) },
  ], [loading]);

  const extensionsColumns = useMemo(() => [
    { id: 'extension', header: 'Ramal', accessor: (r) => r.extension },
    { id: 'displayName', header: 'Nome', accessor: (r) => r.displayName || '—' },
    { id: 'authUsername', header: 'Usuário', accessor: (r) => r.authUsername || '—' },
    { id: 'contexto', header: 'Categoria', accessor: (r) => r?.endpointOptions?.contexto || '—' },
    { id: 'protocolo', header: 'Protocolo', accessor: (r) => r?.endpointOptions?.protocolo || '—' },
    { id: 'provisioning', header: 'Provisionamento', sortable: false, render: (r) => (r?.endpointOptions?.provisioning?.enabled ? `${r.endpointOptions.provisioning.vendor || '—'} / ${r.endpointOptions.provisioning.mac || '—'}` : '—') },
    { id: 'acl', header: 'ACL', sortable: false, render: (r) => getExtensionAclLabel(r) },
    { id: 'status', header: 'Status', accessor: (r) => r.status || '—' },
    { id: 'actions', header: '', sortable: false, render: (r) => (<Button onClick={() => handleEditExtension(r)} disabled={loading} size="sm" variant="ghost">Editar</Button>) },
  ], [loading, getExtensionAclLabel]);

  const queueMetricsColumns = useMemo(() => [
    { id: 'name', header: 'Fila', accessor: (m) => m.name },
    { id: 'totalMembers', header: 'Membros', accessor: (m) => m.totalMembers ?? 0 },
    { id: 'activeMembers', header: 'Ativos', accessor: (m) => m.activeMembers ?? 0 },
    { id: 'pausedMembers', header: 'Pausados', accessor: (m) => m.pausedMembers ?? 0 },
  ], []);

  const aclsColumns = useMemo(() => [
    {
      id: 'name',
      header: 'Nome',
      sortValue: (a) => a.name,
      render: (a) => (<div><div style={{ fontWeight: 600 }}>{a.name}</div><div style={{ opacity: 0.75, fontSize: 12 }}>{a.description || `id: ${a.id}`}</div></div>),
    },
    { id: 'enabled', header: 'Ativo', accessor: (a) => (a.enabled === false ? 'não' : 'sim'), sortValue: (a) => (a.enabled === false ? 0 : 1) },
    { id: 'permit', header: 'Permit', render: (a) => <code>{String(a.permit || '').slice(0, 200) || '—'}</code> },
    { id: 'deny', header: 'Deny', render: (a) => <code>{String(a.deny || '').slice(0, 200) || '—'}</code> },
    {
      id: 'actions',
      header: '',
      sortable: false,
      render: (a) => (
        <>
          <button onClick={() => handleEditAcl(a)} disabled={loading} style={{ padding: '6px 10px', marginRight: 8 }}>Editar</button>
          <button onClick={() => handleDeleteAcl(a.id)} disabled={loading} style={{ padding: '6px 10px' }}>Remover</button>
        </>
      ),
    },
  ], [loading]);

  const campaignListDraftColumns = useMemo(() => [
    { id: 'phone', header: 'Telefone', accessor: (r) => r.phone },
    { id: 'ddd', header: 'DDD', accessor: (r) => r.ddd || '—' },
    { id: 'key', header: 'Chave', accessor: (r) => r.key || '—' },
    {
      id: 'actions',
      header: '',
      sortable: false,
      render: (r) => (<button onClick={() => handleCampaignListDraftRemove(r._idx)} disabled={loading} style={{ padding: '6px 10px' }}>Remover</button>),
    },
  ], [loading]);

  const bulkGrid = usePlatformGridState({
    rows: bulkItems.map((it, idx) => ({ ...it, _idx: idx })),
    columns: bulkItemsColumns,
    initialSort: { columnId: 'extension', direction: 'asc' },
    persistenceKey: 'pbx-bulk-items-grid',
  });

  const extensionsGrid = usePlatformGridState({
    rows: filteredExtensions,
    columns: extensionsColumns,
    initialSort: { columnId: 'extension', direction: 'asc' },
    persistenceKey: 'pbx-extensions-main-grid',
  });

  const queueMetricsGrid = usePlatformGridState({
    rows: queueMetrics,
    columns: queueMetricsColumns,
    initialSort: { columnId: 'name', direction: 'asc' },
    persistenceKey: 'pbx-queue-metrics-grid',
  });

  const aclsGrid = usePlatformGridState({
    rows: filteredAcls,
    columns: aclsColumns,
    initialSort: { columnId: 'name', direction: 'asc' },
    persistenceKey: 'pbx-acls-grid',
  });

  const campaignListDraftGrid = usePlatformGridState({
    rows: campaignListDraftItems.map((it, idx) => ({ ...it, _idx: idx })),
    columns: campaignListDraftColumns,
    initialSort: { columnId: 'phone', direction: 'asc' },
    persistenceKey: 'pbx-campaign-draft-grid',
  });

  if (isBulkProvisioningScreen) {
    return (
      <CrudPageBase className="pbx-page">
        <div className="pbx-header">
          <div className="pbx-title">
            <h1>PBX: Provisionamento em Lote</h1>
            <p>
              Tela dedicada para envio em lote de ramais com provisioning.
            </p>
          </div>
          <div className="pbx-actions">
            <Button onClick={() => navigate('/pbx')} size="sm" variant="ghost">Voltar ao PBX</Button>
            <Button onClick={refreshAll} disabled={loading} size="sm">{loading ? 'Atualizando…' : 'Atualizar dados'}</Button>
            <Button onClick={handleBulkProvisioning} disabled={loading || bulkItems.length === 0} size="sm" variant="primary">Enviar lote</Button>
          </div>
        </div>

        {error ? <div className="pbx-error">{error}</div> : null}

        <div className="pbx-card">
          <strong>Provisionamento em Lote</strong>
          <p style={{ opacity: 0.75, marginTop: 4 }}>
            Adicione ramais na lista abaixo e envie o lote. (Sem JSON)
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr 1fr 180px 1fr 1fr auto', gap: 8, marginTop: 8 }}>
            <input className={AGENTS_FIELD_CLASS} placeholder="Ramal" value={bulkRow.extension} onChange={(e) => setBulkRow((s) => ({ ...s, extension: e.target.value }))} />
            <input className={AGENTS_FIELD_CLASS} placeholder="Nome" value={bulkRow.displayName} onChange={(e) => setBulkRow((s) => ({ ...s, displayName: e.target.value }))} />
            <input className={AGENTS_FIELD_CLASS} placeholder="Usuário" value={bulkRow.authUsername} onChange={(e) => setBulkRow((s) => ({ ...s, authUsername: e.target.value }))} />
            <input className={AGENTS_FIELD_CLASS} placeholder="Senha" value={bulkRow.authPassword} onChange={(e) => setBulkRow((s) => ({ ...s, authPassword: e.target.value }))} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={!!bulkRow.provisioningEnabled}
                onChange={(e) => setBulkRow((s) => ({ ...s, provisioningEnabled: e.target.checked }))}
              />
              Provisionar
            </label>
            <select
              className={AGENTS_SELECT_CLASS}
              value={bulkRow.provisioningVendor}
              disabled={!bulkRow.provisioningEnabled}
              onChange={(e) => setBulkRow((s) => ({ ...s, provisioningVendor: e.target.value }))}
            >
              <option value="grandstream">grandstream</option>
              <option value="avaya">avaya</option>
            </select>
            <input
              className={AGENTS_FIELD_CLASS}
              placeholder="MAC (ex: 001122AABBCC)"
              value={bulkRow.provisioningMac}
              disabled={!bulkRow.provisioningEnabled}
              onChange={(e) => setBulkRow((s) => ({ ...s, provisioningMac: e.target.value }))}
            />
            <Button onClick={handleBulkAddRow} disabled={loading} size="sm">Adicionar</Button>
          </div>
          <div style={{ marginTop: 10 }}>
            <PlatformGrid
              columns={bulkItemsColumns}
              rows={bulkGrid.rows}
              sort={bulkGrid.sort}
              onSortChange={bulkGrid.handleSortChange}
              pagination={{ page: bulkGrid.page, pageSize: bulkGrid.pageSize, totalPages: bulkGrid.totalPages, totalRows: bulkGrid.totalRows, onPageChange: bulkGrid.handlePageChange, onPageSizeChange: bulkGrid.handlePageSizeChange }}
              emptyState={{ title: 'Lista vazia', description: 'Nenhum item no lote.' }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <Button onClick={handleBulkProvisioning} disabled={loading || bulkItems.length === 0} size="sm">Enviar lote</Button>
            <Button onClick={() => setBulkItems([])} disabled={loading || bulkItems.length === 0} size="sm" variant="ghost">Limpar lista</Button>
            {bulkResult ? (
              <span style={{ opacity: 0.9 }}>
                OK: {bulkResult.okCount || 0} | Erros: {bulkResult.errorCount || 0}
              </span>
            ) : null}
          </div>
        </div>
      <ToastContainer />
      </CrudPageBase>
    );
  }

  return (
    <CrudPageBase className="pbx-page">
      <PbxDashboardShell
        isSectionMode={isSectionMode}
        currentSectionLabel={sectionTitle}
        sectionHint={sectionHint}
        lastUpdatedAt={lastUpdatedAt}
        formatDateTime={formatDateTime}
        navigate={navigate}
        refreshAll={refreshAll}
        loading={loading}
        handleDialplanApply={handleDialplanApply}
        handleAsteriskReload={handleAsteriskReload}
        error={error}
        searchText={searchText}
        setSearchText={setSearchText}
        navSearchTerm={navSearchTerm}
        setNavSearchTerm={setNavSearchTerm}
        tab={tab}
        openPbxSection={openPbxSection}
        dashboardSections={dashboardSections}
        hasTopFilters={hasTopFilters}
        setNavCategory={setNavCategory}
        overviewTopCards={overviewTopCards}
        getDashboardIconPalette={getDashboardIconPalette}
        PbxDashboardIcon={PbxDashboardIcon}
        queueSnapshotTop={queueSnapshotTop}
        filteredDashboardSections={filteredDashboardSections}
        getDashboardIconName={getDashboardIconName}
        Button={Button}
      />

      <div className="pbx-card">
        {tab === 'overview' ? (
          <>
            <h3 style={{ marginTop: 0 }}>Visão geral</h3>
            <div style={{ opacity: 0.8, marginTop: 6 }}>
              Os cards de Visão Geral ficam no topo da página e redirecionam para a tela correspondente.
            </div>

            <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => openPbxSection('extensions')} disabled={loading}>Gerenciar ramais</button>
              <button onClick={() => openPbxSection('queues')} disabled={loading}>Gerenciar filas</button>
              <button onClick={() => openPbxSection('dialplan')} disabled={loading}>Dialplan</button>
              <button onClick={() => openPbxSection('cdr')} disabled={loading}>CDR</button>
              <button onClick={() => navigate('/pbx/provisioning-lote')} disabled={loading}>Provisionamento em lote</button>
            </div>
          </>
        ) : null}
        {legacyTabMeta ? (
          <>
            <h3 style={{ marginTop: 0 }}>{normalizeLegacyLabel(legacyTabMeta.label)}</h3>
            <div style={{ opacity: 0.9, lineHeight: 1.6 }}>
              <div><strong>Seção referência:</strong> {legacyTabMeta.section}</div>
              <div><strong>Tela de referência:</strong> <code>{legacyTabMeta.href}</code></div>
              <div><strong>Status de paridade:</strong> {legacyTabMeta.status}</div>
              <div><strong>Observação:</strong> Esta aba existe para manter correspondência 1:1 com o menu de referência (`menu.php/menu2.php`).</div>
            </div>
            <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {legacyTabMeta.mappedTab ? (
                <Button onClick={() => openPbxSection(legacyTabMeta.mappedTab)} size="sm" variant="primary">
                  Ir para aba equivalente ({legacyTabMeta.mappedTab})
                </Button>
              ) : (
                <Button onClick={() => openPbxSection('governance')} size="sm" variant="ghost">
                  Sem equivalente direto (ver Governança)
                </Button>
              )}
            </div>
          </>
        ) : null}

        <PbxExtensionsAclsTabs
          tab={tab}
          loading={loading}
          AGENTS_FIELD_CLASS={AGENTS_FIELD_CLASS}
          AGENTS_SELECT_CLASS={AGENTS_SELECT_CLASS}
          LEGACY_CONTEXT_OPTIONS={LEGACY_CONTEXT_OPTIONS}
          LEGACY_PROTOCOL_OPTIONS={LEGACY_PROTOCOL_OPTIONS}
          LEGACY_TIPO_OPTIONS={LEGACY_TIPO_OPTIONS}
          handleNewExtension={handleNewExtension}
          showExtensionEditModal={showExtensionEditModal}
          isEditingExtension={isEditingExtension}
          formExt={formExt}
          setFormExt={setFormExt}
          acls={acls}
          handleSaveExtension={handleSaveExtension}
          canSaveExt={canSaveExt}
          setShowExtensionEditModal={setShowExtensionEditModal}
          setIsEditingExtension={setIsEditingExtension}
          provisioningToken={provisioningToken}
          tokenGovernance={tokenGovernance}
          provisioningTokenExpiresAt={provisioningTokenExpiresAt}
          provisioningTokenUpdatedAt={provisioningTokenUpdatedAt}
          rotateExpiresInSec={rotateExpiresInSec}
          setRotateExpiresInSec={setRotateExpiresInSec}
          handleRotateProvisioningToken={handleRotateProvisioningToken}
          handleQuickRotate={handleQuickRotate}
          handleRevokeProvisioningToken={handleRevokeProvisioningToken}
          rotatedToken={rotatedToken}
          buildApiUrl={buildApiUrl}
          navigate={navigate}
          extensionsColumns={extensionsColumns}
          extensionsGrid={extensionsGrid}
          queueMetricsColumns={queueMetricsColumns}
          queueMetricsGrid={queueMetricsGrid}
          formAcl={formAcl}
          setFormAcl={setFormAcl}
          handleSaveAcl={handleSaveAcl}
          canSaveAcl={canSaveAcl}
          refreshCore={refreshCore}
          aclsColumns={aclsColumns}
          aclsGrid={aclsGrid}
          PlatformGrid={PlatformGrid}
          Button={Button}
          formatDateTime={formatDateTime}
        />

        <PbxRoutingTabs
          tab={tab}
          loading={loading}
          AGENTS_FIELD_CLASS={AGENTS_FIELD_CLASS}
          AGENTS_SELECT_CLASS={AGENTS_SELECT_CLASS}
          formTrunk={formTrunk}
          setFormTrunk={setFormTrunk}
          canSaveTrunk={canSaveTrunk}
          handleSaveTrunk={handleSaveTrunk}
          filteredTrunks={filteredTrunks}
          formRoute={formRoute}
          setFormRoute={setFormRoute}
          canSaveRoute={canSaveRoute}
          handleSaveRoute={handleSaveRoute}
          trunks={trunks}
          queues={queues}
          filteredRoutes={filteredRoutes}
          formDid={formDid}
          setFormDid={setFormDid}
          canSaveDid={canSaveDid}
          handleSaveDid={handleSaveDid}
          ivrRules={ivrRules}
          filteredDids={filteredDids}
          formIvr={formIvr}
          setFormIvr={setFormIvr}
          canSaveIvr={canSaveIvr}
          handleSaveIvr={handleSaveIvr}
          filteredIvrRules={filteredIvrRules}
          Button={Button}
        />

        <PbxOperationsTabs
          tab={tab}
          loading={loading}
          AGENTS_FIELD_CLASS={AGENTS_FIELD_CLASS}
          AGENTS_SELECT_CLASS={AGENTS_SELECT_CLASS}
          QUEUE_STRATEGY_OPTIONS={QUEUE_STRATEGY_OPTIONS}
          formQueue={formQueue}
          setFormQueue={setFormQueue}
          canSaveQueue={canSaveQueue}
          handleSaveQueue={handleSaveQueue}
          filteredQueues={filteredQueues}
          handleEditQueue={handleEditQueue}
          selectedQueueId={selectedQueueId}
          setSelectedQueueId={setSelectedQueueId}
          formQm={formQm}
          setFormQm={setFormQm}
          canSaveQm={canSaveQm}
          handleSaveQueueMember={handleSaveQueueMember}
          filteredQueueMembers={filteredQueueMembers}
          handleDeleteQueueMember={handleDeleteQueueMember}
          handleDialplanPreview={handleDialplanPreview}
          handleDialplanApply={handleDialplanApply}
          dialplanRows={dialplanRows}
          configVersions={configVersions}
          formatDateTime={formatDateTime}
          handleRollbackVersion={handleRollbackVersion}
          audioAssetsError={audioAssetsError}
          audioKind={audioKind}
          setAudioKind={setAudioKind}
          handleAudioRefresh={handleAudioRefresh}
          setAudioFile={setAudioFile}
          handleAudioUpload={handleAudioUpload}
          audioFile={audioFile}
          filteredAudioAssets={filteredAudioAssets}
          buildApiUrl={buildApiUrl}
          recordingsError={recordingsError}
          recordingPolicyError={recordingPolicyError}
          recordingPolicy={recordingPolicy}
          setRecordingPolicy={setRecordingPolicy}
          handleSaveRecordingPolicy={handleSaveRecordingPolicy}
          handleRecordingsRefresh={handleRecordingsRefresh}
          handleRecordingsScan={handleRecordingsScan}
          filteredRecordings={filteredRecordings}
          cdrFilters={cdrFilters}
          setCdrFilters={setCdrFilters}
          handleCdrSearch={handleCdrSearch}
          filteredCdrItems={filteredCdrItems}
          Button={Button}
        />
        <PbxContactCenterGovernanceTabs
          tab={tab}
          loading={loading}
          formPauseReason={formPauseReason}
          setFormPauseReason={setFormPauseReason}
          canSavePauseReason={canSavePauseReason}
          handleSavePauseReason={handleSavePauseReason}
          filteredPauseReasons={filteredPauseReasons}
          formContactReason={formContactReason}
          setFormContactReason={setFormContactReason}
          canSaveContactReason={canSaveContactReason}
          handleSaveContactReason={handleSaveContactReason}
          filteredContactReasons={filteredContactReasons}
          formCampaign={formCampaign}
          setFormCampaign={setFormCampaign}
          canSaveCampaign={canSaveCampaign}
          handleSaveCampaign={handleSaveCampaign}
          filteredCampaigns={filteredCampaigns}
          setCcSelectedCampaignId={setCcSelectedCampaignId}
          ccSelectedCampaignId={ccSelectedCampaignId}
          refreshCampaignList={refreshCampaignList}
          campaignListDraftRow={campaignListDraftRow}
          setCampaignListDraftRow={setCampaignListDraftRow}
          handleCampaignListDraftAdd={handleCampaignListDraftAdd}
          campaignListDraftColumns={campaignListDraftColumns}
          campaignListDraftGrid={campaignListDraftGrid}
          handleAddCampaignListItems={handleAddCampaignListItems}
          campaignListDraftItems={campaignListDraftItems}
          setCampaignListDraftItems={setCampaignListDraftItems}
          filteredCampaignList={filteredCampaignList}
          formScheduled={formScheduled}
          setFormScheduled={setFormScheduled}
          canSaveScheduled={canSaveScheduled}
          handleSaveScheduledCallback={handleSaveScheduledCallback}
          filteredScheduled={filteredScheduled}
          formClick2Call={formClick2Call}
          setFormClick2Call={setFormClick2Call}
          canCreateClick2Call={canCreateClick2Call}
          handleCreateClick2Call={handleCreateClick2Call}
          click2CallVars={click2CallVars}
          setClick2CallVars={setClick2CallVars}
          handleClick2CallVarRemove={handleClick2CallVarRemove}
          handleClick2CallVarAdd={handleClick2CallVarAdd}
          filteredC2c={filteredC2c}
          legacyXmlError={legacyXmlError}
          legacyXmlEntity={legacyXmlEntity}
          setLegacyXmlEntity={setLegacyXmlEntity}
          legacyXmlSupported={legacyXmlSupported}
          refreshLegacyXml={refreshLegacyXml}
          legacyXmlMeta={legacyXmlMeta}
          legacyXmlDraftId={legacyXmlDraftId}
          setLegacyXmlDraftId={setLegacyXmlDraftId}
          legacyXmlDraftFields={legacyXmlDraftFields}
          setLegacyXmlDraftFields={setLegacyXmlDraftFields}
          handleLegacyXmlUpsert={handleLegacyXmlUpsert}
          handleLegacyXmlRemoveField={handleLegacyXmlRemoveField}
          handleLegacyXmlAddField={handleLegacyXmlAddField}
          legacyXmlItems={legacyXmlItems}
          filteredLegacyXmlItems={filteredLegacyXmlItems}
          handleLegacyXmlEdit={handleLegacyXmlEdit}
          handleLegacyXmlDelete={handleLegacyXmlDelete}
          provisioningToken={provisioningToken}
          tokenGovernance={tokenGovernance}
          provisioningTokenExpiresAt={provisioningTokenExpiresAt}
          provisioningTokenUpdatedAt={provisioningTokenUpdatedAt}
          pbxAuditHours={pbxAuditHours}
          setPbxAuditHours={setPbxAuditHours}
          refreshPbxAudit={refreshPbxAudit}
          pbxAuditByAction={pbxAuditByAction}
          filteredAuditItems={filteredAuditItems}
          formatDateTime={formatDateTime}
          PlatformGrid={PlatformGrid}
        />
        <PbxCcReportsTabs
          tab={tab}
          formatDateTime={formatDateTime}
        />
        <PbxFaxTabs tab={tab} />
        <PbxInfraConfigTabs tab={tab} />
        <PbxCdrAnalysisTabs tab={tab} />
        <PbxRoutingDetailTabs tab={tab} />
        <PbxConfigDetailTabs tab={tab} />
      </div>
      <ToastContainer />
      </CrudPageBase>
  );
}
