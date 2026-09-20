'use strict';

const {
  CODES,
  OPERATIONAL_TARGETS,
  parseAttachedNetworks,
  evaluateContainer,
  evaluateInternalNetwork,
  evaluateAttachments,
  decideOperationalProbe,
  evaluateLegacyCredential,
  evaluateHttpHealth,
  evaluateToolCall,
  evaluateRestartRecovery,
  buildRequiresDockerReport,
  buildReport,
} = require('../../../scripts/governance/validate-mcp-research-docker-e2e');

const {
  evaluateReportForSeal,
} = require('../../../scripts/governance/verify-mcp-research-docker-e2e-pass');

const ASTERISK = OPERATIONAL_TARGETS.find((t) => t.name === 'asterisk');

describe('validate-mcp-research-docker-e2e — decisões puras', () => {
  describe('parseAttachedNetworks', () => {
    test('lista separada por espaço vira array', () => {
      expect(parseAttachedNetworks('rap-internal rap-research-egress '))
        .toEqual(['rap-internal', 'rap-research-egress']);
    });
    test('null/vazio vira array vazio', () => {
      expect(parseAttachedNetworks(null)).toEqual([]);
      expect(parseAttachedNetworks('')).toEqual([]);
    });
  });

  describe('evaluateContainer', () => {
    test('container ausente => MCP_E2E_CONTAINER_MISSING', () => {
      expect(evaluateContainer(null, null).code).toBe(CODES.CONTAINER_MISSING);
    });
    test('parado ou doente => MCP_E2E_CONTAINER_UNHEALTHY', () => {
      expect(evaluateContainer('exited', 'none').code).toBe(CODES.CONTAINER_UNHEALTHY);
      expect(evaluateContainer('running', 'unhealthy').code).toBe(CODES.CONTAINER_UNHEALTHY);
      expect(evaluateContainer('running', 'starting').code).toBe(CODES.CONTAINER_UNHEALTHY);
    });
    test('running/healthy (ou sem healthcheck) => sem violação', () => {
      expect(evaluateContainer('running', 'healthy')).toBeNull();
      expect(evaluateContainer('running', 'none')).toBeNull();
    });
  });

  describe('evaluateInternalNetwork', () => {
    test('rede inexistente => NETWORK_NOT_ISOLATED', () => {
      const violations = evaluateInternalNetwork(null, null);
      expect(violations.map((v) => v.code)).toEqual([CODES.NETWORK_NOT_ISOLATED]);
    });
    test('Internal=false no runtime => NETWORK_NOT_ISOLATED (controle declarado inerte)', () => {
      const violations = evaluateInternalNetwork('false', '{"com.docker.compose.network":"rap-internal"}');
      expect(violations.map((v) => v.code)).toEqual([CODES.NETWORK_NOT_ISOLATED]);
      expect(violations[0].detail).toContain('Internal=false');
    });
    test('sem labels do compose => NETWORK_UNMANAGED (drift)', () => {
      const violations = evaluateInternalNetwork('true', '{}');
      expect(violations.map((v) => v.code)).toEqual([CODES.NETWORK_UNMANAGED]);
    });
    test('internal=true + labels do compose => sem violação', () => {
      expect(evaluateInternalNetwork('true', '{"com.docker.compose.network":"rap-internal"}')).toEqual([]);
    });
  });

  describe('evaluateAttachments', () => {
    test('faltando uma das 2 redes => NETWORK_ATTACHMENT', () => {
      expect(evaluateAttachments(['rap-internal']).code).toBe(CODES.NETWORK_ATTACHMENT);
      expect(evaluateAttachments(['rap-research-egress']).code).toBe(CODES.NETWORK_ATTACHMENT);
    });
    test('nas 2 redes => sem violação', () => {
      expect(evaluateAttachments(['rap-internal', 'rap-research-egress'])).toBeNull();
    });
  });

  describe('decideOperationalProbe (NEGATIVO)', () => {
    test('probe ABERTO => MCP_E2E_OPERATIONAL_LEAK (fixture RED: asterisk 172.17.0.1:5038)', () => {
      const violation = decideOperationalProbe(ASTERISK, 'open');
      expect(violation.code).toBe(CODES.OPERATIONAL_LEAK);
      expect(violation.detail).toContain('172.17.0.1:5038');
    });
    test('probe DESCONHECIDO => violação (desconhecido não conta como isolado)', () => {
      const violation = decideOperationalProbe(ASTERISK, 'unknown');
      expect(violation.code).toBe(CODES.OPERATIONAL_LEAK);
      expect(violation.detail).toContain('não foi possível medir');
    });
    test('probe fechado => sem violação', () => {
      expect(decideOperationalProbe(ASTERISK, 'closed')).toBeNull();
    });
  });

  describe('evaluateLegacyCredential', () => {
    test('credencial legada ACEITA => MCP_E2E_AMI_LEGACY_CREDENTIAL_ACCEPTED (fixture RED)', () => {
      const violation = evaluateLegacyCredential({ reachable: true, accepted: true, host: '127.0.0.1', port: 5038 });
      expect(violation.code).toBe(CODES.LEGACY_CREDENTIAL_ACCEPTED);
      expect(violation.detail).toContain('127.0.0.1:5038');
    });
    test('alcançável mas RECUSADA => sem violação (a ACL/segredo novo está em vigor)', () => {
      expect(evaluateLegacyCredential({ reachable: true, accepted: false, host: '127.0.0.1', port: 5038 })).toBeNull();
    });
    test('inalcançável => sem violação', () => {
      expect(evaluateLegacyCredential({ reachable: false, accepted: false })).toBeNull();
    });
  });

  describe('evaluateHttpHealth', () => {
    test('200 => sem violação', () => {
      expect(evaluateHttpHealth({ reachable: true, httpStatus: 200 })).toBeNull();
    });
    test('não-200 => HEALTH_UNREACHABLE', () => {
      expect(evaluateHttpHealth({ reachable: true, httpStatus: 503 }).code).toBe(CODES.HEALTH_UNREACHABLE);
    });
    test('inalcançável => HEALTH_UNREACHABLE', () => {
      expect(evaluateHttpHealth({ reachable: false, error: 'boom' }).code).toBe(CODES.HEALTH_UNREACHABLE);
    });
  });

  describe('evaluateToolCall', () => {
    test('isError false => sem violação (execução real comprovada)', () => {
      expect(evaluateToolCall({ reachable: true, httpStatus: 200, isErrorFalse: true })).toBeNull();
    });
    test('isError não-falso => TOOL_CALL_FAILED', () => {
      expect(evaluateToolCall({ reachable: true, httpStatus: 200, isErrorFalse: false }).code).toBe(CODES.TOOL_CALL_FAILED);
    });
    test('inalcançável => TOOL_CALL_FAILED', () => {
      expect(evaluateToolCall({ reachable: false, error: 'boom' }).code).toBe(CODES.TOOL_CALL_FAILED);
    });
  });

  describe('evaluateRestartRecovery', () => {
    test('running/healthy + tools/list respondendo => sem violação', () => {
      expect(evaluateRestartRecovery({ status: 'running', health: 'healthy', toolsListReachable: true })).toEqual([]);
    });
    test('não-healthy após restart => RESTART_FAILED', () => {
      const violations = evaluateRestartRecovery({ status: 'running', health: 'starting', toolsListReachable: true });
      expect(violations.map((v) => v.code)).toEqual([CODES.RESTART_FAILED]);
    });
    test('healthy mas tools/list mudo => RESTART_FAILED (recovery do processo não é recovery do serviço)', () => {
      const violations = evaluateRestartRecovery({ status: 'running', health: 'healthy', toolsListReachable: false, toolsListError: 'timeout' });
      expect(violations.map((v) => v.code)).toEqual([CODES.RESTART_FAILED]);
      expect(violations[0].detail).toContain('tools/list');
    });
  });

  describe('buildReport / buildRequiresDockerReport', () => {
    test('zero violações => PASS', () => {
      const report = buildReport({ generatedAt: '2026-09-19T00:00:00.000Z', container: 'c', checks: {}, violations: [] });
      expect(report.status).toBe('PASS');
      expect(report.gate).toBe('MCP_RESEARCH_DOCKER_E2E');
      expect(Array.isArray(report.limitations)).toBe(true);
      expect(report.limitations.length).toBeGreaterThan(0);
    });
    test('com violação => FAIL', () => {
      const report = buildReport({
        generatedAt: '2026-09-19T00:00:00.000Z',
        container: 'c',
        checks: {},
        violations: [{ code: CODES.OPERATIONAL_LEAK, detail: 'x' }],
      });
      expect(report.status).toBe('FAIL');
    });
    test('sem docker => REQUIRES_DOCKER_RUNTIME com status explícito no relatório', () => {
      const report = buildRequiresDockerReport('2026-09-19T00:00:00.000Z');
      expect(report.status).toBe('REQUIRES_DOCKER_RUNTIME');
      expect(report.violations).toEqual([]);
      expect(report.reason).toBeTruthy();
    });
  });
});

