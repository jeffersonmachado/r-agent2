'use strict';

/**
 * MISSÃO ASK_AI_AGENT — T-A4 (links operacionais de dado vivo).
 *
 * RED medido em 2026-09-15: respostas fundamentadas em dado vivo NÃO emitiam
 * nenhum link operacional — o cabeçalho de `buildSources` declarava "dado vivo
 * NÃO entra na lista" e o operador precisava sair da resposta e procurar a
 * entidade na navegação à mão.
 *
 * Regra fixada:
 *   - quando a resposta é fundamentada em dado vivo de uma entidade presente no
 *     contexto, o copiloto emite UM link operacional
 *     (`{ sourceType: 'LIVE_DATA', label: 'Ver aluno', url: <rota real do frontend> }`);
 *   - o link só existe quando a posse da entidade foi REVALIDADA no backend
 *     (tenant) E o ator mantém a permissão da rota de destino;
 *   - tipo de entidade sem rota segura mapeada → sem link (fail-closed);
 *   - entidade de outro tenant é indistinguível de inexistente → sem link e
 *     nenhum dado consultado.
 */

const mockGetMembershipDetail = jest.fn();
const mockGetMembershipAccessStatus = jest.fn();
const mockGetAttendanceHistory = jest.fn();

jest.mock('../../../api/services/vertical/fitnessMembershipService', () => ({
  getMembershipDetail: (...args) => mockGetMembershipDetail(...args),
  getMembershipBillingHistory: jest.fn(async () => ({ items: [], total: 0 })),
  getMembershipAccessStatus: (...args) => mockGetMembershipAccessStatus(...args),
}));
jest.mock('../../../api/services/vertical/fitnessAttendanceService', () => ({
  getAttendanceHistory: (...args) => mockGetAttendanceHistory(...args),
}));
jest.mock('../../../api/services/vertical/fitnessChurnSignalService', () => ({
  latestFitnessSignalByPhone: jest.fn(async () => null),
}));
jest.mock('../../../api/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const { runAskAiTurn, buildSources } = require('../../../api/services/askAi/orchestrator');
const { buildOperationalLink } = require('../../../api/services/askAi/operationalLinks');

const ACTOR_ADMIN = { id: 'u-ad', username: 'admin', role: 'admin', tenantId: 'academia-a' };
// viewer: sem reports:read — não pode abrir a tela de alunos.
const ACTOR_VIEWER = { id: 'u-vw', username: 'viewer', role: 'viewer', tenantId: 'academia-a' };

function buildStore() {
  const conversations = new Map();
  return {
    openConversation: async ({ conversationId, context }) => {
      const id = conversationId || 'conv_links';
      if (!conversations.has(id)) {
        conversations.set(id, { id, messages: [], summary: null, context: context || {}, turnCount: 0 });
      }
      return conversations.get(id);
    },
    appendTurn: async ({ conversation, question, answer, ...rest }) => {
      conversation.messages.push(
        { role: 'user', content: question },
        { role: 'assistant', content: answer, ...rest },
      );
      return { conversation, window: conversation.messages, summary: null };
    },
  };
}

function fixtureStudentOwned(tenantOwned = 'academia-a') {
  mockGetMembershipAccessStatus.mockImplementation(async ({ tenantId }) => (
    tenantId === tenantOwned
      ? { allowed: true, membership: { id: 'm-1', subject_id: 'student-42', metadata: {} } }
      : { allowed: false, membership: null }
  ));
  mockGetMembershipDetail.mockResolvedValue({
    id: 'm-1', status: 'ACTIVE', effectiveBillingStatus: 'CURRENT', accessAllowed: true,
  });
  mockGetAttendanceHistory.mockResolvedValue({ items: [], total: 0, frequency7d: 0, frequency30d: 1 });
}

const STUDENT_CONTEXT = { entityType: 'FITNESS_STUDENT', entityId: 'student-42' };

describe('T-A4 — buildOperationalLink (função pura, fail-closed)', () => {
  it('ator com permissão e dado vivo usado → link LIVE_DATA para rota real', () => {
    const link = buildOperationalLink({
      entity: { type: 'FITNESS_STUDENT', id: 'student-42' },
      actor: ACTOR_ADMIN,
      liveDataUsed: true,
    });
    expect(link).not.toBeNull();
    expect(link.sourceType).toBe('LIVE_DATA');
    expect(link.label).toBe('Ver aluno');
    expect(link.url).toBe('/fitness/students');
    expect(typeof link.title).toBe('string');
  });

  it('ator SEM a permissão da rota de destino → sem link', () => {
    const link = buildOperationalLink({
      entity: { type: 'FITNESS_STUDENT', id: 'student-42' },
      actor: ACTOR_VIEWER,
      liveDataUsed: true,
    });
    expect(link).toBeNull();
  });

  it('resposta sem dado vivo consultado → sem link operacional', () => {
    expect(buildOperationalLink({
      entity: { type: 'FITNESS_STUDENT', id: 'student-42' },
      actor: ACTOR_ADMIN,
      liveDataUsed: false,
    })).toBeNull();
  });

  it('tipo de entidade sem rota segura mapeada → sem link (fail-closed)', () => {
    // CAMPAIGN/TICKET/CASE não têm mapeamento declarado: nunca inventar URL.
    for (const type of ['CAMPAIGN', 'TICKET', 'CASE', 'CUSTOMER']) {
      expect(buildOperationalLink({
        entity: { type, id: 'x-1' },
        actor: ACTOR_ADMIN,
        liveDataUsed: true,
      })).toBeNull();
    }
  });

  it('conversa do inbox → deep link com conversationId codificado', () => {
    const link = buildOperationalLink({
      entity: { type: 'CONVERSATION', id: 'conv-123' },
      actor: ACTOR_ADMIN,
      liveDataUsed: true,
    });
    expect(link.url).toBe('/inbox?conversationId=conv-123');
  });

  it('nenhum link carrega identificador interno de tool', () => {
    const link = buildOperationalLink({
      entity: { type: 'FITNESS_STUDENT', id: 'student-42' },
      actor: ACTOR_ADMIN,
      liveDataUsed: true,
    });
    expect(JSON.stringify(link)).not.toMatch(/askai\.|toolId|chunk/i);
  });
});

describe('T-A4 — link operacional no turno (orquestração real)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fixtureStudentOwned();
  });

  it('entidade validada + permissão → sources inclui "Ver aluno"', async () => {
    const turn = await runAskAiTurn({
      payload: { question: 'Qual foi a última visita deste aluno?', context: STUDENT_CONTEXT },
      tenantId: 'academia-a',
      actor: ACTOR_ADMIN,
      deps: { ...buildStore() },
    });

    const liveLink = turn.sources.find((source) => source.sourceType === 'LIVE_DATA');
    expect(liveLink).toBeDefined();
    expect(liveLink.label).toBe('Ver aluno');
    expect(liveLink.url).toBe('/fitness/students');
  });

  it('ator sem permissão na rota de destino → responde com dado, mas SEM link', async () => {
    const turn = await runAskAiTurn({
      payload: { question: 'Qual foi a última visita deste aluno?', context: STUDENT_CONTEXT },
      tenantId: 'academia-a',
      actor: ACTOR_VIEWER,
      deps: { ...buildStore() },
    });

    expect(turn.sources.some((source) => source.sourceType === 'LIVE_DATA')).toBe(false);
  });

  it('entidade de OUTRO tenant → sem link e nenhum dado consultado', async () => {
    const turn = await runAskAiTurn({
      payload: { question: 'Qual foi a última visita deste aluno?', context: STUDENT_CONTEXT },
      tenantId: 'academia-b', // tenant diferente: posse não é provada
      actor: { ...ACTOR_ADMIN, tenantId: 'academia-b' },
      deps: { ...buildStore() },
    });

    expect(turn.policy.accessDenied).toBe(true);
    expect(mockGetAttendanceHistory).not.toHaveBeenCalled();
    expect(turn.sources.some((source) => source.sourceType === 'LIVE_DATA')).toBe(false);
  });

  it('buildSources coloca o link operacional na lista exibível com o mesmo contrato', () => {
    const link = buildOperationalLink({
      entity: { type: 'FITNESS_STUDENT', id: 'student-42' },
      actor: ACTOR_ADMIN,
      liveDataUsed: true,
    });
    const sources = buildSources({
      knowledgeSources: [{ documentId: 'src-docs-manual-verticals-beauty-html', title: 'Chunk 2' }],
      operationalLink: link,
    });
    expect(sources[0].sourceType).toBe('LIVE_DATA');
    for (const source of sources) {
      expect(typeof source.title).toBe('string');
      expect(typeof source.url).toBe('string');
      expect(typeof source.label).toBe('string');
    }
  });
});
