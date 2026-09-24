'use strict';

/**
 * Policy Escalation — recusa REAL atravessando o compilador (§20, §21).
 *
 * A suíte pura (`engineeringMissionPolicyResolver.test.js`) prova a decisão; esta prova que a
 * decisão está LIGADA no caminho real: uma missão que pede política mais permissiva que a
 * instalação NÃO enriquece — falha com `POLICY_ESCALATION_DENIED` antes de qualquer efeito.
 *
 * ISOLAMENTO ENTRE SUÍTES (defeito real encontrado ao rodar a pasta inteira): a primeira versão
 * desta suíte MUTAVA a política da instalação (`engineering_mission_settings`, singleton
 * compartilhado) e, rodando em paralelo com outras suítes de missão, alterava o comportamento
 * delas — a suíte de lease começou a falhar por causa disso. Agora a suíte é READ-ONLY sobre a
 * política global: ela LÊ a política vigente e deriva os pedidos a partir dela (mais amplo ⇒
 * recusa; mais restrito ⇒ aceita). Se a política vigente não permitir derivar o pedido necessário,
 * o teste FALHA com mensagem explícita — nunca passa em silêncio.
 *
 * Banco indisponível ⇒ pulo EXPLÍCITO.
 */

const sequelizeModule = require('../../api/db/sequelize');
const compiler = require('../../api/services/engineeringMission/missionCompilerService');
const store = require('../../api/services/engineeringMission/missionStoreService');

const RISK_ORDER = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

let dbAvailable = false;
let dbReason = null;
let installation = null;
const created = [];

function skipIfNoDatabase() {
  if (dbAvailable) return false;
  // Porta ÚNICA de infraestrutura (§11/§12): em RELEASE_AUTHORITATIVE=1 isto LANÇA INFRA_ERROR
  // (nunca PASS silencioso); em dev registra NOT_EXECUTED com motivo.
  return require('../helpers/infraGate').skipOrFail({ suite: 'mission-policy-escalation', available: dbAvailable, reason: dbReason, requirement: 'postgres' });
}

/** Pedido estritamente MAIS AMPLO que a instalação, derivado dela (sem mutar nada). */
function widerRisk() {
  const index = RISK_ORDER.indexOf(installation?.maxRisk);
  if (index < 0) return null;
  return index < RISK_ORDER.length - 1 ? RISK_ORDER[index + 1] : null;
}

/** Pedido estritamente MAIS RESTRITO que a instalação. */
function narrowerRisk() {
  const index = RISK_ORDER.indexOf(installation?.maxRisk);
  if (index <= 0) return null;
  return RISK_ORDER[index - 1];
}

async function compileExpectingDenial(rawMission, options) {
  try {
    const compiled = await compiler.compileMission(rawMission, options);
    created.push(compiled.mission.id);
    return { denied: false, compiled };
  } catch (error) {
    if (error.missionId) created.push(error.missionId);
    return { denied: true, error };
  }
}

async function cleanup(missionId) {
  const index = require('../../api/db/models');
  const Mission = index.EngineeringMission();
  for (const table of ['engineering_mission_reviews', 'engineering_mission_approvals', 'engineering_mission_versions']) {
    await Mission.sequelize.query(`DELETE FROM ${table} WHERE mission_id = :id`, { replacements: { id: missionId } }).catch(() => {});
  }
  await Mission.destroy({ where: { id: missionId } }).catch(() => {});
}

beforeAll(async () => {
  try {
    await sequelizeModule.connect(2, 250);
    dbAvailable = true;
    installation = await store.getAutoApprovalPolicy();
  } catch (error) {
    dbAvailable = false;
    dbReason = error.message;
  }
}, 20000);

afterAll(async () => {
  if (!dbAvailable) return;
  for (const id of created) await cleanup(id);
  await sequelizeModule.close().catch(() => {});
}, 30000);