describe('verify-mcp-research-docker-e2e-pass — verificação do seal', () => {
  const NOW = Date.parse('2026-09-19T12:00:00.000Z');

  test('relatório ausente => FAIL', () => {
    const verdict = evaluateReportForSeal(null, { nowMs: NOW });
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons[0]).toContain('ausente');
  });

  test('status FAIL => FAIL', () => {
    const verdict = evaluateReportForSeal(
      { status: 'FAIL', generatedAt: '2026-09-19T11:00:00.000Z' },
      { nowMs: NOW },
    );
    expect(verdict.ok).toBe(false);
  });

  test('REQUIRES_DOCKER_RUNTIME NÃO é prova de release => FAIL', () => {
    const verdict = evaluateReportForSeal(
      { status: 'REQUIRES_DOCKER_RUNTIME', generatedAt: '2026-09-19T11:00:00.000Z' },
      { nowMs: NOW },
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons[0]).toContain('REQUIRES_DOCKER_RUNTIME');
  });

  test('PASS mas STALE => FAIL', () => {
    const verdict = evaluateReportForSeal(
      { status: 'PASS', generatedAt: '2026-09-17T11:00:00.000Z' },
      { nowMs: NOW },
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons[0]).toContain('STALE');
  });

  test('PASS sem generatedAt => FAIL (frescor não verificável)', () => {
    const verdict = evaluateReportForSeal({ status: 'PASS' }, { nowMs: NOW });
    expect(verdict.ok).toBe(false);
  });

  test('PASS fresco => ok', () => {
    const verdict = evaluateReportForSeal(
      { status: 'PASS', generatedAt: '2026-09-19T11:30:00.000Z' },
      { nowMs: NOW },
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.reasons).toEqual([]);
  });
});
