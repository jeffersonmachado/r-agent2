'use strict';

/**
 * Testes para generate-critical-journey-evidence.js (CLAUDE-003).
 *
 * Garante que o script é um LEITOR, não um SINTETIZADOR:
 * 1. Ausência de arquivos QA → CRITICAL_CAUSAL_EVIDENCE_MISSING, exit 1
 * 2. Arquivos presentes e válidos → pass=true, chain=6, correlationId real
 * 3. humanTakeoverObserved=false → VIOLATION em HUMAN_TAKEOVER
 * 4. backendMutationObserved=false → VIOLATION em BACKEND_MUTATION
 * 5. O script não contém uid(), randomBytes() para criar IDs (verificação estática)
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', '..', '..', 'scripts', 'governance', 'generate-critical-journey-evidence.js');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cje-test-'));
}

function writeJson(dir, relPath, data) {
  const abs = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(data, null, 2), 'utf8');
}

function runScript(rootDir) {
  const { spawnSync } = require('child_process');
  const result = spawnSync(process.execPath, [SCRIPT, '--root', rootDir], {
    encoding: 'utf8',
    cwd: path.join(__dirname, '..', '..', '..'),
    env: { ...process.env },
  });
  return {
    exitCode: result.status,
    stdout:   result.stdout || '',
    stderr:   result.stderr || '',
    output:   (result.stdout || '') + (result.stderr || ''),
    report:   (() => {
      const p = path.join(rootDir, 'governance', 'critical-journey-evidence.json');
      if (!fs.existsSync(p)) return null;
      try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
    })(),
  };
}

// ─── Fixtures mínimas de evidência real ──────────────────────────────────────

function buildValidSmokeReport() {
  return {
    generatedAt: '2026-08-20T14:55:32.899Z',
    status: 'GO',
    flows: [{
      journeyId: 'support_ticket_flow',
      replay: {
        id:        'prod-like-replay-support_ticket_flow-1787237690409',
        journeyId: 'support_ticket_flow',
        status:    'GO',
        steps:     [{ id: 'rs-1' }, { id: 'rs-2' }],
        events:    [{ id: 're-1' }],
      },
      seedEvidence: {
        tenantId:  'system',
        ticketId:  'support-1787237677020-drkpkjy',
        phone:     '5511997677000',
      },
      steps: [{
        id:        'step_access_support_module',
        timestamp: '2026-08-20T14:55:10.000Z',
        url:       'http://localhost:5173/support',
        status:    'passed',
      }],
    }],
  };
}

function buildValidHandoff() {
  return {
    generatedAt: '2026-05-13T01:45:10.929Z',
    ok:          true,
    tenantId:    'system',
    ticketId:    'default-1778636710285-j6xfzg7',
    ticket: {
      id:              'default-1778636710285-j6xfzg7',
      queue:           'enterprise_support',
      assignedTo:      'rpa_system',
      firstResponseAt: '2026-05-13T01:45:10.322Z',
      conversationId:  'conv-1778636710258-aec452593823',
    },
    signals: {
      humanTakeoverObserved:   true,
      ticketOwnershipObserved: true,
      routingTransferObserved: true,
      slaObserved:             true,
      backendMutationObserved: true,
    },
  };
}

function buildValidMutations() {
  return {
    generatedAt: '2026-08-20T17:37:29.701Z',
    mutations: [{
      journeyId:           'support_ticket_flow',
      stepId:              'step_reply_ticket',
      observedSideEffects: ['audit_log_created', 'notification_sent', 'crm_updated'],
      snapshotDiff:        { changed: true },
    }],
  };
}

function buildValidRoot(dir) {
  writeJson(dir, 'qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json', buildValidSmokeReport());
  writeJson(dir, 'qa/enterprise/human-handoff-full-validation.json',              buildValidHandoff());
  writeJson(dir, 'qa/enterprise/omnichannel-crm-mutations.json',                  buildValidMutations());
  writeJson(dir, 'governance/.current-run.json', {
    runId:     'rap-release-20260820-000000-testtest',
    createdAt: '2026-08-20T00:00:00.000Z',
  });
  writeJson(dir, 'governance/replay-hardening-report.json',  { decision: 'REPLAY_HARDENING_GO' });
  writeJson(dir, 'governance/replay-consistency-report.json', { decision: 'REPLAY_CONSISTENCY_GO' });
}

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('generate-critical-journey-evidence — LEITOR, não SINTETIZADOR', () => {

  test('FAIL quando smoke report está ausente', () => {
    const dir = makeTempDir();
    buildValidRoot(dir);
    fs.unlinkSync(path.join(dir, 'qa', 'smoke', 'prod-like', 'qa-waves-operational-prod-like-smoke.json'));

    const r = runScript(dir);
    expect(r.exitCode).toBe(1);
    expect(r.report?.decision).toBe('CRITICAL_CAUSAL_EVIDENCE_MISSING');
    expect(r.report?.pass).toBe(false);
    expect(r.report?.causalChain).toHaveLength(0);
  });

  test('FAIL quando human-handoff-full-validation.json está ausente', () => {
    const dir = makeTempDir();
    buildValidRoot(dir);
    fs.unlinkSync(path.join(dir, 'qa', 'enterprise', 'human-handoff-full-validation.json'));

    const r = runScript(dir);
    expect(r.exitCode).toBe(1);
    expect(r.report?.decision).toBe('CRITICAL_CAUSAL_EVIDENCE_MISSING');
  });

  test('FAIL quando omnichannel-crm-mutations.json está ausente', () => {
    const dir = makeTempDir();
    buildValidRoot(dir);
    fs.unlinkSync(path.join(dir, 'qa', 'enterprise', 'omnichannel-crm-mutations.json'));

    const r = runScript(dir);
    expect(r.exitCode).toBe(1);
    expect(r.report?.decision).toBe('CRITICAL_CAUSAL_EVIDENCE_MISSING');
  });

  test('PASS com evidências reais presentes — cadeia de 6 eventos, correlationId real', () => {
    const dir = makeTempDir();
    buildValidRoot(dir);

    const r = runScript(dir);
    expect(r.exitCode).toBe(0);
    expect(r.report?.pass).toBe(true);
    expect(r.report?.decision).toBe('CRITICAL_JOURNEY_VALIDATED');
    expect(r.report?.chainLength).toBe(6);
    expect(r.report?.violations).toHaveLength(0);

    // correlationId deve ser o replayId real (não um ID gerado aqui)
    expect(r.report?.correlationId).toBe('prod-like-replay-support_ticket_flow-1787237690409');

    // Todos os 6 tipos de evento presentes
    const eventTypes = r.report?.causalChain?.map((e) => e.eventType) || [];
    expect(eventTypes).toContain('INBOUND_MESSAGE');
    expect(eventTypes).toContain('COGNITIVE_DECISION');
    expect(eventTypes).toContain('HANDOFF_REQUEST');
    expect(eventTypes).toContain('HUMAN_TAKEOVER');
    expect(eventTypes).toContain('BACKEND_MUTATION');
    expect(eventTypes).toContain('BUSINESS_OUTCOME');
  });

  test('FAIL quando humanTakeoverObserved=false — HUMAN_TAKEOVER ausente na cadeia', () => {
    const dir = makeTempDir();
    buildValidRoot(dir);

    const handoff = buildValidHandoff();
    handoff.signals.humanTakeoverObserved = false;
    writeJson(dir, 'qa/enterprise/human-handoff-full-validation.json', handoff);

    const r = runScript(dir);
    expect(r.exitCode).toBe(1);
    expect(r.report?.pass).toBe(false);

    const eventTypes = r.report?.causalChain?.map((e) => e.eventType) || [];
    expect(eventTypes).not.toContain('HUMAN_TAKEOVER');

    const hasHumanTakeoverViolation = r.report?.violations?.some((v) => v.includes('HUMAN_TAKEOVER'));
    expect(hasHumanTakeoverViolation).toBe(true);
  });

  test('FAIL quando backendMutationObserved=false — BACKEND_MUTATION ausente', () => {
    const dir = makeTempDir();
    buildValidRoot(dir);

    const handoff = buildValidHandoff();
    handoff.signals.backendMutationObserved = false;
    writeJson(dir, 'qa/enterprise/human-handoff-full-validation.json', handoff);

    const r = runScript(dir);
    expect(r.exitCode).toBe(1);
    expect(r.report?.pass).toBe(false);

    const hasBackendViolation = r.report?.violations?.some((v) => v.includes('BACKEND_MUTATION'));
    expect(hasBackendViolation).toBe(true);
  });

  test('Verificação estática: script não usa randomBytes/uid para criar IDs', () => {
    const source = fs.readFileSync(SCRIPT, 'utf8');

    // O script não deve criar IDs sintéticos
    expect(source).not.toMatch(/crypto\.randomBytes/);
    expect(source).not.toMatch(/function uid/);
    expect(source).not.toMatch(/uid\('corr'\)/);
    expect(source).not.toMatch(/uid\('evt'\)/);
    expect(source).not.toMatch(/uid\('ticket'\)/);
    expect(source).not.toMatch(/uid\('msg'\)/);
    expect(source).not.toMatch(/uid\('appt'\)/);

    // Deve usar IDs vindos de evidências reais
    expect(source).toContain('replay.id');
    expect(source).toContain('seed.ticketId');
    expect(source).toContain('CRITICAL_CAUSAL_EVIDENCE_MISSING');
  });

  test('Todos os eventos da cadeia têm correlationId derivado de IDs reais (não gerado)', () => {
    const dir = makeTempDir();
    buildValidRoot(dir);

    const r = runScript(dir);
    expect(r.exitCode).toBe(0);

    for (const evt of r.report?.causalChain || []) {
      // correlationId deve ser o replayId real que veio do smoke report
      expect(evt.correlationId).toBe('prod-like-replay-support_ticket_flow-1787237690409');
    }
  });
});
