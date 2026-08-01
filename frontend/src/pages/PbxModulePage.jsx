import React, { useEffect, useMemo, useState } from 'react';
import {
  dialplanPreview,
  getProvisioningTokenOrNull,
  listAcls,
  listAudioAssets,
  listCallRules,
  listCdr,
  listConfigVersions,
  listDids,
  listPbxAuditEvents,
  listQueueMembers,
  listQueues,
  listRecordings,
  upsertAcl,
  upsertCallRule,
  upsertDid,
  upsertQueue,
  upsertQueueMember,
} from '../api/pbx';
import {
  addCampaignListItems,
  createClick2CallRequest,
  listCampaignList,
  listCampaigns,
  listClick2CallRequests,
  listContactReasons,
  listPauseReasons,
  listScheduledCallbacks,
  upsertCampaign,
  upsertContactReason,
  upsertPauseReason,
  upsertScheduledCallback,
} from '../api/cc';
import { listLegacyXmlEntity, upsertLegacyXmlEntity } from '../api/pbxLegacy';
import { Button } from '../styles/Button';
import { PlatformGrid, usePlatformGridState } from '../modules/platform-grid';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import logger from '../utils/logger';
import { CrudPageBase } from '../modules/crud-base';

const FIELD_CLASS =
  'w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all';

const SELECT_CLASS =
  'w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all appearance-none cursor-pointer hover:border-border-hover';

const LEGACY_XML_ENTITIES = [
  'ddr', 'grupo', 'desvio', 'transbordo', 'bloqueio', 'retorno', 'recusa', 'feriado', 'transferencia',
  'operadora', 'rota_base', 'rota', 'tipo', 'categoria', 'fax', 'sala', 'interconexao', 'fila', 'motivo', 'motivo1',
];

function normalizePath(path) {
  if (!path) return '/pbx';
  return path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path;
}

function getModuleConfig(path) {
  const normalized = normalizePath(path);

  if (normalized === '/pbx/acls') return { key: 'acls', title: 'ACLs', emoji: '🛡️' };
  if (normalized === '/pbx/dids') return { key: 'dids', title: 'DIDs', emoji: '📥' };
  if (normalized === '/pbx/ivr') return { key: 'ivr', title: 'IVR', emoji: '🎛️' };
  if (normalized === '/pbx/queues') return { key: 'queues', title: 'Filas', emoji: '📞' };
  if (normalized === '/pbx/queue-members') return { key: 'queueMembers', title: 'Membros de Filas', emoji: '👥' };
  if (normalized === '/pbx/dialplan') return { key: 'dialplan', title: 'Dialplan', emoji: '🔀' };
  if (normalized === '/pbx/media') return { key: 'media', title: 'Mídia', emoji: '🎵' };
  if (normalized === '/pbx/recordings') return { key: 'recordings', title: 'Gravações', emoji: '🎙️' };
  if (normalized === '/pbx/cdr') return { key: 'cdr', title: 'CDR', emoji: '📄' };
  if (normalized === '/pbx/governance') return { key: 'governance', title: 'Governança', emoji: '🏢' };
  if (normalized === '/pbx/cc/pause-reasons') return { key: 'ccPauseReasons', title: 'Motivos de Pausa', emoji: '⏸️' };
  if (normalized === '/pbx/cc/contact-reasons') return { key: 'ccContactReasons', title: 'Motivos de Contato', emoji: '🏷️' };
  if (normalized === '/pbx/cc/campaigns') return { key: 'ccCampaigns', title: 'Campanhas', emoji: '📢' };
  if (normalized === '/pbx/cc/campaign-list') return { key: 'ccCampaignList', title: 'Lista de Campanha', emoji: '📋' };
  if (normalized === '/pbx/cc/callbacks') return { key: 'ccScheduled', title: 'Callbacks', emoji: '📅' };
  if (normalized === '/pbx/cc/click2call') return { key: 'ccClick2Call', title: 'Click2Call', emoji: '📱' };
  if (normalized === '/pbx/referencia/xml') return { key: 'legacyXml', title: 'Referência XML', emoji: '🗄️' };

  if (normalized.startsWith('/pbx/referencia/')) {
    const refKey = decodeURIComponent(normalized.replace('/pbx/referencia/', ''));
    return { key: 'legacyRef', title: `Referência: ${refKey}`, emoji: '📚', refKey };
  }

  return { key: 'unknown', title: 'Módulo PBX', emoji: '📞' };
}

