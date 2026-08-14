'use strict';

/**
 * Testes do registry declarativo de criticidade de jornadas
 * (config/journey-criticality.json + qa/contracts/journeyCriticality).
 *
 * Inclui o teste de contrato que ancora a migração das listas hardcoded:
 * as jornadas canônicas DEVEM estar declaradas como blocking no registry —
 * sem isso, os gates de release deixariam de bloquear (falso GO).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  getBlockingJourneys,
  isBlockingJourney,
  getSeverityByJourney,
  loadRegistry,
} = require('../../qa/contracts/journeyCriticality');

describe('journeyCriticality — registry real (contrato)', () => {
  it('jornadas canônicas estão declaradas como blocking', () => {
    const blocking = getBlockingJourneys();
    expect(blocking).toEqual(expect.arrayContaining([
      'support_ticket_flow',
      'fitness_customer_checkin',
      'agendamento',
    ]));
  });

  it('isBlockingJourney resolve as canônicas e rejeita desconhecidas', () => {
    expect(isBlockingJourney('support_ticket_flow')).toBe(true);
    expect(isBlockingJourney('agendamento')).toBe(true);
    expect(isBlockingJourney('booking_flow')).toBe(false);
    expect(isBlockingJourney('jornada_inexistente')).toBe(false);
    expect(isBlockingJourney('')).toBe(false);
    expect(isBlockingJourney(null)).toBe(false);
  });

  it('normaliza case e espaços', () => {
    expect(isBlockingJourney('  Agendamento ')).toBe(true);
    expect(isBlockingJourney('SUPPORT_TICKET_FLOW')).toBe(true);
  });

  it('severityByJourney reflete o registry', () => {
    const severities = getSeverityByJourney();
    expect(severities.support_ticket_flow).toBe('critical');
    expect(severities.agendamento).toBe('critical');
    expect(severities.booking_flow).toBe('high');
  });
});

describe('journeyCriticality — fail-closed', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'journey-crit-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeRegistry(content) {
    const file = path.join(tmpDir, `registry-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(file, content);
    return file;
  }

  it('arquivo ausente lança journey_criticality_registry_invalid', () => {
    expect(() => loadRegistry(path.join(tmpDir, 'nao-existe.json')))
      .toThrow(/journey_criticality_registry_invalid/);
  });

  it('JSON inválido lança journey_criticality_registry_invalid', () => {
    expect(() => loadRegistry(writeRegistry('{not json')))
      .toThrow(/journey_criticality_registry_invalid/);
  });

  it('campo journeys ausente lança journey_criticality_registry_invalid', () => {
    expect(() => loadRegistry(writeRegistry('{"version":1}')))
      .toThrow(/journey_criticality_registry_invalid/);
  });

  it('criticality fora do enum lança journey_criticality_registry_invalid', () => {
    expect(() => loadRegistry(writeRegistry('{"journeys":{"x":{"criticality":"urgent"}}}')))
      .toThrow(/journey_criticality_registry_invalid/);
  });

  it('registry customizado funciona via registryPath', () => {
    const file = writeRegistry('{"journeys":{"custom_journey":{"criticality":"blocking","severity":"critical"}}}');
    expect(isBlockingJourney('custom_journey', { registryPath: file })).toBe(true);
    expect(isBlockingJourney('agendamento', { registryPath: file })).toBe(false);
  });
});
