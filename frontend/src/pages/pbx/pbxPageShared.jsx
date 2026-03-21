import React from 'react';

export const LEGACY_CONTEXT_OPTIONS = [
  ['senha', 'Senha'],
  ['ramal', 'Ramal'],
  ['local', 'Local'],
  ['local-cel', 'Local Celulares'],
  ['interurbano', 'Interurbano'],
  ['internacional', 'Internacional'],
];

export const LEGACY_PROTOCOL_OPTIONS = [
  ['PJSIP', 'SIP (PJSIP)'],
  ['IAX2', 'IAX2'],
];

export const LEGACY_TIPO_OPTIONS = [
  ['Livre', 'Livre'],
  ['Controle', 'Controle'],
  ['Senha', 'Senha'],
];

export const QUEUE_STRATEGY_OPTIONS = [
  ['ringall', 'Todos'],
  ['leastrecent', 'Ultimo'],
  ['random', 'Randomico'],
  ['linear', 'Linear'],
  ['rrmemory', 'LinearMemoria'],
];

export const LEGACY_MENU_TAB_ITEMS = [
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

export const LEGACY_MENU_TAB_MAP = Object.fromEntries(LEGACY_MENU_TAB_ITEMS.map((item) => [item.key, item]));
export const LEGACY_DASHBOARD_ITEMS = LEGACY_MENU_TAB_ITEMS.filter((item) => item.status !== 'pendente' && item.mappedTab);

export function normalizeLegacyLabel(label) {
  return String(label || '')
    .replace(/^Legado:\s*/i, '')
    .replace(/^CC\s*/i, '')
    .trim();
}

export const AGENTS_FIELD_CLASS =
  'w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all';

export const AGENTS_SELECT_CLASS =
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

export const PBX_STATIC_TAB_ROUTES = {
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

export function getDashboardIconName(item, sectionTitle, index) {
  if (item?.key && PBX_DASHBOARD_ICONS[item.key]) return PBX_DASHBOARD_ICONS[item.key];
  const rotation = PBX_SECTION_ICON_ROTATION[sectionTitle] || PBX_SECTION_ICON_ROTATION.default;
  return rotation[index % rotation.length];
}

export function getDashboardIconPalette(sectionTitle, index) {
  const rotation = PBX_ICON_COLOR_ROTATION[sectionTitle] || PBX_ICON_COLOR_ROTATION.default;
  return rotation[index % rotation.length];
}

export function PbxDashboardIcon({ name }) {
  return <span aria-hidden>{PBX_DASHBOARD_EMOJIS[name] || '📌'}</span>;
}

export const INITIAL_EXTENSION_FORM = {
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