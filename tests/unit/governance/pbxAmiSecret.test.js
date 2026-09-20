'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runChecks } = require('../../../scripts/governance/validate-pbx-ami-secret');

const GREEN_TEMPLATE = `[general]
enabled = yes
port = 5038
bindaddr = 0.0.0.0

[ragent2]
secret = \${AMI_SECRET}
read = all
write = all
deny = 0.0.0.0/0.0.0.0
permit = 127.0.0.1/255.255.255.255
permit = 172.30.0.0/16
`;

const ASTERISK_SERVICE = `  asterisk:
    environment:
      AMI_SECRET: "\${AMI_SECRET:?Erro: AMI_SECRET não definida}"
    volumes:
      - ./pbx/asterisk/etc/asterisk:/etc/asterisk-static:ro
      - type: tmpfs
        target: /etc/asterisk
        tmpfs:
          mode: 0o1777
`;

function composeWith(publishLine) {
  return `services:
  api:
    image: api
${ASTERISK_SERVICE}    ports:
      - "${publishLine}"
`;
}

function writeFixture(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function makeGreenRoot(root) {
  writeFixture(root, 'pbx/asterisk/etc/asterisk/manager.conf.template', GREEN_TEMPLATE);
  writeFixture(root, 'docker-compose.prod.yml', composeWith('${AMI_PUBLIC_BIND:-127.0.0.1}:${AMI_PUBLIC_PORT:-5038}:5038'));
  writeFixture(root, 'docker-compose.yml', composeWith('${AMI_PORT:-5038}:5038'));
  writeFixture(root, 'docker-compose.test.yml', composeWith('127.0.0.1:5038:5038'));
}

describe('validate-pbx-ami-secret (scanner gate)', () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ragent2-pbx-ami-secret-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('RED: manager.conf versionado com `secret = ragent2` reprova os dois checks de segredo', () => {
    makeGreenRoot(root);
    writeFixture(root, 'pbx/asterisk/etc/asterisk/manager.conf', GREEN_TEMPLATE.replace('secret = ${AMI_SECRET}', 'secret = ragent2'));

    const report = runChecks(root);

    expect(report.status).toBe('FAIL');
    expect(report.checks.PBX_AMI_NO_DEFAULT_SECRET.status).toBe('FAIL');
    expect(report.checks.PBX_AMI_NO_DEFAULT_SECRET.violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ file: 'pbx/asterisk/etc/asterisk/manager.conf', ruleId: 'literal-secret-value' })]),
    );
    expect(report.checks.PBX_AMI_NO_PLAINTEXT_SECRET.status).toBe('FAIL');
    expect(report.checks.PBX_AMI_ACL.status).toBe('PASS');
  });

  test('GREEN: template com ${AMI_SECRET} e composes corretos passa', () => {
    makeGreenRoot(root);

    const report = runChecks(root);

    expect(report.status).toBe('PASS');
    expect(report.checks.PBX_AMI_NO_DEFAULT_SECRET.status).toBe('PASS');
    expect(report.checks.PBX_AMI_NO_PLAINTEXT_SECRET.status).toBe('PASS');
    expect(report.checks.PBX_AMI_ACL.status).toBe('PASS');
    expect(report.warnings.some((w) => w.file === 'docker-compose.yml')).toBe(true);
  });

  test('segredo literal em arquivo allowlisted não reprova; fora da allowlist reprova', () => {
    makeGreenRoot(root);
    writeFixture(
      root,
      'scripts/governance/validate-mcp-research-docker-e2e.js',
      "const legacy = process.env.RAP_E2E_AMI_LEGACY_SECRET || 'ragent2';\n",
    );

    const allowed = runChecks(root);
    expect(allowed.checks.PBX_AMI_NO_PLAINTEXT_SECRET.status).toBe('PASS');
    expect(allowed.checks.PBX_AMI_NO_PLAINTEXT_SECRET.details.allowlistedMatches).toHaveLength(1);
    expect(allowed.checks.PBX_AMI_NO_PLAINTEXT_SECRET.details.staleAllowlist).not.toContain(
      'scripts/governance/validate-mcp-research-docker-e2e.js',
    );

    writeFixture(root, 'docs/qualquer.md', 'AMI_SECRET=ragent2\n');
    const leaked = runChecks(root);
    expect(leaked.checks.PBX_AMI_NO_PLAINTEXT_SECRET.status).toBe('FAIL');
    expect(leaked.checks.PBX_AMI_NO_PLAINTEXT_SECRET.violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ file: 'docs/qualquer.md' })]),
    );
  });

  test('ACL: permit antes do deny, permit aberto e publish solto no test reprovam', () => {
    makeGreenRoot(root);
    writeFixture(
      root,
      'pbx/asterisk/etc/asterisk/manager.conf.template',
      GREEN_TEMPLATE.replace(
        'deny = 0.0.0.0/0.0.0.0\npermit = 127.0.0.1/255.255.255.255\npermit = 172.30.0.0/16',
        'permit = 127.0.0.1/255.255.255.255\npermit = 172.30.0.0/16\npermit = 0.0.0.0/0.0.0.0\ndeny = 0.0.0.0/0.0.0.0',
      ),
    );
    writeFixture(root, 'docker-compose.test.yml', composeWith('5038:5038'));

    const report = runChecks(root);
    const acl = report.checks.PBX_AMI_ACL;

    expect(acl.status).toBe('FAIL');
    expect(acl.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: 'acl-deny-not-first' }),
        expect.objectContaining({ ruleId: 'acl-unexpected-permit' }),
        expect.objectContaining({ file: 'docker-compose.test.yml', ruleId: 'ami-publish-not-pinned' }),
      ]),
    );
  });

  test('compose sem AMI_SECRET fail-closed no serviço asterisk reprova', () => {
    makeGreenRoot(root);
    writeFixture(root, 'docker-compose.prod.yml', composeWith('${AMI_PUBLIC_BIND:-127.0.0.1}:${AMI_PUBLIC_PORT:-5038}:5038').replace('"${AMI_SECRET:?Erro: AMI_SECRET não definida}"', 'ragent2'));

    const report = runChecks(root);

    expect(report.checks.PBX_AMI_ACL.status).toBe('FAIL');
    expect(report.checks.PBX_AMI_ACL.violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ ruleId: 'ami-secret-not-fail-closed' })]),
    );
  });

  test('o repositório real passa no gate (segredo fora do versionamento)', () => {
    const report = runChecks(path.resolve(__dirname, '..', '..', '..'));

    expect(report.status).toBe('PASS');
    expect(report.checks.PBX_AMI_NO_PLAINTEXT_SECRET.details.staleAllowlist).toEqual([]);
  });
});