describe('Engineering Mission — escalação de política (§20/§21)', () => {
  jest.setTimeout(90000);

  test('missão que PEDE mais risco que a instalação FALHA com POLICY_ESCALATION_DENIED', async () => {
    if (skipIfNoDatabase()) return;
    const requestedRisk = widerRisk();
    if (!requestedRisk) {
      throw new Error(`ambiente não permite derivar pedido mais amplo: política da instalação já está em ${installation.maxRisk}`);
    }

    const outcome = await compileExpectingDenial('Missão que tenta ampliar a política sozinha.', {
      createdBy: 'jest-policy',
      autoApprovalPolicy: { maxRisk: requestedRisk },
    });

    expect(outcome.denied).toBe(true);
    expect(outcome.error.code).toBe('POLICY_ESCALATION_DENIED');
    expect(outcome.error.escalations.map((e) => e.axis)).toContain('maxRisk');

    // Fail-closed: nada foi aprovado e nada foi executado.
    const after = await store.getMission(outcome.error.missionId);
    expect(after.status).not.toBe('APPROVED');
    expect(after.linked_task_id).toBeNull();
  }, 90000);

  test('threshold de confiança mais baixo que a instalação também é escalação (recusada)', async () => {
    if (skipIfNoDatabase()) return;
    const base = Number(installation?.confidenceThreshold);
    if (!Number.isFinite(base) || base <= 0.01) {
      throw new Error(`ambiente não permite derivar threshold mais baixo: instalação em ${installation?.confidenceThreshold}`);
    }

    const outcome = await compileExpectingDenial('Missão tentando aceitar enriquecimento menos confiável.', {
      createdBy: 'jest-policy',
      autoApprovalPolicy: { confidenceThreshold: Math.max(0.01, base / 10) },
    });
    expect(outcome.denied).toBe(true);
    expect(outcome.error.escalations.map((e) => e.axis)).toContain('confidenceThreshold');
  }, 90000);

  test('missão que apenas RESTRINGE enriquece normalmente, com resolução de política persistida', async () => {
    if (skipIfNoDatabase()) return;
    const requestedRisk = narrowerRisk();
    if (!requestedRisk) {
      throw new Error(`ambiente não permite derivar pedido mais restrito: política da instalação já está em ${installation.maxRisk}`);
    }

    const detail = await compiler.compileMission('Missão que restringe a própria política.', {
      createdBy: 'jest-policy',
      autoApprovalPolicy: {
        maxRisk: requestedRisk,
        confidenceThreshold: Math.min(0.99, Number(installation.confidenceThreshold) + 0.1),
      },
    });
    created.push(detail.mission.id);
    expect(detail.mission.status).toBeTruthy();

    const stored = await store.getMission(detail.mission.id);
    const resolution = stored.preview?.policyResolution;
    expect(resolution).toBeTruthy();
    expect(resolution.decision).toBe('ALLOW');
    expect(resolution.escalations).toHaveLength(0);
    expect(resolution.effectivePolicy.maxRisk).toBe(requestedRisk);
    expect(resolution.globalPolicy.maxRisk).toBe(installation.maxRisk);
    expect(resolution.differences.map((d) => d.axis)).toEqual(expect.arrayContaining(['maxRisk']));
    // Evidência persistida também no resume metadata (sobrevive a re-enriquecimento).
    expect(stored.resume_metadata?.policyResolution?.decision).toBe('ALLOW');
  }, 90000);

  test('a política EFETIVA nunca é mais permissiva que a instalação quando a escalação é negada', async () => {
    if (skipIfNoDatabase()) return;
    const requestedRisk = widerRisk();
    if (!requestedRisk) {
      throw new Error(`ambiente não permite derivar pedido mais amplo: instalação em ${installation.maxRisk}`);
    }

    const outcome = await compileExpectingDenial('Missão pedindo tudo que a instalação nega.', {
      createdBy: 'jest-policy',
      autoApprovalPolicy: {
        mode: 'POLICY_BASED',
        maxRisk: requestedRisk,
        confidenceThreshold: Math.max(0.01, Number(installation.confidenceThreshold) / 10),
      },
    });
    expect(outcome.denied).toBe(true);
    expect(outcome.error.resolution.decision).toBe('DENY');

    const { effectivePolicy, globalPolicy } = outcome.error.resolution;
    for (const axis of ['mode', 'maxRisk', 'confidenceThreshold']) {
      expect(effectivePolicy[axis]).toEqual(globalPolicy[axis]);
    }
    expect(effectivePolicy.maxRisk).toBe(installation.maxRisk);
  }, 90000);

  test('ligar autoaprovação que a instalação deixou DESLIGADA é escalação (recusada)', async () => {
    if (skipIfNoDatabase()) return;
    if (installation.enabled === true) {
      // Sem mutar a instalação: se ela já está ligada, este eixo não pode ser exercitado aqui.
      // O caminho segue coberto pela suíte pura do resolver e pelo eixo de risco acima.
      throw new Error('ambiente não permite exercitar "enabled": autoaprovação da instalação já está ligada');
    }
    const outcome = await compileExpectingDenial('Missão tentando ligar autoaprovação global.', {
      createdBy: 'jest-policy',
      autoApprovalPolicy: { enabled: true },
    });
    expect(outcome.denied).toBe(true);
    expect(outcome.error.escalations.map((e) => e.axis)).toContain('enabled');
  }, 90000);
});
