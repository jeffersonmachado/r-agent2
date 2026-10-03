'use strict';

/**
 * BUG_WORKER_HEALTH_RUNTIME_ENFORCEMENT — o estado do worker é CONSUMIDO em runtime.
 *
 * DEFEITO QUE ESTE TESTE TRAVA (confirmado no código em 2026-10-03): `getEngineeringWorkerHealth()`
 * já existia, já sabia classificar worker DOWN como NO_GO e já estava exportada — mas **nenhuma
 * superfície a consumia**. Com o laço de bugs morto, a prontidão do subsistema de engenharia
 * continuava indistinguível de saudável: não havia onde observar (nenhum endpoint) nem o que
 * bloquear (nenhum gate lia o valor).
 *
 * Existir em código e não ser consumido é indistinguível de não existir. Aqui se prova o consumo:
 * (a) o classificador devolve NO_GO/BLOCKING com o worker parado; (b) a rota de saúde existe e
 * responde com o veredito; (c) a rota é GUARDADA (classificação + permissão), para que diagnóstico
 * de engenharia não vaze para a superfície do cliente.
 */

const { getEngineeringWorkerHealth } = require('../../../api/runtime/startWorkers');
const { createEngineeringMissionRoutes } = require('../../../api/modules/engineering-missions/routes');

/** Router montado com deps controladas, para exercitar a rota sem subir o servidor. */
function buildRouter({ permissionAllowed = true, classificationAllowed = true } = {}) {
  const captured = [];
  const deps = {
    requireAuth: () => ({ valid: true, user: { id: 'u-1' } }),
    requirePermission: () => ({ allowed: permissionAllowed, error: permissionAllowed ? null : 'sem permissão' }),
    sendJson: (res, status, payload) => { captured.push({ status, payload }); },
    logger: { info() {}, warn() {}, error() {} },
  };
  const router = createEngineeringMissionRoutes({ buildDeps: () => deps });
  const layer = (router.stack || []).find(
    (l) => l.route && l.route.path === '/engineering/missions/workers/health',
  );
  return { router, layer, captured, deps, classificationAllowed };
}

function invoke(layer, { method = 'GET', path = '/engineering/missions/workers/health' } = {}) {
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  const req = {
    method,
    path,
    url: path,
    headers: {},
    query: {},
    // A classificação de ator é resolvida do AGENT (server-side), não das deps injetadas: sem um
    // ator que resolva para DEVELOPMENT a própria guarda de segregação barra com 403 — que é o
    // comportamento correto, e é o que o teste 3 mede.
    agent: { actorType: 'USER', platformRole: 'engineer', role: 'super_admin' },
    user: { id: 'u-1' },
  };
  const res = {};
  return Promise.resolve(handler(req, res));
}

describe('BUG_WORKER_HEALTH_RUNTIME_ENFORCEMENT', () => {
  it('worker ausente ⇒ readiness NÃO é GREEN e a ausência é EXPLICITAMENTE contabilizada', () => {
    const health = getEngineeringWorkerHealth({ engineerRouterEnabled: true });

    // Medido no runtime real: worker nunca iniciado = STOPPED ⇒ DEGRADED; worker morto = DOWN ⇒
    // NO_GO. O invariante é o mesmo nos dois casos e é o que importa: NÃO pode ser GREEN, e a
    // capacidade ausente tem de aparecer nomeada (não some em silêncio).
    expect(health.engineeringReadiness).not.toBe('GREEN');
    expect(['NO_GO', 'DEGRADED']).toContain(health.engineeringReadiness);
    expect(['ENGINEERING_REQUIRED_WORKER_DOWN', 'ENGINEERING_REQUIRED_WORKER_DEGRADED']).toContain(health.code);

    const contabilizados = [...(health.blocking || []), ...(health.degraded || [])];
    expect(contabilizados.length).toBeGreaterThan(0);
    expect(contabilizados.map((w) => w.type)).toContain('BUG_LOOP');

    expect(health.workers.bugLoop).toBeTruthy();
    expect(health.workers.bugLoop.running).toBe(false);
  });

  it('worker DOWN (processo morreu / start falhou) ⇒ NO_GO com blocking NÃO-VAZIO', () => {
    // Caminho mais severo, exercitado no classificador puro para ser determinístico: um worker
    // obrigatório DOWN tem de BLOQUEAR (não apenas degradar).
    const { assessEngineeringReadiness } = require('../../../engine/engineeringMission/workerHealth');
    const readiness = assessEngineeringReadiness({
      requiredWorkers: [{ type: 'BUG_LOOP', health: 'DOWN', code: 'WORKER_EXIT_UNEXPECTED', reason: 'processo do worker morreu' }],
      engineerRouterEnabled: true,
    });
    expect(readiness.readiness).toBe('NO_GO');
    expect(readiness.code).toBe('ENGINEERING_REQUIRED_WORKER_DOWN');
    expect(readiness.blocking.length).toBe(1);
    expect(readiness.blocking[0].type).toBe('BUG_LOOP');
  });

  it('Engineer Router DESABILITADO ⇒ nenhum worker é obrigatório (não inventa indisponibilidade)', () => {
    const health = getEngineeringWorkerHealth({ engineerRouterEnabled: false });
    expect(health.engineeringReadiness).toBe('GREEN');
    expect([...(health.blocking || []), ...(health.degraded || [])].length).toBe(0);
  });

  it('a rota de saúde dos workers EXISTE e responde com o veredito consumido', async () => {
    const { layer, captured } = buildRouter();
    expect(layer).toBeTruthy(); // sem a rota, o teste falha aqui (era o estado anterior: 0 superfícies)

    await invoke(layer);

    expect(captured.length).toBe(1);
    expect(captured[0].status).toBe(200);
    const body = captured[0].payload;
    expect(body.engineeringReadiness).toBeTruthy();
    expect(body.engineeringReadiness).not.toBe('GREEN');
    // A superfície expõe a CAPACIDADE AUSENTE nomeada, não um booleano opaco.
    expect(Array.isArray(body.blocking)).toBe(true);
    expect(Array.isArray(body.degraded)).toBe(true);
    expect([...body.blocking, ...body.degraded].length).toBeGreaterThan(0);
    expect(body.worker).toBeTruthy();
    expect(body.worker.running).toBe(false);
    // Diagnóstico de engenharia: preso à classificação DEVELOPMENT.
    expect(body.boundedBy).toBe('DEVELOPMENT');
  });

  it('a rota é GUARDADA: sem permissão, nada é exposto', async () => {
    const { layer, captured } = buildRouter({ permissionAllowed: false });
    await invoke(layer);

    // O guard já respondeu 403 antes do handler; a saúde NÃO vazou.
    expect(captured.length).toBeGreaterThanOrEqual(1);
    expect(captured[0].status).toBe(403);
    // Com a classificação já satisfeita (ator DEVELOPMENT), o 403 vem do RBAC — não da segregação.
    expect(captured[0].payload.error).toBe('forbidden');
    expect(captured.every((c) => c.payload && c.payload.engineeringReadiness === undefined)).toBe(true);
  });

  it('estado observável exigido pelo enunciado está presente no worker', () => {
    const worker = getEngineeringWorkerHealth({ engineerRouterEnabled: true }).workers.bugLoop;
    for (const field of ['type', 'health', 'state', 'running', 'code', 'reason', 'processedFindings', 'lastRunAt', 'lastSuccessfulCycleAt']) {
      expect(Object.prototype.hasOwnProperty.call(worker, field)).toBe(true);
    }
  });
});
