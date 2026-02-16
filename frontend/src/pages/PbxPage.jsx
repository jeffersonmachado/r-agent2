import React, { useEffect, useMemo, useState } from 'react';
import './PbxPage.css';
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
import { DataGrid } from '../components/DataGrid';
import { Button } from '../styles/Button';
import { useRouter } from '../hooks/useRouter';

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

const LEGACY_CONTEXT_OPTIONS = [
  ['senha', 'Senha'],
  ['ramal', 'Ramal'],
  ['local', 'Local'],
  ['local-cel', 'Local Celulares'],
  ['interurbano', 'Interurbano'],
  ['internacional', 'Internacional'],
];

const LEGACY_PROTOCOL_OPTIONS = [
  ['PJSIP', 'SIP (PJSIP)'],
  ['IAX2', 'IAX2'],
];

const LEGACY_TIPO_OPTIONS = [
  ['Livre', 'Livre'],
  ['Controle', 'Controle'],
  ['Senha', 'Senha'],
];

const QUEUE_STRATEGY_OPTIONS = [
  ['ringall', 'Todos'],
  ['leastrecent', 'Ultimo'],
  ['random', 'Randomico'],
  ['linear', 'Linear'],
  ['rrmemory', 'LinearMemoria'],
];

const LEGACY_MENU_TAB_ITEMS = [
  { key: 'legacyPainel', label: 'Legado: Painel', section: 'Dashboards', href: 'app/painel.html', mappedTab: 'overview', status: 'coberto' },
  { key: 'legacyDdr', label: 'Legado: DDR', section: 'Manutenção', href: 'app/ddr.html', mappedTab: 'routes', status: 'parcial' },
  { key: 'legacyGrupos', label: 'Legado: Grupos', section: 'Manutenção', href: 'app/grupo.html', mappedTab: 'extensions', status: 'parcial' },
  { key: 'legacyRamais', label: 'Legado: Ramais', section: 'Manutenção', href: 'app/ramais.html', mappedTab: 'extensions', status: 'coberto' },
  { key: 'legacyDesvio', label: 'Legado: Desvio', section: 'Manutenção', href: 'app/desvio.html', mappedTab: 'routes', status: 'parcial' },
  { key: 'legacyTransbordo', label: 'Legado: Transbordo', section: 'Manutenção', href: 'app/transbordo.html', mappedTab: 'routes', status: 'parcial' },
  { key: 'legacyBloqueio', label: 'Legado: Bloqueio', section: 'Manutenção', href: 'app/bloqueio.html', mappedTab: 'extensions', status: 'parcial' },
  { key: 'legacyRetorno', label: 'Legado: Retorno', section: 'Manutenção', href: 'app/retorno.html', mappedTab: 'routes', status: 'parcial' },
  { key: 'legacyRecusa', label: 'Legado: Recusa', section: 'Manutenção', href: 'app/recusa.html', mappedTab: 'routes', status: 'parcial' },
  { key: 'legacyFeriado', label: 'Legado: Feriado', section: 'Manutenção', href: 'app/feriado.html', mappedTab: 'routes', status: 'parcial' },
  { key: 'legacyTransferencia', label: 'Legado: Transferência', section: 'Manutenção', href: 'app/transferencia.html', mappedTab: 'routes', status: 'parcial' },
  { key: 'legacyAudioEspera', label: 'Legado: Áudios Espera', section: 'Áudios', href: 'app/upload.html?dir=espera', mappedTab: 'media', status: 'coberto' },
  { key: 'legacyAudioSons', label: 'Legado: Áudios Sons', section: 'Áudios', href: 'app/upload.html?dir=sons', mappedTab: 'media', status: 'coberto' },
  { key: 'legacyRelLigacoes', label: 'Legado: Relatório Ligações', section: 'Relatórios', href: 'app/cdr.html', mappedTab: 'cdr', status: 'coberto' },
  { key: 'legacyRelFax', label: 'Legado: Relatório Fax', section: 'Relatórios', href: 'app/fax_rel.html', mappedTab: null, status: 'pendente' },
  { key: 'legacyRelGravacoes', label: 'Legado: Relatório Gravações', section: 'Relatórios', href: 'app/sac.html', mappedTab: 'recordings', status: 'coberto' },
  { key: 'legacyRelResumo', label: 'Legado: Relatório Resumo', section: 'Relatórios', href: 'app/resumo.html', mappedTab: 'cdr', status: 'parcial' },
  { key: 'legacyRelHora', label: 'Legado: Relatório Hora', section: 'Relatórios', href: 'app/hora.html', mappedTab: 'cdr', status: 'parcial' },
  { key: 'legacyRelOrigem', label: 'Legado: Relatório Origem', section: 'Relatórios', href: 'app/origem.html', mappedTab: 'cdr', status: 'parcial' },
  { key: 'legacyRelDestino', label: 'Legado: Relatório Destino', section: 'Relatórios', href: 'app/destino.html', mappedTab: 'cdr', status: 'parcial' },
  { key: 'legacyCfgConfiguracoes', label: 'Legado: Configurações', section: 'Configurações', href: 'app/configuracoes.html', mappedTab: 'governance', status: 'parcial' },
  { key: 'legacyCfgOperadoras', label: 'Legado: Operadoras', section: 'Configurações', href: 'app/operadoras.html', mappedTab: 'trunks', status: 'parcial' },
  { key: 'legacyCfgRotas', label: 'Legado: Rotas', section: 'Configurações', href: 'app/rotas.html', mappedTab: 'routes', status: 'coberto' },
  { key: 'legacyCfgCategoria', label: 'Legado: Categoria', section: 'Configurações', href: 'app/categoria.html', mappedTab: 'extensions', status: 'parcial' },
  { key: 'legacyCfgFax', label: 'Legado: Fax', section: 'Configurações', href: 'app/fax.html', mappedTab: null, status: 'pendente' },
  { key: 'legacyCfgFacilidades', label: 'Legado: Facilidades', section: 'Configurações', href: 'app/facilidades.html', mappedTab: 'extensions', status: 'parcial' },
  { key: 'legacyCfgUra', label: 'Legado: URA', section: 'Configurações', href: 'app/ura.html', mappedTab: 'ivr', status: 'coberto' },
  { key: 'legacyCfgSala', label: 'Legado: Sala', section: 'Configurações', href: 'app/sala.html', mappedTab: 'queues', status: 'parcial' },
  { key: 'legacyCfgInterconexao', label: 'Legado: Interconexão', section: 'Configurações', href: 'app/interconexao.html', mappedTab: 'trunks', status: 'parcial' },
  { key: 'legacyCfgUsuarios', label: 'Legado: Usuários', section: 'Configurações', href: 'app/usuarios.html', mappedTab: null, status: 'pendente' },
  { key: 'legacyCfgRede', label: 'Legado: Rede', section: 'Configurações', href: 'config/net', mappedTab: null, status: 'pendente' },
  { key: 'legacyCfgDhcp', label: 'Legado: DHCP', section: 'Configurações', href: 'config/dhcpd', mappedTab: null, status: 'pendente' },
  { key: 'legacyCfgFirewall', label: 'Legado: Firewall', section: 'Configurações', href: 'config/firewalld', mappedTab: null, status: 'pendente' },
  { key: 'legacyCfgVpn', label: 'Legado: VPN', section: 'Configurações', href: 'config/ipsec', mappedTab: null, status: 'pendente' },
  { key: 'legacyCfgLicenca', label: 'Legado: Licença', section: 'Configurações', href: 'app/licenca.php', mappedTab: 'governance', status: 'parcial' },
  { key: 'legacyCfgAtualizacao', label: 'Legado: Atualização', section: 'Configurações', href: 'app/update.php', mappedTab: 'governance', status: 'parcial' },
  { key: 'legacyCfgAssistencia', label: 'Legado: Assistência', section: 'Configurações', href: '/cgi/ripabx/assistencia.cgi', mappedTab: 'governance', status: 'parcial' },
  { key: 'legacyCfgRecarga', label: 'Legado: Recarga', section: 'Configurações', href: 'app/recarga.php', mappedTab: 'governance', status: 'parcial' },
  { key: 'legacyCfgServicos', label: 'Legado: Serviços', section: 'Configurações', href: 'app/servicos.html', mappedTab: 'governance', status: 'parcial' },
  { key: 'legacyCfgProcessos', label: 'Legado: Processos', section: 'Configurações', href: '/pm2', mappedTab: 'governance', status: 'parcial' },
  { key: 'legacyCcFila', label: 'Legado: CC Fila', section: 'Contact Center', href: 'app/fila.html', mappedTab: 'queues', status: 'coberto' },
  { key: 'legacyCcMotivoPausa', label: 'Legado: CC Motivo Pausa', section: 'Contact Center', href: 'app/motivo.html', mappedTab: 'ccPauseReasons', status: 'coberto' },
  { key: 'legacyCcMotivoContato', label: 'Legado: CC Motivo Contato', section: 'Contact Center', href: 'app/motivo1.html', mappedTab: 'ccContactReasons', status: 'coberto' },
  { key: 'legacyCcCampanhas', label: 'Legado: CC Campanhas', section: 'Contact Center', href: 'app/campanha.html', mappedTab: 'ccCampaigns', status: 'coberto' },
  { key: 'legacyCcCallbackAgendado', label: 'Legado: CC Callback Agendado', section: 'Contact Center', href: 'app/agendado.html', mappedTab: 'ccScheduled', status: 'coberto' },
  { key: 'legacyCcRelAtendidas', label: 'Legado: CC Relatório Atendidas', section: 'Contact Center', href: 'app/fila_atendidas.html', mappedTab: null, status: 'pendente' },
  { key: 'legacyCcRelAbandonadas', label: 'Legado: CC Relatório Abandonadas', section: 'Contact Center', href: 'app/fila_abandonadas.html', mappedTab: null, status: 'pendente' },
  { key: 'legacyCcRelAgentes', label: 'Legado: CC Relatório Agentes', section: 'Contact Center', href: 'app/fila_agentes.html', mappedTab: null, status: 'pendente' },
  { key: 'legacyCcRelHora', label: 'Legado: CC Relatório por Hora', section: 'Contact Center', href: 'app/fila_hora.html', mappedTab: null, status: 'pendente' },
  { key: 'legacyCcRelResumoCampanha', label: 'Legado: CC Resumo por Campanha', section: 'Contact Center', href: 'app/filas_resumo.html', mappedTab: null, status: 'pendente' },
  { key: 'legacyCcRelPesquisa', label: 'Legado: CC Pesquisa', section: 'Contact Center', href: 'app/pesquisa.html', mappedTab: null, status: 'pendente' },
  { key: 'legacyCcClick2Call', label: 'Legado: CC Click2Call', section: 'Contact Center', href: 'app/click2call.php', mappedTab: 'ccClick2Call', status: 'coberto' },
];