function rowMatchesSearch(row, search) {
  if (!search) return true;
  const text = Object.values(row || {}).map((v) => String(v ?? '').toLowerCase()).join(' ');
  return text.includes(search);
}

function formatDateTime(value, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleString();
}

export function PbxModulePage() {
  const { currentPath, navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();
  const moduleConfig = useMemo(() => getModuleConfig(currentPath), [currentPath]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rows, setRows] = useState([]);
  const [versions, setVersions] = useState([]);
  const [search, setSearch] = useState('');

  const [queueId, setQueueId] = useState('');
  const [queueOptions, setQueueOptions] = useState([]);
  const [campaignId, setCampaignId] = useState('');
  const [campaignOptions, setCampaignOptions] = useState([]);
  const [mediaKind, setMediaKind] = useState('ivr');
  const [legacyXmlEntity, setLegacyXmlEntity] = useState('ddr');
  const [governanceMeta, setGovernanceMeta] = useState({ token: '', expiresAt: '' });

  const [cdrFilters, setCdrFilters] = useState({
    limit: '200',
    from: '',
    to: '',
    src: '',
    dst: '',
    uniqueid: '',
  });
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createPayloadText, setCreatePayloadText] = useState('');
  const [creating, setCreating] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError('');

    try {
      const key = moduleConfig.key;

      if (key === 'acls') {
        const res = await listAcls();
        setRows(Array.isArray(res?.items) ? res.items : []);
      } else if (key === 'dids') {
        const res = await listDids();
        setRows(Array.isArray(res?.items) ? res.items : []);
      } else if (key === 'ivr') {
        const res = await listCallRules('ivr');
        setRows(Array.isArray(res?.items) ? res.items : []);
      } else if (key === 'queues') {
        const res = await listQueues();
        setRows(Array.isArray(res?.items) ? res.items : []);
      } else if (key === 'queueMembers') {
        const queuesRes = await listQueues();
        const qItems = Array.isArray(queuesRes?.items) ? queuesRes.items : [];
        setQueueOptions(qItems.map((q) => ({ value: String(q.id), label: String(q.name || q.id) })));
        const chosenQueue = queueId || (qItems[0] ? String(qItems[0].id) : '');
        setQueueId(chosenQueue);
        if (!chosenQueue) {
          setRows([]);
        } else {
          const res = await listQueueMembers(chosenQueue);
          setRows(Array.isArray(res?.items) ? res.items : []);
        }
      } else if (key === 'dialplan') {
        const [preview, cfgVersions] = await Promise.all([dialplanPreview(), listConfigVersions(20)]);
        setRows(Array.isArray(preview?.rows) ? preview.rows : []);
        setVersions(Array.isArray(cfgVersions?.items) ? cfgVersions.items : []);
      } else if (key === 'media') {
        const res = await listAudioAssets(mediaKind || null);
        setRows(Array.isArray(res?.items) ? res.items : []);
      } else if (key === 'recordings') {
        const res = await listRecordings(300);
        setRows(Array.isArray(res?.items) ? res.items : []);
      } else if (key === 'cdr') {
        const payload = {
          limit: Number.parseInt(String(cdrFilters.limit || '200'), 10) || 200,
          from: cdrFilters.from || '',
          to: cdrFilters.to || '',
          src: cdrFilters.src || '',
          dst: cdrFilters.dst || '',
          uniqueid: cdrFilters.uniqueid || '',
        };
        const res = await listCdr(payload);
        setRows(Array.isArray(res?.items) ? res.items : []);
      } else if (key === 'governance') {
        const [auditRes, tokenRes] = await Promise.all([
          listPbxAuditEvents({ hours: 72, limit: 300 }),
          getProvisioningTokenOrNull(),
        ]);
        setRows(Array.isArray(auditRes?.items) ? auditRes.items : []);
        setGovernanceMeta({
          token: String(tokenRes?.token || ''),
          expiresAt: String(tokenRes?.expiresAt || ''),
        });
      } else if (key === 'ccPauseReasons') {
        const res = await listPauseReasons();
        setRows(Array.isArray(res?.items) ? res.items : []);
      } else if (key === 'ccContactReasons') {
        const res = await listContactReasons();
        setRows(Array.isArray(res?.items) ? res.items : []);
      } else if (key === 'ccCampaigns') {
        const res = await listCampaigns();
        const items = Array.isArray(res?.items) ? res.items : [];
        setRows(items);
      } else if (key === 'ccCampaignList') {
        const campaignsRes = await listCampaigns();
        const campaigns = Array.isArray(campaignsRes?.items) ? campaignsRes.items : [];
        setCampaignOptions(campaigns.map((c) => ({ value: String(c.id), label: String(c.name || c.id) })));
        const chosenCampaign = campaignId || (campaigns[0] ? String(campaigns[0].id) : '');
        setCampaignId(chosenCampaign);
        if (!chosenCampaign) {
          setRows([]);
        } else {
          const res = await listCampaignList(chosenCampaign);
          setRows(Array.isArray(res?.items) ? res.items : []);
        }
      } else if (key === 'ccScheduled') {
        const res = await listScheduledCallbacks();
        setRows(Array.isArray(res?.items) ? res.items : []);
      } else if (key === 'ccClick2Call') {
        const res = await listClick2CallRequests(200);
        setRows(Array.isArray(res?.items) ? res.items : []);
      } else if (key === 'legacyXml') {
        const res = await listLegacyXmlEntity(legacyXmlEntity);
        setRows(Array.isArray(res?.items) ? res.items : []);
      } else {
        setRows([]);
      }
    } catch (err) {
      logger.error('[PbxModulePage] load failed', err);
      const message = err?.message || 'Erro ao carregar dados do módulo.';
      setError(message);
      showToast(message, 'error');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [moduleConfig.key, queueId, campaignId, mediaKind, legacyXmlEntity]);

  const filteredRows = useMemo(() => {
    const term = String(search || '').trim().toLowerCase();
    return (rows || []).filter((row) => rowMatchesSearch(row, term));
  }, [rows, search]);

  const createCapabilities = useMemo(() => ({
    acls: true,
    dids: true,
    ivr: true,
    queues: true,
    queueMembers: true,
    ccPauseReasons: true,
    ccContactReasons: true,
    ccCampaigns: true,
    ccCampaignList: true,
    ccScheduled: true,
    ccClick2Call: true,
    legacyXml: true,
  }), []);

  const canCreate = !!createCapabilities[moduleConfig.key];

  function createTemplateForModule() {
    const key = moduleConfig.key;
    if (key === 'acls') {
      return {
        name: 'ACL Corporativa',
        description: 'Exemplo de ACL',
        enabled: true,
        deny: '0.0.0.0/0',
        permit: '10.10.2.0/24',
      };
    }
    if (key === 'dids') {
      return {
        did: '551100000000',
        enabled: true,
        match: {},
        actions: [{ type: 'extension', ref: '1001' }],
      };
    }
    if (key === 'ivr') {
      return {
        type: 'ivr_dialplan_text',
        name: 'URA Principal',
        enabled: true,
        definition: {
          contextSuffix: 'ura_principal',
          dialplanText: '[ivr]\\nexten => s,1,NoOp(IVR)\\nexten => s,n,Hangup()',
        },
      };
    }
    if (key === 'queues') {
      return {
        name: '2000',
        displayName: 'Fila Comercial',
        strategy: 'ringall',
        options: {
          timeout: 15,
          queueNumber: '2000',
          inclui: '*',
          exclui: '',
          parar: '0',
          retornar: 's',
        },
      };
    }
    if (key === 'queueMembers') {
      return {
        queueId: queueId || '',
        memberType: 'extension',
        memberRef: '1001',
        penalty: 0,
        paused: false,
      };
    }
    if (key === 'ccPauseReasons') {
      return { code: 'ALMOCO', description: 'Pausa de almoço', active: true };
    }
    if (key === 'ccContactReasons') {
      return { code: 'INFO', description: 'Solicitação de informação', active: true };
    }
    if (key === 'ccCampaigns') {
      return {
        name: 'Campanha Comercial',
        status: 'draft',
        click2callEnabled: true,
        recordEnabled: false,
      };
    }
    if (key === 'ccCampaignList') {
      return {
        campaignId: campaignId || '',
        items: [{ ddd: '11', phone: '999999999', key: 'lead-1' }],
      };
    }
    if (key === 'ccScheduled') {
      return {
        scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        phone: '999999999',
        ddd: '11',
        description: 'Retorno agendado',
        status: 'pending',
      };
    }
    if (key === 'ccClick2Call') {
      return {
        target: 'agent:1001',
        phone: '999999999',
        ddd: '11',
        campaignId: campaignId || null,
        originate: {
          context: 'from-internal',
          exten: '1001',
          priority: 1,
          timeoutMs: 30000,
          variables: {},
        },
      };
    }
    if (key === 'legacyXml') {
      return {
        id: 'EXEMPLO_001',
        nome: 'Cadastro Exemplo',
      };
    }
    return {};
  }

  function handleOpenCreate() {
    const template = createTemplateForModule();
    setCreatePayloadText(JSON.stringify(template, null, 2));
    setShowCreateModal(true);
  }

  async function handleCreateRecord() {
    if (!canCreate || creating) return;

    let payload;
    try {
      payload = JSON.parse(createPayloadText || '{}');
    } catch (e) {
      showToast('JSON inválido no payload.', 'error');
      return;
    }

    setCreating(true);
    setError('');
    try {
      const key = moduleConfig.key;
      if (key === 'acls') await upsertAcl(payload);
      else if (key === 'dids') await upsertDid(payload);
      else if (key === 'ivr') await upsertCallRule({ type: 'ivr_dialplan_text', ...payload });
      else if (key === 'queues') await upsertQueue(payload);
      else if (key === 'queueMembers') await upsertQueueMember({ queueId: queueId || payload?.queueId, ...payload });
      else if (key === 'ccPauseReasons') await upsertPauseReason(payload);
      else if (key === 'ccContactReasons') await upsertContactReason(payload);
      else if (key === 'ccCampaigns') await upsertCampaign(payload);
      else if (key === 'ccCampaignList') {
        const cid = campaignId || payload?.campaignId;
        const items = Array.isArray(payload?.items) ? payload.items : [];
        await addCampaignListItems({ campaignId: cid, items });
      } else if (key === 'ccScheduled') await upsertScheduledCallback(payload);
      else if (key === 'ccClick2Call') await createClick2CallRequest(payload);
      else if (key === 'legacyXml') await upsertLegacyXmlEntity(legacyXmlEntity, payload);
      else throw new Error('create_not_supported_for_module');

      showToast('Registro incluído com sucesso.', 'success');
      setShowCreateModal(false);
      await loadData();
    } catch (e) {
      logger.error('[PbxModulePage] create failed', e);
      const msg = e?.message || 'Erro ao incluir registro.';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setCreating(false);
    }
  }

  const columns = useMemo(() => {
    const key = moduleConfig.key;

    if (key === 'acls') {
      return [
        { id: 'id', header: 'ID', accessor: (r) => r.id },
        { id: 'name', header: 'Nome', accessor: (r) => r.name || '—' },
        { id: 'description', header: 'Descrição', accessor: (r) => r.description || '—' },
        { id: 'enabled', header: 'Ativo', accessor: (r) => (r.enabled === false ? 'não' : 'sim') },
      ];
    }

    if (key === 'dids') {
      return [
        { id: 'did', header: 'DID', accessor: (r) => r.did || '—' },
        {
          id: 'destination',
          header: 'Destino',
          render: (r) => {
            const action = Array.isArray(r?.actions) ? r.actions[0] : null;
            return action?.type ? `${action.type}${action.ref ? `: ${action.ref}` : ''}` : '—';
          },
        },
        { id: 'enabled', header: 'Ativo', accessor: (r) => (r.enabled ? 'sim' : 'não') },
      ];
    }

    if (key === 'ivr') {
      return [
        { id: 'name', header: 'Nome', accessor: (r) => r.name || '—' },
        { id: 'id', header: 'ID', accessor: (r) => r.id || '—' },
        { id: 'enabled', header: 'Ativo', accessor: (r) => (r.enabled ? 'sim' : 'não') },
      ];
    }

    if (key === 'queues') {
      return [
        { id: 'name', header: 'Fila', accessor: (r) => r.name || '—' },
        { id: 'strategy', header: 'Estratégia', accessor: (r) => r.strategy || '—' },
        { id: 'timeout', header: 'Timeout', accessor: (r) => r.timeout ?? '—' },
        { id: 'retry', header: 'Retry', accessor: (r) => r.retry ?? '—' },
      ];
    }

    if (key === 'queueMembers') {
      return [
        { id: 'interface', header: 'Interface', accessor: (r) => r.interface || '—' },
        { id: 'penalty', header: 'Penalty', accessor: (r) => r.penalty ?? '—' },
        { id: 'paused', header: 'Pausado', accessor: (r) => (r.paused ? 'sim' : 'não') },
      ];
    }

    if (key === 'dialplan') {
      return [
        { id: 'context', header: 'Contexto', accessor: (r) => r.context || '—' },
        { id: 'exten', header: 'Exten', accessor: (r) => r.exten || '—' },
        { id: 'priority', header: 'Priority', accessor: (r) => r.priority ?? '—' },
        { id: 'app', header: 'Aplicação', accessor: (r) => r.app || '—' },
        { id: 'appData', header: 'Dados', accessor: (r) => r.appData || '—' },
      ];
    }

    if (key === 'media') {
      return [
        { id: 'name', header: 'Nome', accessor: (r) => r.name || '—' },
        { id: 'kind', header: 'Kind', accessor: (r) => r.kind || '—' },
        { id: 'id', header: 'ID', accessor: (r) => r.id || '—' },
      ];
    }

    if (key === 'recordings') {
      return [
        { id: 'uniqueid', header: 'Uniqueid', accessor: (r) => r.uniqueid || '—' },
        { id: 'src', header: 'Origem', accessor: (r) => r.src || '—' },
        { id: 'dst', header: 'Destino', accessor: (r) => r.dst || '—' },
        { id: 'id', header: 'ID', accessor: (r) => r.id || '—' },
      ];
    }

    if (key === 'cdr') {
      return [
        {
          id: 'calldate',
          header: 'Calldate',
          render: (r) => formatDateTime(r.calldate),
        },
        { id: 'src', header: 'Src', accessor: (r) => r.src || '—' },
        { id: 'dst', header: 'Dst', accessor: (r) => r.dst || '—' },
        { id: 'disposition', header: 'Disposition', accessor: (r) => r.disposition || '—' },
        { id: 'duration', header: 'Duration', accessor: (r) => r.duration ?? '—' },
        { id: 'uniqueid', header: 'Uniqueid', accessor: (r) => r.uniqueid || '—' },
      ];
    }

    if (key === 'governance') {
      return [
        {
          id: 'createdAt',
          header: 'Quando',
          render: (r) => formatDateTime(r.createdAt),
        },
        { id: 'action', header: 'Ação', accessor: (r) => r.action || '—' },
        { id: 'actor', header: 'Ator', accessor: (r) => r.actor || '—' },
        { id: 'entityType', header: 'Entidade', accessor: (r) => r.entityType || '—' },
        { id: 'entityId', header: 'ID Entidade', accessor: (r) => r.entityId || '—' },
      ];
    }

    if (key === 'ccPauseReasons' || key === 'ccContactReasons') {
      return [
        { id: 'code', header: 'Code', accessor: (r) => r.code || '—' },
        { id: 'description', header: 'Descrição', accessor: (r) => r.description || '—' },
        { id: 'active', header: 'Ativo', accessor: (r) => (r.active ? 'sim' : 'não') },
      ];
    }

    if (key === 'ccCampaigns') {
      return [
        { id: 'id', header: 'ID', accessor: (r) => r.id || '—' },
        { id: 'name', header: 'Nome', accessor: (r) => r.name || '—' },
        { id: 'status', header: 'Status', accessor: (r) => r.status || '—' },
        { id: 'click2callEnabled', header: 'Click2Call', accessor: (r) => (r.click2callEnabled ? 'sim' : 'não') },
      ];
    }

    if (key === 'ccCampaignList') {
      return [
        { id: 'id', header: 'ID', accessor: (r) => r.id || '—' },
        { id: 'phone', header: 'Telefone', accessor: (r) => r.phone || '—' },
        { id: 'status', header: 'Status', accessor: (r) => r.status || '—' },
        { id: 'name', header: 'Nome', accessor: (r) => r.name || '—' },
      ];
    }

    if (key === 'ccScheduled') {
      return [
        {
          id: 'scheduledTo',
          header: 'Agendado para',
          render: (r) => formatDateTime(r.scheduledTo),
        },
        { id: 'phone', header: 'Telefone', accessor: (r) => r.phone || '—' },
        { id: 'campaignId', header: 'Campanha', accessor: (r) => r.campaignId || '—' },
        { id: 'status', header: 'Status', accessor: (r) => r.status || '—' },
      ];
    }

    if (key === 'ccClick2Call') {
      return [
        {
          id: 'createdAt',
          header: 'Quando',
          render: (r) => formatDateTime(r.createdAt),
        },
        { id: 'target', header: 'Target', accessor: (r) => r.target || '—' },
        { id: 'phone', header: 'Telefone', accessor: (r) => `${r.ddd ? `${r.ddd} ` : ''}${r.phone || ''}` || '—' },
        { id: 'status', header: 'Status', accessor: (r) => r.status || '—' },
        { id: 'campaignId', header: 'Campanha', accessor: (r) => r.campaignId || '—' },
      ];
    }

    return [{ id: 'json', header: 'Dados', accessor: (r) => JSON.stringify(r) }];
  }, [moduleConfig.key]);

  const versionColumns = useMemo(() => [
    { id: 'version', header: 'Versão', accessor: (r) => r.version || '—' },
    { id: 'scope', header: 'Escopo', accessor: (r) => r.scope || '—' },
    { id: 'createdAt', header: 'Criado em', render: (r) => formatDateTime(r.createdAt) },
    { id: 'createdBy', header: 'Criado por', accessor: (r) => r.createdBy || '—' },
  ], []);

  const mainGrid = usePlatformGridState({
    rows: filteredRows,
    columns,
    initialSort: { columnId: 'id', direction: 'asc' },
    persistenceKey: `pbx-module-${moduleConfig.key}-grid`,
  });

  const versionsGrid = usePlatformGridState({
    rows: versions,
    columns: versionColumns,
    initialSort: { columnId: 'createdAt', direction: 'desc' },
    persistenceKey: 'pbx-module-versions-grid',
  });

  const showCdrFilters = moduleConfig.key === 'cdr';
  const showQueuePicker = moduleConfig.key === 'queueMembers';
  const showCampaignPicker = moduleConfig.key === 'ccCampaignList';
  const showMediaPicker = moduleConfig.key === 'media';
  const showLegacyXmlPicker = moduleConfig.key === 'legacyXml';

  return (
    <CrudPageBase>
      <div className="support-header">
        <div className="page-header">
          <h1>{moduleConfig.emoji} PBX • {moduleConfig.title}</h1>
        </div>
        <div className="support-controls">
          <Button
            onClick={handleOpenCreate}
            disabled={!canCreate || loading}
            variant={canCreate ? 'success' : 'default'}
            className="mr-2.5"
          >
            ➕ Incluir
          </Button>
          <Button onClick={() => navigate('/pbx')} variant="default" className="mr-2.5">
            ← Dashboard PBX
          </Button>
          <Button onClick={loadData} variant="primary">
            🔄 Atualizar
          </Button>
        </div>
      </div>

      {!!error && (
        <div className="bg-status-error/10 border border-status-error/30 text-status-error rounded-lg p-3 mb-6 text-sm">
          {error}
        </div>
      )}

      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
          <span>🔍</span>
          <span>Filtros</span>
        </h3>

        <div className={`grid grid-cols-1 ${showCdrFilters ? 'md:grid-cols-6' : 'md:grid-cols-4'} gap-6`}>
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">Buscar</label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar nesta tabela..."
              className={FIELD_CLASS}
            />
          </div>

          {showQueuePicker ? (
            <div>
              <label className="block mb-2 text-sm font-medium text-text-primary">Fila</label>
              <select className={SELECT_CLASS} value={queueId} onChange={(e) => setQueueId(e.target.value)}>
                {(queueOptions || []).map((q) => <option key={q.value} value={q.value}>{q.label}</option>)}
              </select>
            </div>
          ) : null}

          {showCampaignPicker ? (
            <div>
              <label className="block mb-2 text-sm font-medium text-text-primary">Campanha</label>
              <select className={SELECT_CLASS} value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
                {(campaignOptions || []).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
          ) : null}

          {showMediaPicker ? (
            <div>
              <label className="block mb-2 text-sm font-medium text-text-primary">Tipo de áudio</label>
              <select className={SELECT_CLASS} value={mediaKind} onChange={(e) => setMediaKind(e.target.value)}>
                <option value="ivr">ivr</option>
                <option value="espera">espera</option>
                <option value="sons">sons</option>
              </select>
            </div>
          ) : null}

          {showLegacyXmlPicker ? (
            <div>
              <label className="block mb-2 text-sm font-medium text-text-primary">Entidade XML</label>
              <select className={SELECT_CLASS} value={legacyXmlEntity} onChange={(e) => setLegacyXmlEntity(e.target.value)}>
                {LEGACY_XML_ENTITIES.map((it) => <option key={it} value={it}>{it}</option>)}
              </select>
            </div>
          ) : null}

          {showCdrFilters ? (
            <>
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">Src</label>
                <input className={FIELD_CLASS} value={cdrFilters.src} onChange={(e) => setCdrFilters((s) => ({ ...s, src: e.target.value }))} />
              </div>
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">Dst</label>
                <input className={FIELD_CLASS} value={cdrFilters.dst} onChange={(e) => setCdrFilters((s) => ({ ...s, dst: e.target.value }))} />
              </div>
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">From (ISO)</label>
                <input className={FIELD_CLASS} value={cdrFilters.from} onChange={(e) => setCdrFilters((s) => ({ ...s, from: e.target.value }))} />
              </div>
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">To (ISO)</label>
                <input className={FIELD_CLASS} value={cdrFilters.to} onChange={(e) => setCdrFilters((s) => ({ ...s, to: e.target.value }))} />
              </div>
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">Limit</label>
                <input className={FIELD_CLASS} value={cdrFilters.limit} onChange={(e) => setCdrFilters((s) => ({ ...s, limit: e.target.value }))} />
              </div>
            </>
          ) : null}

          <div className="flex items-end">
            <Button
              onClick={() => {
                setSearch('');
                if (showCdrFilters) {
                  setCdrFilters({ limit: '200', from: '', to: '', src: '', dst: '', uniqueid: '' });
                }
              }}
              className="w-full"
            >
              Limpar Filtros
            </Button>
          </div>
        </div>

        {moduleConfig.key === 'governance' ? (
          <div className="mt-4 pt-4 border-t border-border-default text-sm text-text-secondary">
            <strong>Token de provisionamento:</strong> {governanceMeta.token || '—'}
            {governanceMeta.expiresAt ? ` · expira em ${formatDateTime(governanceMeta.expiresAt, '')}` : ''}
          </div>
        ) : null}
        {!canCreate ? (
          <div className="mt-4 pt-4 border-t border-border-default text-sm text-text-secondary">
            Este módulo está em modo consulta no momento (inclusão indisponível).
          </div>
        ) : null}
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
        {loading ? (
          <div className="text-sm text-text-secondary">Carregando...</div>
        ) : (
          <PlatformGrid
            columns={columns}
            rows={mainGrid.rows}
            sort={mainGrid.sort}
            onSortChange={mainGrid.handleSortChange}
            pagination={{
              page: mainGrid.page,
              pageSize: mainGrid.pageSize,
              totalPages: mainGrid.totalPages,
              totalRows: mainGrid.totalRows,
              onPageChange: mainGrid.handlePageChange,
              onPageSizeChange: mainGrid.handlePageSizeChange,
            }}
            emptyState={{ title: 'Nenhum registro', description: 'Nenhum registro encontrado.' }}
          />
        )}
      </div>

      {moduleConfig.key === 'dialplan' && versions.length ? (
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg mt-6">
          <h3 className="text-xl font-semibold text-text-primary mb-4">Versões de Configuração</h3>
          <PlatformGrid
            columns={versionColumns}
            rows={versionsGrid.rows}
            sort={versionsGrid.sort}
            onSortChange={versionsGrid.handleSortChange}
            pagination={{
              page: versionsGrid.page,
              pageSize: versionsGrid.pageSize,
              totalPages: versionsGrid.totalPages,
              totalRows: versionsGrid.totalRows,
              onPageChange: versionsGrid.handlePageChange,
              onPageSizeChange: versionsGrid.handlePageSizeChange,
            }}
            emptyState={{ title: 'Sem versões', description: 'Sem versões disponíveis.' }}
          />
        </div>
      ) : null}

      {showCreateModal ? (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowCreateModal(false);
          }}
        >
          <div className="bg-bg-elevated rounded-xl border border-border-default p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl">
            <h2 className="text-2xl font-bold text-text-primary mb-4">
              ➕ Incluir em {moduleConfig.title}
            </h2>
            <p className="text-sm text-text-secondary mb-3">
              Edite o JSON e confirme para incluir.
            </p>
            <textarea
              className={FIELD_CLASS}
              style={{ minHeight: 280, fontFamily: 'var(--font-family-mono)' }}
              value={createPayloadText}
              onChange={(e) => setCreatePayloadText(e.target.value)}
            />
            <div className="flex gap-3 pt-4">
              <Button onClick={handleCreateRecord} disabled={creating} variant="primary" className="flex-1">
                {creating ? 'Incluindo...' : 'Confirmar Inclusão'}
              </Button>
              <Button onClick={() => setShowCreateModal(false)} variant="ghost" className="flex-1">
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <ToastContainer />
    </CrudPageBase>
  );
}

export default PbxModulePage;
