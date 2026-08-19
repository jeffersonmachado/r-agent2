'use strict';

/**
 * Regressão: o coverage gate NÃO pode depender de qa-waves/journey-coverage/*.json.
 *
 * Falha observada no CI (run 30174722502, Node 22): o step `npm run
 * zip:release` executa tools/system/platform-readiness.js, que REESCREVE
 * qa-waves/journey-coverage/*.json a partir do corpus de cenários disponível.
 * Num checkout limpo (sem qa-mesh/meshRegistry.json) o corpus é degradado e os
 * arquivos regenerados perdem todos os cenários business-*; o gate então
 * perdia 9 links diretos, journeyCoverage caía de 85.7 para 81 e o release
 * gate ia a NO_GO — com código e configs idênticos ao ambiente local.
 *
 * Correção: a ligação jornada → cenário passou a vir de
 * config/journey-scenario-links.json, declaração versionada que nenhum
 * pipeline reescreve. Estes testes provam que (1) o gate lê somente o config
 * declarado, (2) o config real versionado produz os links esperados contra o
 * snapshot real e (3) config ausente degrada para zero links de forma
 * explícita, nunca silenciosa.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  loadJourneyLinkInputs,
  SNAPSHOT_PATH,
  ROOT_DIR,
} = require('../../../scripts/governance/validate-coverage-gate');

const REAL_LINKS_CONFIG_PATH = path.join(ROOT_DIR, 'config', 'journey-scenario-links.json');

function writeFixture(data) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'journey-links-'));
  const filePath = path.join(dir, 'links.json');
  fs.writeFileSync(filePath, JSON.stringify(data));
  return filePath;
}

describe('coverage-gate: fonte estável de ligação jornada ↔ cenário', () => {
  test('lê SOMENTE o config declarado — qa-waves/journey-coverage não é consultado', () => {
    // A fixture declara uma única jornada inexistente nos arquivos verticais
    // reais. Se a implementação ainda varresse qa-waves/journey-coverage/,
    // jornadas reais (beauty_booking, market_default_journey, ...) vazariam
    // para o resultado.
    const fixture = writeFixture({
      version: 1,
      verticals: [
        {
          vertical: 'fixture',
          journeys: [
            { journey: 'fixture_journey', scenarios: [{ scenarioId: 'fixture-scenario', status: 'approved' }] },
          ],
        },
      ],
    });

    const { links, summary } = loadJourneyLinkInputs(
      [{ id: 'fixture-scenario', domain: 'fixture' }, { id: 'business-market-flow-node', domain: 'mercado' }],
      { linksConfigPath: fixture },
    );

    expect(Object.keys(links)).toEqual(['fixture_journey']);
    expect(links.fixture_journey.scenarioIds).toEqual(['fixture-scenario']);
    expect(links.fixture_journey.source).toBe('journey-coverage');
    expect(summary.verticals).toBe(1);
  });

  test('config ausente/inválido → zero links com origem explícita (nunca silencioso)', () => {
    const fixture = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'journey-links-')), 'missing.json');
    const { links, summary } = loadJourneyLinkInputs(
      [{ id: 'business-market-flow-node', domain: 'mercado' }],
      { linksConfigPath: fixture },
    );
    expect(links).toEqual({});
    expect(summary.total).toBe(0);
    expect(summary.linksSource).toMatch(/ausente\/inválido/);
  });

  test('config real versionado produz os 90 links esperados contra o snapshot real (modo CI)', () => {
    // Reproduz exatamente o modo snapshot do CI: cenários do baseline
    // versionado, sem qa-mesh/meshRegistry.json. Antes da correção este
    // cenário rendia apenas 7 links (2 diretos) com os arquivos verticais
    // degradados pelo platform-readiness.
    const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
    const { links, summary } = loadJourneyLinkInputs(snapshot.scenarios, {
      linksConfigPath: REAL_LINKS_CONFIG_PATH,
    });

    expect(summary.total).toBe(90);
    expect(summary.bySource['journey-coverage']).toBe(85);
    expect(summary.bySource['scenario-name']).toBe(5);

    // Links diretos críticos que sumiram no CI antes da correção:
    expect(links.market_default_journey.scenarioIds).toContain('business-market-flow-node');
    expect(links.beauty_booking.scenarioIds).toContain('business-beauty-flow-appointment');
    expect(links.clinic_default_journey.scenarioIds).toContain('business-clinic-flow-ticket');
    expect(links.food_customer_journey.scenarioIds).toContain('business-food-flow-order');
    expect(links.services_default_journey.scenarioIds).toContain('business-serv-flow-solution');

    // HARD-016: jornada crítica fitness_customer_checkin religada a cenário
    // real do mesh (IDs sintéticos auto-gerados nunca existiram no registry).
    expect(links.fitness_customer_checkin.scenarioIds).toEqual(['business-fit-flow-checkin']);

    // Jornadas core (declaração manual): antes UNCOVERED, hoje ligadas aos
    // cenários executáveis business-core-flow-* do QA mesh.
    expect(links.support_ticket_flow.scenarioIds).toContain('business-core-flow-support-ticket');
    expect(links.booking_flow.scenarioIds).toContain('business-core-flow-booking');
    expect(links.payment_charge_flow.scenarioIds).toContain('business-core-flow-payment-charge');

    // Jornadas capability_* (core de sistema): ligadas aos cenários
    // business-core-cap-* executados no mesh.
    expect(links.capability_scheduling.scenarioIds).toContain('business-core-cap-scheduling');
    expect(links.capability_crm_updates.scenarioIds).toContain('business-core-cap-crm-updates');
    expect(links.capability_lead_capture.scenarioIds).toContain('business-core-cap-lead-capture');

    // Jornadas business batch 1a: ligadas aos cenários business-core-biz-*
    // executados no mesh com fluxos reais (tests/rpa/business).
    expect(links.orders.scenarioIds).toContain('business-core-biz-orders');
    expect(links.billing.scenarioIds).toContain('business-core-biz-billing');
    expect(links.tasks.scenarioIds).toContain('business-core-biz-tasks');
    expect(links.quick_replies.scenarioIds).toContain('business-core-biz-quick-replies');
    expect(links.webhooks.scenarioIds).toContain('business-core-biz-webhooks');
    expect(links.inbox.scenarioIds).toContain('business-core-biz-inbox');
    expect(links.campaigns.scenarioIds).toContain('business-core-biz-campaigns');
    expect(links.projects.scenarioIds).toContain('business-core-biz-projects');

    // Jornadas business batch 1b: mesma mecânica; calendar reutiliza o
    // cenário cap-scheduling (que já exercita blocos de calendário).
    expect(links.marketing.scenarioIds).toContain('business-core-biz-marketing');
    expect(links.automations.scenarioIds).toContain('business-core-biz-automations');
    expect(links.sla.scenarioIds).toContain('business-core-biz-sla');
    expect(links.deliveries.scenarioIds).toContain('business-core-biz-deliveries');
    expect(links.developer.scenarioIds).toContain('business-core-biz-developer');
    expect(links.whatsapp_connections.scenarioIds).toContain('business-core-biz-whatsapp-connections');
    expect(links.analytics.scenarioIds).toContain('business-core-biz-analytics');
    expect(links.operational_intelligence.scenarioIds).toContain('business-core-biz-intelligence');
    expect(links.calendar.scenarioIds).toContain('business-core-cap-scheduling');

    // Jornadas business batch 1c: plataforma operacional (academy, fila
    // física, tokens públicos, process runtime, RBAC, templates, export...).
    expect(links.academy_learning.scenarioIds).toContain('business-core-biz-academy');
    expect(links.physical_queue_kiosk_station_panel_fila.scenarioIds).toContain('business-core-biz-physical-queue');
    expect(links.public_tokens.scenarioIds).toContain('business-core-biz-public-tokens');
    expect(links.process_runtime.scenarioIds).toContain('business-core-biz-process-runtime');
    expect(links.solutions.scenarioIds).toContain('business-core-biz-solutions');
    expect(links.rbac_access_control.scenarioIds).toContain('business-core-biz-rbac');
    expect(links.templates.scenarioIds).toContain('business-core-biz-templates');
    expect(links.operations_dashboard.scenarioIds).toContain('business-core-biz-ops-dashboard');
    expect(links.cognitive_assistant.scenarioIds).toContain('business-core-biz-cognitive');
    expect(links.supervisor.scenarioIds).toContain('business-core-biz-supervisor');
    expect(links.queues.scenarioIds).toContain('business-core-biz-queues');
    expect(links.departments.scenarioIds).toContain('business-core-biz-departments');
    expect(links.export.scenarioIds).toContain('business-core-biz-export');
    expect(links.demo.scenarioIds).toContain('business-core-biz-demo');

    // Jornadas de plataforma/sistema (batch 2): agent OS, registries, auth,
    // canais e operações — ligadas aos cenários business-core-biz-* do mesh.
    expect(links.agent_factory.scenarioIds).toContain('business-core-biz-agent-factory');
    expect(links.agent_registry.scenarioIds).toContain('business-core-biz-agent-registry');
    expect(links.journey_registry.scenarioIds).toContain('business-core-biz-journey-registry');
    expect(links.rap_learn.scenarioIds).toContain('business-core-biz-rap-learn');
    expect(links.flows_editor_rpa_replay.scenarioIds).toContain('business-core-biz-flows-editor');
    expect(links.login.scenarioIds).toContain('business-core-biz-login');
    expect(links.agenda.scenarioIds).toContain('business-core-biz-agenda');
    expect(links.tenants.scenarioIds).toContain('business-core-biz-tenants');
    expect(links.mfa.scenarioIds).toContain('business-core-biz-mfa');
  });
});