const LEGACY_MENU_TAB_MAP = Object.fromEntries(LEGACY_MENU_TAB_ITEMS.map((item) => [item.key, item]));
const LEGACY_DASHBOARD_ITEMS = LEGACY_MENU_TAB_ITEMS.filter((item) => item.status !== 'pendente' && item.mappedTab);

function normalizeLegacyLabel(label) {
  return String(label || '')
    .replace(/^Legado:\s*/i, '')
    .replace(/^CC\s*/i, '')
    .trim();
}

const AGENTS_FIELD_CLASS =
  'w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all';

const AGENTS_SELECT_CLASS =
  'w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all appearance-none cursor-pointer hover:border-border-hover';

const PBX_DASHBOARD_ICONS = {
  overview: 'chart',
  extensions: 'phone',
  acls: 'shield',
  trunks: 'network',
  routes: 'route',
  dids: 'hash',
  ivr: 'sliders',
  queues: 'inbox',
  queueMembers: 'users',
  dialplan: 'branch',
  media: 'music',
  recordings: 'mic',
  cdr: 'file',
  governance: 'building',
  ccPauseReasons: 'pause',
  ccContactReasons: 'tag',
  ccCampaigns: 'megaphone',
  ccCampaignList: 'list',
  ccScheduled: 'calendar',
  ccClick2Call: 'mobile',
  legacyXml: 'database',
};

const PBX_DASHBOARD_EMOJIS = {
  layout: '🧩',
  chart: '📊',
  phone: '📞',
  shield: '🛡️',
  network: '🌐',
  route: '🧭',
  hash: '#️⃣',
  sliders: '🎛️',
  inbox: '📥',
  users: '👥',
  branch: '🔀',
  music: '🎵',
  mic: '🎙️',
  file: '📄',
  building: '🏢',
  pause: '⏸️',
  tag: '🏷️',
  megaphone: '📢',
  list: '📋',
  calendar: '📅',
  mobile: '📱',
  database: '🗄️',
};

const PBX_SECTION_ICON_ROTATION = {
  Dashboards: ['chart', 'layout'],
  'Manutenção': ['sliders', 'route', 'phone'],
  'Áudios': ['music', 'mic'],
  'Relatórios': ['file', 'chart'],
  'Configurações': ['building', 'shield', 'network'],
  'Contact Center': ['users', 'calendar', 'mobile'],
  default: ['tag', 'list', 'database'],
};

const PBX_ICON_COLOR_ROTATION = {
  'PBX: Operação': [
    'bg-cyan-500 text-white',
    'bg-emerald-500 text-white',
    'bg-violet-500 text-white',
    'bg-orange-500 text-white',
  ],
  'PBX: Plataforma': [
    'bg-teal-500 text-white',
    'bg-indigo-500 text-white',
    'bg-pink-500 text-white',
    'bg-blue-500 text-white',
  ],
  'Contact Center': [
    'bg-amber-500 text-white',
    'bg-cyan-600 text-white',
    'bg-purple-500 text-white',
    'bg-rose-500 text-white',
  ],
  default: [
    'bg-slate-500 text-white',
    'bg-blue-500 text-white',
    'bg-teal-500 text-white',
  ],
};

const PBX_STATIC_TAB_ROUTES = {
  overview: '/pbx',
  extensions: '/pbx/extensions',
  acls: '/pbx/acls',
  trunks: '/pbx/trunks',
  routes: '/pbx/routes',
  dids: '/pbx/dids',
  ivr: '/pbx/ivr',
  queues: '/pbx/queues',
  queueMembers: '/pbx/queue-members',
  dialplan: '/pbx/dialplan',
  media: '/pbx/media',
  recordings: '/pbx/recordings',
  cdr: '/pbx/cdr',
  governance: '/pbx/governance',
  ccPauseReasons: '/pbx/cc/pause-reasons',
  ccContactReasons: '/pbx/cc/contact-reasons',
  ccCampaigns: '/pbx/cc/campaigns',
  ccCampaignList: '/pbx/cc/campaign-list',
  ccScheduled: '/pbx/cc/callbacks',
  ccClick2Call: '/pbx/cc/click2call',
  legacyXml: '/pbx/referencia/xml',
};

function getDashboardIconName(item, sectionTitle, index) {
  if (item?.key && PBX_DASHBOARD_ICONS[item.key]) return PBX_DASHBOARD_ICONS[item.key];
  const rotation = PBX_SECTION_ICON_ROTATION[sectionTitle] || PBX_SECTION_ICON_ROTATION.default;
  return rotation[index % rotation.length];
}

function getDashboardIconPalette(sectionTitle, index) {
  const rotation = PBX_ICON_COLOR_ROTATION[sectionTitle] || PBX_ICON_COLOR_ROTATION.default;
  return rotation[index % rotation.length];
}

function PbxDashboardIcon({ name }) {
  return <span aria-hidden>{PBX_DASHBOARD_EMOJIS[name] || '📌'}</span>;
}

const INITIAL_EXTENSION_FORM = {
  extension: '',
  displayName: '',
  authUsername: '',
  authPassword: '',
  calleridName: '',
  calleridNumber: '',
  calleridExternal: '',
  contexto: 'ramal',
  grupo: '',
  gsm: false,
  g729: false,
  correio: false,
  webfone: false,
  gravar: false,
  protocolo: 'PJSIP',
  bloqueio: '0.0.0.0/0',
  permissao: '0.0.0.0/0',
  tipo: 'Livre',
  senhad: '',
  chamadas: '10',
  tempo: '60',
  aclId: '',
  provisioningEnabled: false,
  provisioningVendor: 'grandstream',
  provisioningMac: '',
  provisioningModel: '',
};

