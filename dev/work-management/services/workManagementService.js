// Orquestrador de dados do Work Management standalone.
//
// Fontes por domínio (LIVE = API real da plataforma na porta 3001, MOCK = data/mockData.js):
//   operationWaves  LIVE  GET /api/qa-waves/waves (+ journey-status p/ falhas)
//   healthDomains   LIVE  GET /system/status
//   executions      LIVE  GET /api/executions?limit=100
//   replays         LIVE  GET /api/qa-waves/replays (+ /replays/:id p/ timeline)
//   qaScenarios     LIVE  GET /api/qa-waves/scenarios
//   workspaces      MOCK  sem backend dedicado
//   projects        MOCK  sem backend dedicado
//   workItems       MOCK  sem backend dedicado
//   evidence        MOCK  /api/evidence/* é evidence por entidade (inbox/CRM),
//                         shape incompatível com evidência de execução da UI
//   aiSuggestions   MOCK  sem backend dedicado
//   documents       MOCK  sem backend dedicado
//   team            MOCK  sem backend dedicado
//   activity        MOCK  sem backend dedicado
//
// Regras:
// - Sem token: retorna authRequired=true e coleções vazias (nunca mock como se fosse real).
// - Com token: busca os domínios LIVE em paralelo e mescla com o mock dos demais.
//   Se um domínio LIVE falhar, cai para o mock DAQUELE domínio e marca sources como 'mock'.
import { loadWorkManagementData as loadMockWorkManagementData } from './mock/workManagementService.js';
import { getToken } from './api/client.js';
import { fetchLiveDomains } from './api/workManagementApi.js';

const MOCK_DOMAINS = [
  'workspaces',
  'projects',
  'workItems',
  'evidence',
  'aiSuggestions',
  'documents',
  'team',
  'activity',
];

const LIVE_DOMAINS = ['operationWaves', 'healthDomains', 'executions', 'replays', 'qaScenarios'];

const EMPTY_DATA = {
  workspaces: [],
  projects: [],
  workItems: [],
  executions: [],
  replays: [],
  evidence: [],
  aiSuggestions: [],
  documents: [],
  team: [],
  activity: [],
  operationWaves: [],
  healthDomains: [],
  qaScenarios: [],
};

export async function loadWorkManagementData() {
  if (!getToken()) {
    return {
      ...EMPTY_DATA,
      authRequired: true,
      sources: Object.fromEntries(
        [...MOCK_DOMAINS, ...LIVE_DOMAINS].map((domain) => [domain, 'indisponível (login necessário)']),
      ),
      liveErrors: {},
    };
  }

  const [mock, live] = await Promise.all([loadMockWorkManagementData(), fetchLiveDomains()]);

  const data = { ...mock };
  const sources = {};

  for (const domain of MOCK_DOMAINS) {
    sources[domain] = 'mock';
  }
  for (const domain of LIVE_DOMAINS) {
    if (live.sources[domain] === 'live') {
      data[domain] = live.domains[domain];
      sources[domain] = 'live';
    } else {
      // fallback explícito: domínio permanece no mock e a fonte diz isso
      sources[domain] = 'mock';
    }
  }

  return {
    ...data,
    authRequired: false,
    sources,
    liveErrors: live.errors,
  };
}