export function PbxPage() {
  const { currentPath, navigate } = useRouter();
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
    setError(null);
    try {
      await refreshCore();
      await refreshAux();
      await refreshPbxAudit();
      await refreshCC();
      setLastUpdatedAt(new Date().toISOString());
    } catch (e) {
      logger.error('[PbxPage] refresh failed', e);
      setError(e?.message || String(e));
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
      setError(e?.message || String(e));
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
      setError(e?.message || String(e));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ccSelectedCampaignId]);

  async function handleSaveExtension() {
    if (!canSaveExt) return;
    setLoading(true);
    setError(null);
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
      setError(e?.message || String(e));
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
    setError(null);
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
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteAcl(id) {
    const aclId = (id || '').trim();
    if (!aclId) return;
    setLoading(true);
    setError(null);
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
        await Promise.all([refreshCore(), refreshPbxAudit()]);
      }
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleQuickRotate(expiresInSec) {
    setRotateExpiresInSec(String(expiresInSec));
    setLoading(true);
    setError(null);
    try {
      const out = await rotateProvisioningToken(expiresInSec);
      if (out?.ok && out?.token) {
        setRotatedToken(out.token);
        await Promise.all([refreshCore(), refreshPbxAudit()]);
      }
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleRevokeProvisioningToken() {
    setLoading(true);
    setError(null);
    try {
      await revokeProvisioningToken();
      setRotatedToken(null);
      setRotateExpiresInSec('');
      await Promise.all([refreshCore(), refreshPbxAudit()]);
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
      setError(e?.message || String(e));
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
      setError(e?.message || String(e));
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
    setError(null);
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
	      setError(e?.message || String(e));
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
    setError(null);
    try {
      await deleteLegacyXmlEntity(legacyXmlEntity, id);
      await refreshLegacyXml();
    } catch (e) {
      logger.error('[PbxPage] legacy xml delete failed', e);
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
      await Promise.all([handleDialplanPreview(), refreshCore()]);
    } catch (e) {
      logger.error('[PbxPage] dialplan apply failed', e);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleRollbackVersion(version) {
    if (!version) return;
    setLoading(true);
    setError(null);
    try {
      await rollbackDialplan(version);
      await Promise.all([handleDialplanPreview(), refreshCore()]);
    } catch (e) {
      logger.error('[PbxPage] dialplan rollback failed', e);
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

  async function handleSaveRecordingPolicy() {
    setLoading(true);
    setError(null);
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

  async function handleSavePauseReason() {
    if (!canSavePauseReason) return;
    setLoading(true);
    setError(null);
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
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveContactReason() {
    if (!canSaveContactReason) return;
    setLoading(true);
    setError(null);
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
      setError(e?.message || String(e));
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
	      setError(e?.message || String(e));
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
	      setError(e?.message || String(e));
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
	      setError(e?.message || String(e));
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
	      setError(e?.message || String(e));
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

  if (isBulkProvisioningScreen) {
    return (
      <div className="support-page pbx-page">
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
            <DataGrid
              rows={bulkItems.map((it, idx) => ({ ...it, _idx: idx }))}
              emptyText="Nenhum item no lote."
              defaultSort={{ id: 'extension', dir: 'asc' }}
              columns={[
                { id: 'extension', header: 'Ramal', accessor: (r) => r.extension },
                { id: 'displayName', header: 'Nome', accessor: (r) => r.displayName || '—' },
                { id: 'authUsername', header: 'Usuário', accessor: (r) => r.authUsername || '—' },
                {
                  id: 'prov',
                  header: 'Provisionamento',
                  sortable: false,
                  render: (r) => (r.provisioningEnabled ? `${r.provisioningVendor || '—'} / ${r.provisioningMac || '—'}` : '—'),
                },
                {
                  id: 'actions',
                  header: '',
                  sortable: false,
                  render: (r) => (
                    <Button onClick={() => handleBulkRemoveItem(r._idx)} disabled={loading} size="sm" variant="danger">Remover</Button>
                  ),
                },
              ]}
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
      </div>
    );
  }

  return (
    <div className="support-page pbx-page">
      <div className="pbx-header support-header">
        <div className="pbx-title">
          {isSectionMode ? (
            <>
              <h1>📞 PBX • {sectionTitle}</h1>
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
              Atualizado em: {new Date(lastUpdatedAt).toLocaleString()}
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
                    return (
                  <div className="flex items-start justify-between mb-3">
                    <div className={`${palette} w-12 h-12 rounded-lg flex items-center justify-center text-2xl`}>
                      <PbxDashboardIcon name={getDashboardIconName(item, section.title.replace(/^Referência:\s*/, ''), itemIndex)} />
                    </div>
                    <span className="text-xs text-text-tertiary bg-bg-secondary px-2 py-1 rounded">
                      {section.title}
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

        {tab === 'extensions' ? (
          <>
            <div className="flex items-center justify-between gap-3 mb-6">
              <h3 className="text-xl font-semibold text-text-primary" style={{ marginTop: 0, marginBottom: 0 }}>Ramais</h3>
              <Button onClick={handleNewExtension} disabled={loading} variant="primary">➕ Incluir</Button>
            </div>
            {showExtensionEditModal ? (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <div className="bg-bg-elevated rounded-xl border border-border-default p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl">
                  <h4 className="text-2xl font-bold text-text-primary mb-6">
                    {isEditingExtension ? 'Editar Ramal' : 'Incluir Ramal'}
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                    <input className={AGENTS_FIELD_CLASS} placeholder="Ramal" value={formExt.extension} disabled={isEditingExtension} onChange={(e) => setFormExt((s) => ({ ...s, extension: e.target.value }))} />
                    <input className={AGENTS_FIELD_CLASS} placeholder="Nome" value={formExt.displayName} onChange={(e) => setFormExt((s) => ({ ...s, displayName: e.target.value }))} />
                    <input className={AGENTS_FIELD_CLASS} placeholder="Usuário" value={formExt.authUsername} onChange={(e) => setFormExt((s) => ({ ...s, authUsername: e.target.value }))} />
                    <input className={AGENTS_FIELD_CLASS} placeholder="Senha" value={formExt.authPassword} onChange={(e) => setFormExt((s) => ({ ...s, authPassword: e.target.value }))} />
                    <input className={AGENTS_FIELD_CLASS} placeholder="CallerID interno" value={formExt.calleridName} onChange={(e) => setFormExt((s) => ({ ...s, calleridName: e.target.value }))} />
                    <input className={AGENTS_FIELD_CLASS} placeholder="CallerID número" value={formExt.calleridNumber} onChange={(e) => setFormExt((s) => ({ ...s, calleridNumber: e.target.value }))} />
                    <input className={AGENTS_FIELD_CLASS} placeholder="CallerID externo" value={formExt.calleridExternal} onChange={(e) => setFormExt((s) => ({ ...s, calleridExternal: e.target.value }))} />
                    <input className={AGENTS_FIELD_CLASS} placeholder="Grupo(s) ex: 1,2" value={formExt.grupo} onChange={(e) => setFormExt((s) => ({ ...s, grupo: e.target.value }))} />
                    <select className={AGENTS_SELECT_CLASS} value={formExt.contexto} onChange={(e) => setFormExt((s) => ({ ...s, contexto: e.target.value }))}>
                      {LEGACY_CONTEXT_OPTIONS.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                    <select className={AGENTS_SELECT_CLASS} value={formExt.protocolo} onChange={(e) => setFormExt((s) => ({ ...s, protocolo: e.target.value }))}>
                      {LEGACY_PROTOCOL_OPTIONS.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                    <select className={AGENTS_SELECT_CLASS} value={formExt.tipo} onChange={(e) => setFormExt((s) => ({ ...s, tipo: e.target.value }))}>
                      {LEGACY_TIPO_OPTIONS.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                    <input className={AGENTS_FIELD_CLASS} placeholder="Senha D (tipo=Senha)" value={formExt.senhad} onChange={(e) => setFormExt((s) => ({ ...s, senhad: e.target.value }))} />
                    <input className={AGENTS_FIELD_CLASS} placeholder="Chamadas" type="number" value={formExt.chamadas} onChange={(e) => setFormExt((s) => ({ ...s, chamadas: e.target.value }))} />
                    <input className={AGENTS_FIELD_CLASS} placeholder="Tempo" type="number" value={formExt.tempo} onChange={(e) => setFormExt((s) => ({ ...s, tempo: e.target.value }))} />
                    <input className={AGENTS_FIELD_CLASS} placeholder="Bloqueio (CIDR)" value={formExt.bloqueio} onChange={(e) => setFormExt((s) => ({ ...s, bloqueio: e.target.value }))} />
                    <input className={AGENTS_FIELD_CLASS} placeholder="Permissão (CIDR)" value={formExt.permissao} onChange={(e) => setFormExt((s) => ({ ...s, permissao: e.target.value }))} />
                    <label className="flex items-center gap-2 md:col-span-2">
                      ACL
                      <select className={AGENTS_SELECT_CLASS} value={formExt.aclId} onChange={(e) => setFormExt((s) => ({ ...s, aclId: e.target.value }))} disabled={loading}>
                        <option value="">(nenhuma)</option>
                        {(acls || []).map((a) => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={!!formExt.gsm} onChange={(e) => setFormExt((s) => ({ ...s, gsm: e.target.checked }))} />
                      GSM
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={!!formExt.g729} onChange={(e) => setFormExt((s) => ({ ...s, g729: e.target.checked }))} />
                      G729
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={!!formExt.correio} onChange={(e) => setFormExt((s) => ({ ...s, correio: e.target.checked }))} />
                      Correio
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={!!formExt.webfone} onChange={(e) => setFormExt((s) => ({ ...s, webfone: e.target.checked }))} />
                      WebFone
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={!!formExt.gravar} onChange={(e) => setFormExt((s) => ({ ...s, gravar: e.target.checked }))} />
                      Gravar
                    </label>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={!!formExt.provisioningEnabled}
                        onChange={(e) => setFormExt((s) => ({ ...s, provisioningEnabled: e.target.checked }))}
                      />
                      Provisionamento
                    </label>
                    <select
                      className={AGENTS_SELECT_CLASS}
                      value={formExt.provisioningVendor}
                      disabled={!formExt.provisioningEnabled}
                      onChange={(e) => setFormExt((s) => ({ ...s, provisioningVendor: e.target.value }))}
                    >
                      <option value="grandstream">grandstream</option>
                      <option value="avaya">avaya</option>
                    </select>
                    <input
                      className={AGENTS_FIELD_CLASS}
                      placeholder="MAC (12 hex, ex: 001122AABBCC)"
                      value={formExt.provisioningMac}
                      disabled={!formExt.provisioningEnabled}
                      onChange={(e) => setFormExt((s) => ({ ...s, provisioningMac: e.target.value }))}
                    />
                    <input
                      className={AGENTS_FIELD_CLASS}
                      placeholder="Modelo (opcional)"
                      value={formExt.provisioningModel}
                      disabled={!formExt.provisioningEnabled}
                      onChange={(e) => setFormExt((s) => ({ ...s, provisioningModel: e.target.value }))}
                    />
                  </div>
                  <div className="flex gap-3 pt-2">
                    <Button onClick={handleSaveExtension} disabled={!canSaveExt || loading} variant="primary" className="flex-1">Salvar</Button>
                    <Button
                      onClick={() => {
                        setShowExtensionEditModal(false);
                        setIsEditingExtension(false);
                      }}
                      disabled={loading}
                      variant="ghost"
                      className="flex-1"
                    >
                      Cancelar
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
            <div style={{ marginBottom: 16, padding: 12, border: '1px dashed rgba(255,255,255,0.2)', borderRadius: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <strong>Token de Provisionamento</strong>
                <span style={{ opacity: 0.75 }}>{provisioningToken || '—'}</span>
                <span style={{ opacity: 0.85 }}>
                  status: {tokenGovernance.message}
                  {tokenGovernance.remainingLabel ? ` (${tokenGovernance.remainingLabel})` : ''}
                </span>
                {provisioningTokenExpiresAt ? (
                  <span style={{ opacity: 0.75 }}>expira: {new Date(provisioningTokenExpiresAt).toLocaleString()}</span>
                ) : null}
                {provisioningTokenUpdatedAt ? (
                  <span style={{ opacity: 0.7 }}>atualizado: {new Date(provisioningTokenUpdatedAt).toLocaleString()}</span>
                ) : null}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <input
                  className={AGENTS_FIELD_CLASS}
                  placeholder="expiresInSec (opcional)"
                  value={rotateExpiresInSec}
                  onChange={(e) => setRotateExpiresInSec(e.target.value)}
                  style={{ maxWidth: 220 }}
                />
                <Button onClick={handleRotateProvisioningToken} disabled={loading} size="sm">Rotacionar token</Button>
                <Button onClick={() => handleQuickRotate(24 * 60 * 60)} disabled={loading} size="sm" variant="ghost">Rotação 24h</Button>
                <Button onClick={() => handleQuickRotate(7 * 24 * 60 * 60)} disabled={loading} size="sm" variant="ghost">Rotação 7d</Button>
                <Button onClick={() => handleQuickRotate(30 * 24 * 60 * 60)} disabled={loading} size="sm" variant="ghost">Rotação 30d</Button>
                <Button onClick={() => handleQuickRotate(0)} disabled={loading} size="sm" variant="ghost">Sem expiração</Button>
                <Button onClick={handleRevokeProvisioningToken} disabled={loading} size="sm" variant="danger">Revogar token</Button>
                {rotatedToken ? (
                  <span style={{ opacity: 0.9 }}>Novo token: <code>{rotatedToken}</code></span>
                ) : null}
              </div>
              <div style={{ marginTop: 6, opacity: 0.7 }}>
                URL: <code>{buildApiUrl('/provision/<tenant>/<token>/<vendor>/<mac>')}</code>
              </div>
            </div>
            <div style={{ marginBottom: 16, padding: 12, border: '1px dashed rgba(255,255,255,0.2)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <strong>Provisionamento em Lote</strong>
                <p style={{ opacity: 0.75, marginTop: 4, marginBottom: 0 }}>
                  O provisionamento em lote foi movido para uma tela dedicada.
                </p>
              </div>
              <Button onClick={() => navigate('/pbx/provisioning-lote')} size="sm" variant="primary">Abrir tela de lote</Button>
            </div>
            <div className="bg-bg-elevated rounded-xl border border-border-default overflow-hidden shadow-lg mb-6">
              <DataGrid
                rows={filteredExtensions}
                emptyText="Nenhum ramal encontrado."
                defaultSort={{ id: 'extension', dir: 'asc' }}
                columns={[
                  { id: 'extension', header: 'Ramal', accessor: (r) => r.extension },
                  { id: 'displayName', header: 'Nome', accessor: (r) => r.displayName || '—' },
                  { id: 'authUsername', header: 'Usuário', accessor: (r) => r.authUsername || '—' },
                  { id: 'contexto', header: 'Categoria', accessor: (r) => r?.endpointOptions?.contexto || '—' },
                  { id: 'protocolo', header: 'Protocolo', accessor: (r) => r?.endpointOptions?.protocolo || '—' },
                  {
                    id: 'provisioning',
                    header: 'Provisionamento',
                    sortable: false,
                    render: (r) => (r?.endpointOptions?.provisioning?.enabled
                      ? `${r.endpointOptions.provisioning.vendor || '—'} / ${r.endpointOptions.provisioning.mac || '—'}`
                      : '—'),
                  },
                  { id: 'acl', header: 'ACL', sortable: false, render: (r) => getExtensionAclLabel(r) },
                  { id: 'status', header: 'Status', accessor: (r) => r.status || '—' },
                  {
                    id: 'actions',
                    header: '',
                    sortable: false,
                    render: (r) => (
                      <Button onClick={() => handleEditExtension(r)} disabled={loading} size="sm" variant="ghost">Editar</Button>
                    ),
                  },
                ]}
              />
            </div>
            <h4 style={{ marginTop: 16 }}>Métricas operacionais de fila</h4>
            <DataGrid
              rows={queueMetrics}
              emptyText="Sem métricas de filas."
              defaultSort={{ id: 'name', dir: 'asc' }}
              pageSizes={[10, 25, 50]}
              defaultPageSize={25}
              columns={[
                { id: 'name', header: 'Fila', accessor: (m) => m.name },
                { id: 'totalMembers', header: 'Membros', accessor: (m) => m.totalMembers ?? 0 },
                { id: 'activeMembers', header: 'Ativos', accessor: (m) => m.activeMembers ?? 0 },
                { id: 'pausedMembers', header: 'Pausados', accessor: (m) => m.pausedMembers ?? 0 },
              ]}
            />
          </>
        ) : null}

        {tab === 'acls' ? (
          <>
            <h3 style={{ marginTop: 0 }}>ACLs (permit/deny)</h3>
            <div style={{ opacity: 0.8, marginBottom: 10 }}>
              Cadastre listas de IP/rede para reutilizar nos ramais. O Asterisk referencia por ID (estável), então renomear não quebra os ramais.
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr 140px auto', gap: 8, marginBottom: 10 }}>
              <input
                placeholder="Nome (ex: Telefones VLAN)"
                value={formAcl.name}
                onChange={(e) => setFormAcl((s) => ({ ...s, name: e.target.value }))}
                disabled={loading}
              />
              <input
                placeholder="Descrição (opcional)"
                value={formAcl.description}
                onChange={(e) => setFormAcl((s) => ({ ...s, description: e.target.value }))}
                disabled={loading}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={formAcl.enabled !== false}
                  onChange={(e) => setFormAcl((s) => ({ ...s, enabled: e.target.checked }))}
                  disabled={loading}
                />
                ativo
              </label>
              <button onClick={handleSaveAcl} disabled={!canSaveAcl || loading} style={{ padding: '8px 12px' }}>
                Salvar
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
              <textarea
                rows={6}
                placeholder={'deny (um por linha, ex):\n0.0.0.0/0'}
                value={formAcl.deny}
                onChange={(e) => setFormAcl((s) => ({ ...s, deny: e.target.value }))}
                disabled={loading}
                style={{ width: '100%' }}
              />
              <textarea
                rows={6}
                placeholder={'permit (um por linha, ex):\n10.10.2.0/24'}
                value={formAcl.permit}
                onChange={(e) => setFormAcl((s) => ({ ...s, permit: e.target.value }))}
                disabled={loading}
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <button
                onClick={() => setFormAcl({ id: '', name: '', description: '', enabled: true, deny: '', permit: '' })}
                disabled={loading}
                style={{ padding: '6px 10px' }}
              >
                Limpar formulário
              </button>
              <button onClick={refreshCore} disabled={loading} style={{ padding: '6px 10px' }}>
                Atualizar lista
              </button>
            </div>

            <DataGrid
              rows={filteredAcls}
              emptyText="Nenhuma ACL cadastrada."
              defaultSort={{ id: 'name', dir: 'asc' }}
              columns={[
                {
                  id: 'name',
                  header: 'Nome',
                  sortValue: (a) => a.name,
                  render: (a) => (
                    <div>
                      <div style={{ fontWeight: 600 }}>{a.name}</div>
                      <div style={{ opacity: 0.75, fontSize: 12 }}>{a.description || `id: ${a.id}`}</div>
                    </div>
                  ),
                },
                {
                  id: 'enabled',
                  header: 'Ativo',
                  accessor: (a) => (a.enabled === false ? 'não' : 'sim'),
                  sortValue: (a) => (a.enabled === false ? 0 : 1),
                },
                {
                  id: 'permit',
                  header: 'Permit',
                  render: (a) => <code>{String(a.permit || '').slice(0, 200) || '—'}</code>,
                },
                {
                  id: 'deny',
                  header: 'Deny',
                  render: (a) => <code>{String(a.deny || '').slice(0, 200) || '—'}</code>,
                },
                {
                  id: 'actions',
                  header: '',
                  sortable: false,
                  render: (a) => (
                    <>
                      <button onClick={() => handleEditAcl(a)} disabled={loading} style={{ padding: '6px 10px', marginRight: 8 }}>
                        Editar
                      </button>
                      <button onClick={() => handleDeleteAcl(a.id)} disabled={loading} style={{ padding: '6px 10px' }}>
                        Remover
                      </button>
                    </>
                  ),
                },
              ]}
            />
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

		        {tab === 'queues' ? (
		          <>
		            <h3 style={{ marginTop: 0 }}>Filas</h3>
		            <div className="bg-bg-elevated rounded-xl border border-border-default p-4 mb-4 shadow-lg">
		              <div style={{ display: 'grid', gridTemplateColumns: '140px 220px 160px 110px 110px 110px 110px auto', gap: 8, marginBottom: 8 }}>
		                <input className={AGENTS_FIELD_CLASS} placeholder="Ramal da fila" value={formQueue.queueNumber} onChange={(e) => setFormQueue((s) => ({ ...s, queueNumber: e.target.value }))} />
		                <input className={AGENTS_FIELD_CLASS} placeholder="Nome interno (fallback)" value={formQueue.name} onChange={(e) => setFormQueue((s) => ({ ...s, name: e.target.value }))} />
		                <input className={AGENTS_FIELD_CLASS} placeholder="Nome da fila" value={formQueue.displayName} onChange={(e) => setFormQueue((s) => ({ ...s, displayName: e.target.value }))} />
		                <select className={AGENTS_SELECT_CLASS} value={formQueue.strategy} onChange={(e) => setFormQueue((s) => ({ ...s, strategy: e.target.value }))}>
		                  {QUEUE_STRATEGY_OPTIONS.map(([value, label]) => (
		                    <option key={value} value={value}>{label}</option>
		                  ))}
		                </select>
		                <input className={AGENTS_FIELD_CLASS} placeholder="timeout" type="number" value={formQueue.timeout} onChange={(e) => setFormQueue((s) => ({ ...s, timeout: e.target.value }))} />
		                <input className={AGENTS_FIELD_CLASS} placeholder="retry" type="number" value={formQueue.retry} onChange={(e) => setFormQueue((s) => ({ ...s, retry: e.target.value }))} />
		                <input className={AGENTS_FIELD_CLASS} placeholder="wrapuptime" type="number" value={formQueue.wrapuptime} onChange={(e) => setFormQueue((s) => ({ ...s, wrapuptime: e.target.value }))} />
		                <Button onClick={handleSaveQueue} disabled={!canSaveQueue || loading} variant="primary">Salvar</Button>
		              </div>
		              <div style={{ display: 'grid', gridTemplateColumns: '110px 110px 120px 120px 120px 120px 120px 1fr 110px auto', gap: 8, marginBottom: 12 }}>
		                <input className={AGENTS_FIELD_CLASS} placeholder="maxlen" type="number" value={formQueue.maxlen} onChange={(e) => setFormQueue((s) => ({ ...s, maxlen: e.target.value }))} />
		                <input className={AGENTS_FIELD_CLASS} placeholder="Inclui" value={formQueue.inclui} onChange={(e) => setFormQueue((s) => ({ ...s, inclui: e.target.value }))} />
		                <input className={AGENTS_FIELD_CLASS} placeholder="Exclui" value={formQueue.exclui} onChange={(e) => setFormQueue((s) => ({ ...s, exclui: e.target.value }))} />
		                <input className={AGENTS_FIELD_CLASS} placeholder="Parar" value={formQueue.parar} onChange={(e) => setFormQueue((s) => ({ ...s, parar: e.target.value }))} />
		                <input className={AGENTS_FIELD_CLASS} placeholder="Retornar" value={formQueue.retornar} onChange={(e) => setFormQueue((s) => ({ ...s, retornar: e.target.value }))} />
		                <input className={AGENTS_FIELD_CLASS} placeholder="Transferir" value={formQueue.transferir} onChange={(e) => setFormQueue((s) => ({ ...s, transferir: e.target.value }))} />
		                <input className={AGENTS_FIELD_CLASS} placeholder="URL de atendimento" value={formQueue.url} onChange={(e) => setFormQueue((s) => ({ ...s, url: e.target.value }))} />
		                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
		                  <input type="checkbox" checked={!!formQueue.tocar} onChange={(e) => setFormQueue((s) => ({ ...s, tocar: e.target.checked }))} />
		                  Tocar
		                </label>
		                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
		                  <input type="checkbox" checked={!!formQueue.anunciar} onChange={(e) => setFormQueue((s) => ({ ...s, anunciar: e.target.checked }))} />
		                  Anunciar
		                </label>
		                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
		                  <input type="checkbox" checked={!!formQueue.autoatendimento} onChange={(e) => setFormQueue((s) => ({ ...s, autoatendimento: e.target.checked }))} />
		                  Auto Atend.
		                </label>
		              </div>
		            </div>
            <div style={{ overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Ramal</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Nome</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Display</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Strategy</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredQueues.map((q) => (
                    <tr key={q.id}>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{q?.options?.queueNumber || '—'}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{q.name}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{q.displayName || '—'}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{q.strategy || '—'}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        <Button onClick={() => handleEditQueue(q)} disabled={loading} size="sm" variant="ghost">Editar</Button>
                      </td>
                    </tr>
                  ))}
                  {!filteredQueues.length ? <tr><td colSpan={5} style={{ padding: 8, opacity: 0.75 }}>Nenhuma fila encontrada.</td></tr> : null}
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
                {filteredQueues.map((q) => (
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
                  {filteredQueueMembers.map((m) => (
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
                  {!filteredQueueMembers.length ? <tr><td colSpan={5} style={{ padding: 8, opacity: 0.75 }}>Nenhum membro encontrado.</td></tr> : null}
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
            <h4 style={{ marginTop: 16 }}>Histórico de versões</h4>
            <div style={{ overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Versão</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Status</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Assinatura</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Data</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }} />
                  </tr>
                </thead>
                <tbody>
                  {configVersions.map((v) => (
                    <tr key={v.id}>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{v.version}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{v.status || '—'}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{v?.summary?.dialplan?.signature || '—'}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        {v.createdAt ? new Date(v.createdAt).toLocaleString() : '—'}
                      </td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        <button
                          onClick={() => handleRollbackVersion(v.version)}
                          disabled={loading || !Array.isArray(v?.summary?.dialplan?.rows) || v.summary.dialplan.rows.length === 0}
                          style={{ padding: '6px 10px' }}
                        >
                          Rollback
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!configVersions.length ? <tr><td colSpan={5} style={{ padding: 8, opacity: 0.75 }}>Sem versões registradas.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {tab === 'media' ? (
          <>
            <h3 style={{ marginTop: 0 }}>Mídia (áudios)</h3>
            {audioAssetsError ? (
              <div style={{ marginBottom: 12, padding: 12, border: '1px solid rgba(255,180,0,0.35)', borderRadius: 10, background: 'rgba(255,180,0,0.08)' }}>
                <strong>Não foi possível carregar os áudios.</strong>
                <div style={{ marginTop: 6, opacity: 0.85 }}><code>{audioAssetsError}</code></div>
              </div>
            ) : null}
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
                  {filteredAudioAssets.map((a) => (
                    <tr key={a.id}>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{a.name}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        <a href={buildApiUrl(`/api/pbx/audio-assets/file?id=${encodeURIComponent(a.id)}`)}>baixar</a>
                      </td>
                    </tr>
                  ))}
                  {!filteredAudioAssets.length ? <tr><td colSpan={2} style={{ padding: 8, opacity: 0.75 }}>Nenhum áudio encontrado.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {tab === 'recordings' ? (
          <>
            <h3 style={{ marginTop: 0 }}>Gravações</h3>
            {recordingsError || recordingPolicyError ? (
              <div style={{ marginBottom: 12, padding: 12, border: '1px solid rgba(255,180,0,0.35)', borderRadius: 10, background: 'rgba(255,180,0,0.08)' }}>
                <strong>Gravações indisponíveis neste ambiente.</strong>
                <div style={{ marginTop: 6, opacity: 0.85 }}>
                  {recordingPolicyError ? <div>Política: <code>{recordingPolicyError}</code></div> : null}
                  {recordingsError ? <div>Lista: <code>{recordingsError}</code></div> : null}
                </div>
                <div style={{ marginTop: 8, opacity: 0.8 }}>
                  Dica: confirme migrations e o acesso ao banco. Em produção, isso deve estar ok.
                </div>
              </div>
            ) : null}
            <div style={{ marginBottom: 12, padding: 12, border: '1px dashed rgba(255,255,255,0.2)', borderRadius: 8 }}>
              <strong>Política de gravação (tenant)</strong>
              <div style={{ display: 'grid', gridTemplateColumns: '220px 220px 220px 220px auto', gap: 8, marginTop: 8, alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={!!recordingPolicy.enabled}
                    onChange={(e) => setRecordingPolicy((s) => ({ ...s, enabled: e.target.checked }))}
                  />
                  Gravação habilitada
                </label>
                <input
                  placeholder="Retenção (dias)"
                  value={recordingPolicy.retentionDays}
                  onChange={(e) => setRecordingPolicy((s) => ({ ...s, retentionDays: e.target.value }))}
                />
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={!!recordingPolicy.maskPhoneNumbers}
                    onChange={(e) => setRecordingPolicy((s) => ({ ...s, maskPhoneNumbers: e.target.checked }))}
                  />
                  Mascarar números
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={!!recordingPolicy.requireConsent}
                    onChange={(e) => setRecordingPolicy((s) => ({ ...s, requireConsent: e.target.checked }))}
                  />
                  Exigir consentimento
                </label>
                <button onClick={handleSaveRecordingPolicy} disabled={loading} style={{ padding: '8px 12px' }}>Salvar política</button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <button onClick={handleRecordingsRefresh} disabled={loading} style={{ padding: '8px 12px' }}>Atualizar</button>
              <button onClick={handleRecordingsScan} disabled={loading} style={{ padding: '8px 12px' }}>Scan volume</button>
            </div>
            <div style={{ overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Uniqueid</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Origem</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Destino</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Download</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecordings.map((r) => (
                    <tr key={r.id}>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{r.uniqueid || '—'}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{r.src || '—'}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{r.dst || '—'}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        <a href={buildApiUrl(`/api/pbx/recordings/file?id=${encodeURIComponent(r.id)}`)}>baixar</a>
                      </td>
                    </tr>
                  ))}
                  {!filteredRecordings.length ? <tr><td colSpan={4} style={{ padding: 8, opacity: 0.75 }}>Nenhuma gravação encontrada.</td></tr> : null}
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
                  {filteredCdrItems.map((c) => (
                    <tr key={c.id}>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{c.calldate ? new Date(c.calldate).toISOString() : '—'}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{c.src || '—'}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{c.dst || '—'}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{c.disposition || '—'}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{c.duration ?? '—'}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{c.uniqueid}</td>
                    </tr>
                  ))}
                  {!filteredCdrItems.length ? <tr><td colSpan={6} style={{ padding: 8, opacity: 0.75 }}>Nenhum CDR encontrado (ainda).</td></tr> : null}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {tab === 'ccPauseReasons' ? (
          <>
            <h3 style={{ marginTop: 0 }}>Contact Center: Motivos de pausa</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr 140px auto', gap: 8, marginBottom: 12 }}>
              <input
                placeholder="code (ex: ALMOCO)"
                value={formPauseReason.code}
                onChange={(e) => setFormPauseReason((s) => ({ ...s, code: e.target.value }))}
              />
              <input
                placeholder="descricao"
                value={formPauseReason.description}
                onChange={(e) => setFormPauseReason((s) => ({ ...s, description: e.target.value }))}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={!!formPauseReason.active}
                  onChange={(e) => setFormPauseReason((s) => ({ ...s, active: e.target.checked }))}
                />
                ativo
              </label>
              <button onClick={handleSavePauseReason} disabled={!canSavePauseReason || loading} style={{ padding: '8px 12px' }}>
                Salvar
              </button>
            </div>
            <div style={{ overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Code</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Descricao</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Ativo</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPauseReasons.map((r) => (
                    <tr key={r.id}>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{r.code}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{r.description}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{String(!!r.active)}</td>
                    </tr>
                  ))}
                  {!filteredPauseReasons.length ? (
                    <tr><td colSpan={3} style={{ padding: 8, opacity: 0.75 }}>Nenhum motivo.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {tab === 'ccContactReasons' ? (
          <>
            <h3 style={{ marginTop: 0 }}>Contact Center: Motivos de contato</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr 140px auto', gap: 8, marginBottom: 12 }}>
              <input
                placeholder="code (ex: INFO)"
                value={formContactReason.code}
                onChange={(e) => setFormContactReason((s) => ({ ...s, code: e.target.value }))}
              />
              <input
                placeholder="descricao"
                value={formContactReason.description}
                onChange={(e) => setFormContactReason((s) => ({ ...s, description: e.target.value }))}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={!!formContactReason.active}
                  onChange={(e) => setFormContactReason((s) => ({ ...s, active: e.target.checked }))}
                />
                ativo
              </label>
              <button onClick={handleSaveContactReason} disabled={!canSaveContactReason || loading} style={{ padding: '8px 12px' }}>
                Salvar
              </button>
            </div>
            <div style={{ overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Code</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Descricao</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Ativo</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredContactReasons.map((r) => (
                    <tr key={r.id}>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{r.code}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{r.description}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{String(!!r.active)}</td>
                    </tr>
                  ))}
                  {!filteredContactReasons.length ? (
                    <tr><td colSpan={3} style={{ padding: 8, opacity: 0.75 }}>Nenhum motivo.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {tab === 'ccCampaigns' ? (
          <>
            <h3 style={{ marginTop: 0 }}>Contact Center: Campanhas</h3>
	            <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 160px 220px 220px 160px 160px auto', gap: 8, marginBottom: 12 }}>
              <input
                placeholder="id (opcional)"
                value={formCampaign.id}
                onChange={(e) => setFormCampaign((s) => ({ ...s, id: e.target.value }))}
              />
              <input
                placeholder="nome"
                value={formCampaign.name}
                onChange={(e) => setFormCampaign((s) => ({ ...s, name: e.target.value }))}
              />
              <input
                placeholder="status"
                value={formCampaign.status}
                onChange={(e) => setFormCampaign((s) => ({ ...s, status: e.target.value }))}
              />
              <input
                type="datetime-local"
                value={formCampaign.startAt}
                onChange={(e) => setFormCampaign((s) => ({ ...s, startAt: e.target.value }))}
                title="inicio (opcional)"
              />
              <input
                type="datetime-local"
                value={formCampaign.endAt}
                onChange={(e) => setFormCampaign((s) => ({ ...s, endAt: e.target.value }))}
                title="fim (opcional)"
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={!!formCampaign.click2callEnabled}
                  onChange={(e) => setFormCampaign((s) => ({ ...s, click2callEnabled: e.target.checked }))}
                />
                click2call
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={!!formCampaign.recordEnabled}
                  onChange={(e) => setFormCampaign((s) => ({ ...s, recordEnabled: e.target.checked }))}
                />
                gravar
              </label>
	              <button onClick={handleSaveCampaign} disabled={!canSaveCampaign || loading} style={{ padding: '8px 12px' }}>
	                Salvar
	              </button>
	            </div>
	            <div style={{ marginBottom: 10, opacity: 0.8 }}>
	              Configurações avançadas ocultas (sem JSON).
	            </div>
            <div style={{ overflow: 'auto', marginTop: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>ID</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Nome</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Status</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Click2Call</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Gravar</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }} />
                  </tr>
                </thead>
                <tbody>
                  {filteredCampaigns.map((c) => (
                    <tr key={c.id}>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{c.id}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{c.name}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{c.status}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{String(!!c.click2callEnabled)}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{String(!!c.recordEnabled)}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        <button
                          onClick={() => setCcSelectedCampaignId(String(c.id))}
                          disabled={loading}
                          style={{ padding: '6px 10px' }}
                        >
                          Abrir lista
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!filteredCampaigns.length ? <tr><td colSpan={6} style={{ padding: 8, opacity: 0.75 }}>Nenhuma campanha.</td></tr> : null}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 10, opacity: 0.8 }}>
              Lista selecionada: <code>{ccSelectedCampaignId || '—'}</code>
            </div>
          </>
        ) : null}

        {tab === 'ccCampaignList' ? (
          <>
            <h3 style={{ marginTop: 0 }}>Contact Center: Lista da campanha</h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
              <select value={ccSelectedCampaignId} onChange={(e) => setCcSelectedCampaignId(e.target.value)}>
                <option value="">Selecione uma campanha…</option>
                {filteredCampaigns.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <button onClick={() => refreshCampaignList(ccSelectedCampaignId)} disabled={loading || !ccSelectedCampaignId} style={{ padding: '8px 12px' }}>
                Atualizar lista
              </button>
	            </div>
	            <div style={{ marginBottom: 10, opacity: 0.8 }}>
	              Adicionar itens (sem JSON):
	            </div>
	            <div style={{ display: 'grid', gridTemplateColumns: '120px 240px 1fr auto', gap: 8 }}>
	              <input
	                placeholder="DDD (opcional)"
	                value={campaignListDraftRow.ddd}
	                onChange={(e) => setCampaignListDraftRow((s) => ({ ...s, ddd: e.target.value }))}
	              />
	              <input
	                placeholder="Telefone"
	                value={campaignListDraftRow.phone}
	                onChange={(e) => setCampaignListDraftRow((s) => ({ ...s, phone: e.target.value }))}
	              />
	              <input
	                placeholder="Chave/Identificador (opcional)"
	                value={campaignListDraftRow.key}
	                onChange={(e) => setCampaignListDraftRow((s) => ({ ...s, key: e.target.value }))}
	              />
	              <button onClick={handleCampaignListDraftAdd} disabled={loading || !ccSelectedCampaignId} style={{ padding: '8px 12px' }}>
	                Adicionar
	              </button>
	            </div>
	            <div style={{ marginTop: 10 }}>
	              <DataGrid
	                rows={campaignListDraftItems.map((it, idx) => ({ ...it, _idx: idx }))}
	                emptyText="Nenhum item pendente."
	                defaultSort={{ id: 'phone', dir: 'asc' }}
	                columns={[
	                  { id: 'phone', header: 'Telefone', accessor: (r) => r.phone },
	                  { id: 'ddd', header: 'DDD', accessor: (r) => r.ddd || '—' },
	                  { id: 'key', header: 'Chave', accessor: (r) => r.key || '—' },
	                  {
	                    id: 'actions',
	                    header: '',
	                    sortable: false,
	                    render: (r) => (
	                      <button onClick={() => handleCampaignListDraftRemove(r._idx)} disabled={loading} style={{ padding: '6px 10px' }}>
	                        Remover
	                      </button>
	                    ),
	                  },
	                ]}
	              />
	            </div>
	            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
	              <button onClick={handleAddCampaignListItems} disabled={loading || !ccSelectedCampaignId || campaignListDraftItems.length === 0} style={{ padding: '8px 12px' }}>
	                Adicionar na campanha
	              </button>
	              <button onClick={() => setCampaignListDraftItems([])} disabled={loading || campaignListDraftItems.length === 0} style={{ padding: '8px 12px' }}>
	                Limpar lista
	              </button>
	            </div>
            <div style={{ overflow: 'auto', marginTop: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Phone</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>DDD</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Key</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Status</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Attempts</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCampaignList.map((it) => (
                    <tr key={it.id}>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{it.phone}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{it.ddd || '—'}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{it.key || '—'}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{it.status || '—'}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{it.attempts ?? 0}</td>
                    </tr>
                  ))}
                  {!filteredCampaignList.length ? <tr><td colSpan={5} style={{ padding: 8, opacity: 0.75 }}>Sem itens.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {tab === 'ccScheduled' ? (
          <>
            <h3 style={{ marginTop: 0 }}>Contact Center: Callbacks agendados</h3>
	            <div style={{ display: 'grid', gridTemplateColumns: '160px 220px 120px 1fr 140px 1fr auto', gap: 8, marginBottom: 12 }}>
              <input
                placeholder="id (opcional)"
                value={formScheduled.id}
                onChange={(e) => setFormScheduled((s) => ({ ...s, id: e.target.value }))}
              />
              <input
                type="datetime-local"
                value={formScheduled.scheduledAt}
                onChange={(e) => setFormScheduled((s) => ({ ...s, scheduledAt: e.target.value }))}
              />
              <input
                placeholder="DDD"
                value={formScheduled.ddd}
                onChange={(e) => setFormScheduled((s) => ({ ...s, ddd: e.target.value }))}
              />
              <input
                placeholder="phone (ex: 5511999999999)"
                value={formScheduled.phone}
                onChange={(e) => setFormScheduled((s) => ({ ...s, phone: e.target.value }))}
              />
              <input
                placeholder="status"
                value={formScheduled.status}
                onChange={(e) => setFormScheduled((s) => ({ ...s, status: e.target.value }))}
              />
              <input
                placeholder="descricao"
                value={formScheduled.description}
                onChange={(e) => setFormScheduled((s) => ({ ...s, description: e.target.value }))}
              />
	              <button onClick={handleSaveScheduledCallback} disabled={!canSaveScheduled || loading} style={{ padding: '8px 12px' }}>
	                Salvar
	              </button>
	            </div>
	            <div style={{ marginBottom: 10, opacity: 0.8 }}>
	              Configurações avançadas ocultas (sem JSON).
	            </div>
            <div style={{ overflow: 'auto', marginTop: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Quando</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Phone</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Status</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Descricao</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredScheduled.map((it) => (
                    <tr key={it.id}>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        {it.scheduledAt ? new Date(it.scheduledAt).toLocaleString() : '—'}
                      </td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        {it.ddd ? `${it.ddd} ` : ''}{it.phone}
                      </td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{it.status || '—'}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{it.description || '—'}</td>
                    </tr>
                  ))}
                  {!filteredScheduled.length ? <tr><td colSpan={4} style={{ padding: 8, opacity: 0.75 }}>Nenhum agendado.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {tab === 'ccClick2Call' ? (
          <>
            <h3 style={{ marginTop: 0 }}>Contact Center: Click2Call</h3>
	            <div style={{ display: 'grid', gridTemplateColumns: '220px 220px 120px 1fr auto', gap: 8, marginBottom: 12 }}>
              <select value={formClick2Call.campaignId} onChange={(e) => setFormClick2Call((s) => ({ ...s, campaignId: e.target.value }))}>
                <option value="">(sem campanha)</option>
                {filteredCampaigns.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <input
                placeholder="target (ramal/fila)"
                value={formClick2Call.target}
                onChange={(e) => setFormClick2Call((s) => ({ ...s, target: e.target.value }))}
              />
              <input
                placeholder="DDD"
                value={formClick2Call.ddd}
                onChange={(e) => setFormClick2Call((s) => ({ ...s, ddd: e.target.value }))}
              />
              <input
                placeholder="phone (ex: 5511999999999)"
                value={formClick2Call.phone}
                onChange={(e) => setFormClick2Call((s) => ({ ...s, phone: e.target.value }))}
              />
	              <button onClick={handleCreateClick2Call} disabled={!canCreateClick2Call || loading} style={{ padding: '8px 12px' }}>
	                Criar
	              </button>
	            </div>
	            <div style={{ marginTop: 8, marginBottom: 10, opacity: 0.8 }}>
	              Originação (opcional):
	            </div>
	            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 120px 160px', gap: 8 }}>
	              <input
	                placeholder="channel (opcional)"
	                value={formClick2Call.channel}
	                onChange={(e) => setFormClick2Call((s) => ({ ...s, channel: e.target.value }))}
	              />
	              <input
	                placeholder="context (opcional)"
	                value={formClick2Call.context}
	                onChange={(e) => setFormClick2Call((s) => ({ ...s, context: e.target.value }))}
	              />
	              <input
	                placeholder="exten (opcional)"
	                value={formClick2Call.exten}
	                onChange={(e) => setFormClick2Call((s) => ({ ...s, exten: e.target.value }))}
	              />
	              <input
	                placeholder="priority"
	                type="number"
	                value={formClick2Call.priority}
	                onChange={(e) => setFormClick2Call((s) => ({ ...s, priority: e.target.value }))}
	              />
	              <input
	                placeholder="timeout (ms)"
	                type="number"
	                value={formClick2Call.timeoutMs}
	                onChange={(e) => setFormClick2Call((s) => ({ ...s, timeoutMs: e.target.value }))}
	              />
	            </div>
	            <div style={{ marginTop: 10, opacity: 0.8 }}>Variáveis (opcional):</div>
	            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, marginTop: 8 }}>
	              {(click2CallVars || []).map((row, idx) => (
	                <React.Fragment key={idx}>
	                  <input
	                    placeholder="nome"
	                    value={row.key}
	                    onChange={(e) => setClick2CallVars((prev) => prev.map((r, i) => (i === idx ? { ...r, key: e.target.value } : r)))}
	                  />
	                  <input
	                    placeholder="valor"
	                    value={row.value}
	                    onChange={(e) => setClick2CallVars((prev) => prev.map((r, i) => (i === idx ? { ...r, value: e.target.value } : r)))}
	                  />
	                  <button onClick={() => handleClick2CallVarRemove(idx)} disabled={loading} style={{ padding: '6px 10px' }}>
	                    Remover
	                  </button>
	                </React.Fragment>
	              ))}
	            </div>
	            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
	              <button onClick={handleClick2CallVarAdd} disabled={loading} style={{ padding: '6px 10px' }}>
	                Adicionar variável
	              </button>
	            </div>
            <div style={{ overflow: 'auto', marginTop: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Quando</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Target</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Phone</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Status</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Campanha</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredC2c.map((it) => (
                    <tr key={it.id}>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        {it.createdAt ? new Date(it.createdAt).toLocaleString() : '—'}
                      </td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{it.target}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{it.ddd ? `${it.ddd} ` : ''}{it.phone}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{it.status}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{it.campaignId || '—'}</td>
                    </tr>
                  ))}
                  {!filteredC2c.length ? <tr><td colSpan={5} style={{ padding: 8, opacity: 0.75 }}>Nenhuma solicitacao.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

	        {tab === 'legacyXml' ? (
	          <>
	            <h3 style={{ marginTop: 0 }}>Legado: cadastros XML</h3>
	            <div style={{ opacity: 0.8, marginBottom: 10 }}>
	              Tela para manter compatibilidade com cadastros do RIPABX.
	            </div>
            {legacyXmlError ? (
              <div style={{ marginBottom: 12, padding: 12, border: '1px solid rgba(255,180,0,0.35)', borderRadius: 10, background: 'rgba(255,180,0,0.08)' }}>
                <strong>Legado (XML) indisponível.</strong>
                <div style={{ marginTop: 6, opacity: 0.85 }}>{legacyXmlError}</div>
              </div>
            ) : null}

	            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                entidade:
                <select value={legacyXmlEntity} onChange={(e) => setLegacyXmlEntity(e.target.value)} disabled={loading}>
                  {(legacyXmlSupported.length ? legacyXmlSupported : [
                    'ddr', 'grupo', 'desvio', 'transbordo', 'bloqueio', 'retorno', 'recusa', 'feriado', 'transferencia',
                    'operadora', 'rota_base', 'rota', 'tipo', 'categoria', 'fax', 'sala', 'interconexao', 'fila', 'motivo', 'motivo1',
                  ]).map((k) => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
              </label>
	              <button onClick={() => refreshLegacyXml()} disabled={loading} style={{ padding: '8px 12px' }}>
	                Atualizar
	              </button>
	              <span style={{ opacity: 0.8 }}>
	                arquivo: {legacyXmlMeta.file || '—'} | item: {legacyXmlMeta.itemTag || '—'}
	              </span>
	            </div>
	
	            <div style={{ marginBottom: 12 }}>
	              <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr auto', gap: 8, alignItems: 'center' }}>
	                <input
	                  placeholder="ID do item"
	                  value={legacyXmlDraftId}
	                  onChange={(e) => setLegacyXmlDraftId(e.target.value)}
	                  disabled={loading}
	                />
	                <div style={{ opacity: 0.8 }}>Campos do item:</div>
	                <button onClick={handleLegacyXmlUpsert} disabled={loading} style={{ padding: '8px 12px' }}>
	                  Salvar
	                </button>
	              </div>
	              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, marginTop: 8 }}>
	                {(legacyXmlDraftFields || []).map((row, idx) => (
	                  <React.Fragment key={idx}>
	                    <input
	                      placeholder="campo"
	                      value={row.key}
	                      onChange={(e) => setLegacyXmlDraftFields((prev) => prev.map((r, i) => (i === idx ? { ...r, key: e.target.value } : r)))}
	                      disabled={loading}
	                    />
	                    <input
	                      placeholder="valor"
	                      value={row.value}
	                      onChange={(e) => setLegacyXmlDraftFields((prev) => prev.map((r, i) => (i === idx ? { ...r, value: e.target.value } : r)))}
	                      disabled={loading}
	                    />
	                    <button onClick={() => handleLegacyXmlRemoveField(idx)} disabled={loading} style={{ padding: '6px 10px' }}>
	                      Remover
	                    </button>
	                  </React.Fragment>
	                ))}
	              </div>
	              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
	                <button onClick={handleLegacyXmlAddField} disabled={loading} style={{ padding: '6px 10px' }}>
	                  Adicionar campo
	                </button>
	              </div>
	            </div>

            <div style={{ marginTop: 12, opacity: 0.85 }}>
              Itens: <strong>{legacyXmlItems.length}</strong>
            </div>
	            <div style={{ overflow: 'auto', marginTop: 8 }}>
	              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
	                <thead>
	                  <tr>
	                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>ID</th>
	                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Resumo</th>
	                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }} />
	                  </tr>
	                </thead>
	                <tbody>
	                  {filteredLegacyXmlItems.map((it) => (
	                    <tr key={it.id}>
	                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
	                        {it.id}
	                      </td>
	                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
	                        <span style={{ opacity: 0.9 }}>
	                          {(Object.keys(it || {})
	                            .filter((k) => k !== 'id' && k !== '_attrs')
	                            .slice(0, 6)
	                            .map((k) => `${k}=${String(it[k]).slice(0, 40)}`)
	                            .join(' | ')) || '—'}
	                        </span>
	                      </td>
	                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
	                        <button
	                          onClick={() => handleLegacyXmlEdit(it)}
	                          disabled={loading}
	                          style={{ padding: '6px 10px', marginRight: 8 }}
	                        >
	                          Editar
	                        </button>
                        <button
                          onClick={() => handleLegacyXmlDelete(it.id)}
                          disabled={loading}
                          style={{ padding: '6px 10px' }}
                        >
                          Remover
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!filteredLegacyXmlItems.length ? (
                    <tr><td colSpan={3} style={{ padding: 8, opacity: 0.75 }}>Sem itens (ou entidade vazia).</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {tab === 'governance' ? (
          <>
            <h3 style={{ marginTop: 0 }}>Governança PBX</h3>
            <div style={{ marginBottom: 12, padding: 12, border: '1px dashed rgba(255,255,255,0.2)', borderRadius: 8 }}>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <div><strong>Token:</strong> {provisioningToken || '—'}</div>
                <div><strong>Status:</strong> {tokenGovernance.message}{tokenGovernance.remainingLabel ? ` (${tokenGovernance.remainingLabel})` : ''}</div>
                <div><strong>Expira em:</strong> {provisioningTokenExpiresAt ? new Date(provisioningTokenExpiresAt).toLocaleString() : 'sem expiração'}</div>
                <div><strong>Atualizado em:</strong> {provisioningTokenUpdatedAt ? new Date(provisioningTokenUpdatedAt).toLocaleString() : '—'}</div>
              </div>
            </div>

            <h4 style={{ marginTop: 0 }}>Auditoria PBX (ações `pbx.*`)</h4>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8, alignItems: 'center' }}>
              <input
                placeholder="janela em horas"
                value={pbxAuditHours}
                onChange={(e) => setPbxAuditHours(e.target.value)}
                style={{ maxWidth: 180 }}
              />
              <button onClick={refreshPbxAudit} disabled={loading} style={{ padding: '8px 12px' }}>
                Atualizar auditoria
              </button>
            </div>
            <div style={{ marginBottom: 12, opacity: 0.8 }}>
              {Object.entries(pbxAuditByAction).slice(0, 6).map(([action, count]) => (
                <span key={action} style={{ marginRight: 14 }}>{action}: <strong>{count}</strong></span>
              ))}
              {!Object.keys(pbxAuditByAction).length ? 'Sem eventos na janela selecionada.' : null}
            </div>
            <div style={{ overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Timestamp</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Ação</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Usuário</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Recurso</th>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Detalhes</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAuditItems.map((item, idx) => (
                    <tr key={`${item.timestamp || 't'}-${item.action || 'a'}-${idx}`}>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        {item.timestamp ? new Date(item.timestamp).toLocaleString() : '—'}
                      </td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{item.action || '—'}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{item.username || item.agentId || '—'}</td>
	                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{item.resource || '—'}</td>
	                      <td style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
	                        <span style={{ opacity: 0.9 }}>
	                          {(item.details && typeof item.details === 'object'
	                            ? Object.entries(item.details).slice(0, 6).map(([k, v]) => `${k}=${String(v).slice(0, 40)}`).join(' | ')
	                            : '') || '—'}
	                        </span>
	                      </td>
                    </tr>
                  ))}
                  {!filteredAuditItems.length ? (
                    <tr><td colSpan={5} style={{ padding: 8, opacity: 0.75 }}>Nenhum evento PBX encontrado.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
