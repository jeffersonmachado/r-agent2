#!/usr/bin/env node
'use strict';

/**
 * validate-pbx-ami-secret.js — GATE bloqueante: o segredo do AMI (controle do
 * PBX) não pode existir como literal/default versionado.
 *
 * Contexto: `secret = ragent2` viveu versionado em
 * pbx/asterisk/etc/asterisk/manager.conf com read/write=all e, somado à
 * exposição do AMI, deu controle total do PBX a partir de um container de
 * pesquisa (AI_MEMORY/security-finding-pbx-ami-exposure.md, 2026-09-19). O
 * mecanismo vigente: o manager.conf NÃO é versionado — nasce renderizado de
 * pbx/asterisk/etc/asterisk/manager.conf.template por
 * pbx/asterisk/asterisk-start.sh (envsubst '$AMI_SECRET') no /etc/asterisk
 * gravável (tmpfs do compose), com segredo e ACL no MESMO bloco.
 *
 * Checks:
 *   PBX_AMI_NO_DEFAULT_SECRET    nenhum `secret = <literal>` funcional em
 *                                pbx/ versionado (placeholder ${...} é ok);
 *                                o template existe e usa ${AMI_SECRET}.
 *   PBX_AMI_NO_PLAINTEXT_SECRET  varredura por 'ragent2' como valor de
 *                                secret/AMI_SECRET em TODOS os arquivos
 *                                versionados, com allowlist explícita e
 *                                justificada (ver ALLOWLIST).
 *   PBX_AMI_ACL                  o template mantém `deny 0.0.0.0/0` ANTES dos
 *                                permits (primeira correspondência decide) e
 *                                só permite 127.0.0.1/32 + a rede da plataforma
 *                                via ${AMI_ACL_PLATFORM_NET} (mesma variável
 *                                que fixa a subnet nos composes — literal fixo
 *                                divergiu da subnet atribuída pelo docker e
 *                                derrubou a própria API, medido 2026-09-20); o
 *                                serviço asterisk nos 3 compose recebe
 *                                AMI_SECRET fail-closed, monta o config
 *                                estático em /etc/asterisk-static (ro) e tem
 *                                tmpfs em /etc/asterisk; a publicação do AMI
 *                                é fail-closed (127.0.0.1) em prod e test.
 *
 * Saída: reports/pbx-ami-secret-report.json
 * Uso: node scripts/governance/validate-pbx-ami-secret.js [--json]
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const REPORT_PATH = path.join(ROOT_DIR, 'reports', 'pbx-ami-secret-report.json');

const TEMPLATE_REL = 'pbx/asterisk/etc/asterisk/manager.conf.template';
const COMPOSE_FILES = ['docker-compose.prod.yml', 'docker-compose.yml', 'docker-compose.test.yml'];

/**
 * Arquivos onde 'ragent2' como valor de secret/AMI_SECRET é ESPERADO e
 * auditado. Cada entrada precisa de justificativa; se o arquivo deixar de ter
 * o padrão, a entrada vira `staleAllowlist` (warning de higiene).
 */
const ALLOWLIST = {
  'AI_MEMORY/security-finding-pbx-ami-exposure.md':
    'doc forense do incidente: registra a credencial vazada como evidência histórica',
  'scripts/governance/validate-mcp-research-docker-e2e.js':
    'default do TESTE NEGATIVO: o gate precisa conhecer a credencial legada para provar que ela NÃO autentica mais',
  'tests/unit/governance/pbxAmiSecret.test.js':
    'TESTE NEGATIVO do gate MCP/docker-e2e: a fixture precisa da credencial legada para provar que ela é REJEITADA',
  'api/services/asterisk/amiClient.js':
    'comentário histórico do fail-closed + default de AMI_USERNAME (usuário não é segredo)',
};

/** Padrões de 'ragent2' USADO COMO SEGREDO (não como nome de usuário/seção). */
const SECRET_VALUE_PATTERNS = [
  { id: 'asterisk-conf-secret', re: /^[ \t]*secret[ \t]*=[ \t]*['"]?ragent2['"]?[ \t]*$/ },
  { id: 'env-yaml-ami-secret', re: /\bAMI_SECRET\b[ \t]*[:=][ \t]*['"]?ragent2['"]?[ \t]*$/ },
  // sem \b inicial: cobre AMI_LEGACY_SECRET (default do teste negativo do gate MCP)
  { id: 'js-fallback-ami-secret', re: /AMI[A-Z_]*SECRET['"]?[ \t]*\|\|[ \t]*['"]ragent2['"]/ },
  // sem \b inicial: o doc forense tem o valor legado colado após "Secret:"
  // na mesma linha (quebra de linha literal \r\n no meio da frase)
  { id: 'ami-protocol-secret', re: /Secret:[ \t]*ragent2\b/ },
];

const EXPECTED_PERMITS = ['127.0.0.1/255.255.255.255', '${AMI_ACL_PLATFORM_NET}'];

function gitCommit(rootDir) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

/** Arquivos versionados (git ls-files); fora de um repo git, walk do FS. */
function collectFiles(rootDir) {
  try {
    const out = execFileSync('git', ['ls-files', '-z'], { cwd: rootDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\0').filter(Boolean).sort();
  } catch {
    const files = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile()) files.push(path.relative(rootDir, full).split(path.sep).join('/'));
      }
    };
    walk(rootDir);
    return files.sort();
  }
}

function readTextFile(rootDir, rel) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(rootDir, rel));
  } catch {
    return null; // ex.: deleção ainda não commitada — o arquivo não existe mais na worktree
  }
  if (raw.length > 1024 * 1024) return null;
  if (raw.subarray(0, 8192).includes(0)) return null; // binário
  return raw.toString('utf8');
}

/** Bloco YAML de um serviço compose (indentação de 2 espaços). */
function serviceBlock(content, service) {
  const lines = String(content).split('\n');
  const start = lines.findIndex((l) => new RegExp(`^  ${service}:\\s*$`).test(l));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^  \S/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start, end).join('\n');
}

/** Linhas da seção [name] de um arquivo .conf estilo Asterisk. */
function confSection(content, name) {
  const lines = String(content).split(/\r?\n/);
  const section = [];
  let inside = false;
  for (const line of lines) {
    const header = line.match(/^\s*\[([^\]]+)\]/);
    if (header) {
      if (inside) break;
      inside = header[1].trim() === name;
      continue;
    }
    if (inside) section.push(line);
  }
  return section;
}

function checkNoDefaultSecret(files, rootDir) {
  const violations = [];
  for (const rel of files) {
    if (!rel.startsWith('pbx/')) continue;
    const content = readTextFile(rootDir, rel);
    if (content === null) continue;
    content.split(/\r?\n/).forEach((line, idx) => {
      const match = line.match(/^\s*secret\s*=\s*(\S+)/);
      if (match && !match[1].includes('${')) {
        violations.push({ file: rel, line: idx + 1, ruleId: 'literal-secret-value', match: 'secret = <literal>' });
      }
    });
  }

  const template = readTextFile(rootDir, TEMPLATE_REL);
  const details = { template: TEMPLATE_REL };
  if (template === null) {
    violations.push({ file: TEMPLATE_REL, ruleId: 'template-missing', match: 'manager.conf.template não existe' });
  } else if (!/^\s*secret\s*=\s*\$\{AMI_SECRET\}\s*$/m.test(template)) {
    violations.push({ file: TEMPLATE_REL, ruleId: 'template-without-placeholder', match: 'template sem `secret = ${AMI_SECRET}`' });
  } else {
    details.templateHasPlaceholder = true;
  }

  return { status: violations.length === 0 ? 'PASS' : 'FAIL', violations, details };
}

function checkNoPlaintextSecret(files, rootDir) {
  const violations = [];
  const allowlistedMatches = [];
  for (const rel of files) {
    const content = readTextFile(rootDir, rel);
    if (content === null) continue;
    content.split(/\r?\n/).forEach((line, idx) => {
      for (const pattern of SECRET_VALUE_PATTERNS) {
        if (!pattern.re.test(line)) continue;
        const hit = { file: rel, line: idx + 1, ruleId: pattern.id, match: line.trim().slice(0, 120) };
        if (Object.prototype.hasOwnProperty.call(ALLOWLIST, rel)) allowlistedMatches.push(hit);
        else violations.push(hit);
        break; // um padrão por linha basta
      }
    });
  }

  const staleAllowlist = Object.keys(ALLOWLIST).filter(
    (rel) => !allowlistedMatches.some((hit) => hit.file === rel),
  );

  return {
    status: violations.length === 0 ? 'PASS' : 'FAIL',
    violations,
    details: { allowlistedMatches, staleAllowlist, patterns: SECRET_VALUE_PATTERNS.map((p) => p.id) },
  };
}

function checkAcl(rootDir) {
  const violations = [];
  const warnings = [];
  const details = { expectedPermits: EXPECTED_PERMITS };

  const template = readTextFile(rootDir, TEMPLATE_REL);
  if (template === null) {
    violations.push({ file: TEMPLATE_REL, ruleId: 'template-missing', match: 'sem template, ACL não pode ser verificada' });
  } else {
    const section = confSection(template, 'ragent2');
    if (section.length === 0) {
      violations.push({ file: TEMPLATE_REL, ruleId: 'ami-user-section-missing', match: 'seção [ragent2] ausente no template' });
    } else {
      const acl = section
        .map((line) => line.match(/^\s*(deny|permit)\s*=\s*(\S+)/))
        .filter(Boolean)
        .map((m) => ({ kind: m[1], value: m[2] }));
      const first = acl[0];
      if (!first || first.kind !== 'deny' || !/^0\.0\.0\.0\/0(\.0\.0\.0)?$/.test(first.value)) {
        violations.push({
          file: TEMPLATE_REL, ruleId: 'acl-deny-not-first',
          match: 'a PRIMEIRA linha de ACL tem de ser `deny = 0.0.0.0/0.0.0.0` (primeira correspondência decide)',
        });
      }
      const permits = acl.filter((e) => e.kind === 'permit').map((e) => e.value);
      details.permits = permits;
      for (const permit of permits) {
        if (!EXPECTED_PERMITS.includes(permit)) {
          violations.push({ file: TEMPLATE_REL, ruleId: 'acl-unexpected-permit', match: `permit = ${permit}` });
        }
      }
      for (const expected of EXPECTED_PERMITS) {
        if (!permits.includes(expected)) {
          violations.push({ file: TEMPLATE_REL, ruleId: 'acl-missing-permit', match: `permit ${expected} ausente` });
        }
      }
    }
  }

  details.compose = {};
  for (const composeFile of COMPOSE_FILES) {
    const content = readTextFile(rootDir, composeFile);
    if (content === null) {
      violations.push({ file: composeFile, ruleId: 'compose-missing', match: 'compose não encontrado' });
      continue;
    }
    const block = serviceBlock(content, 'asterisk');
    const fileDetails = {};
    if (block === null) {
      violations.push({ file: composeFile, ruleId: 'asterisk-service-missing', match: 'serviço asterisk não encontrado' });
    } else {
      if (!/AMI_SECRET:\s*["']?\$\{AMI_SECRET:\?/.test(block)) {
        violations.push({ file: composeFile, ruleId: 'ami-secret-not-fail-closed', match: 'serviço asterisk sem `AMI_SECRET: ${AMI_SECRET:?...}`' });
      }
      if (!block.includes('etc/asterisk:/etc/asterisk-static:ro')) {
        violations.push({ file: composeFile, ruleId: 'static-config-not-shadowed', match: 'config estático não montado em /etc/asterisk-static:ro' });
      }
      if (!/type:\s*tmpfs\s*\n\s*target:\s*\/etc\/asterisk/.test(block) || !/tmpfs:\s*\n\s*mode:\s*0o1777/.test(block)) {
        violations.push({ file: composeFile, ruleId: 'tmpfs-missing', match: 'sem tmpfs mode 1777 em /etc/asterisk (manager.conf renderizado precisa de destino gravável pelo usuário asterisk)' });
      }
      fileDetails.amiSecretFailClosed = true;
    }

    const amiPublishLines = (block || '').split('\n').filter((l) => /^\s*-\s+.*5038/.test(l));
    for (const line of amiPublishLines) {
      if (!line.includes('127.0.0.1') && !line.includes('AMI_PUBLIC_BIND')) {
        const hit = { file: composeFile, ruleId: 'ami-publish-not-pinned', match: line.trim() };
        if (composeFile === 'docker-compose.yml') {
          // dev local: ACL por origem segue em vigor; pin recomendado, não bloqueante
          warnings.push({ ...hit, note: 'dev publica o AMI em 0.0.0.0 do host; a ACL é a defesa em vigor' });
        } else {
          violations.push(hit);
        }
      }
    }
    details.compose[composeFile] = fileDetails;
  }

  return { status: violations.length === 0 ? 'PASS' : 'FAIL', violations, warnings, details };
}

function runChecks(rootDir) {
  const root = path.resolve(rootDir);
  const files = collectFiles(root);
  const checks = {
    PBX_AMI_NO_DEFAULT_SECRET: checkNoDefaultSecret(files, root),
    PBX_AMI_NO_PLAINTEXT_SECRET: checkNoPlaintextSecret(files, root),
    PBX_AMI_ACL: checkAcl(root),
  };
  const status = Object.values(checks).every((c) => c.status === 'PASS') ? 'PASS' : 'FAIL';
  return {
    reportType: 'pbx-ami-secret',
    generatedAt: new Date().toISOString(),
    commit: gitCommit(root),
    status,
    decision: status === 'PASS' ? 'AMI_SECRET_OUT_OF_VERSIONING' : 'AMI_SECRET_EXPOSED',
    filesScanned: files.length,
    checks,
    allowlist: ALLOWLIST,
    warnings: checks.PBX_AMI_ACL.warnings || [],
  };
}

function main() {
  const report = runChecks(ROOT_DIR);
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const summary = Object.entries(report.checks)
      .map(([name, check]) => `${name}:${check.status}`)
      .join(' ');
    process.stdout.write(`[pbx-ami-secret] status=${report.status} ${summary} arquivos=${report.filesScanned}\n`);
    for (const [name, check] of Object.entries(report.checks)) {
      for (const violation of (check.violations || []).slice(0, 40)) {
        process.stdout.write(`  ! ${name} ${violation.file}${violation.line ? `:${violation.line}` : ''} ${violation.ruleId} ${violation.match}\n`);
      }
    }
    for (const warning of report.warnings) {
      process.stdout.write(`  ~ warning ${warning.file}: ${warning.match} (${warning.note})\n`);
    }
  }

  process.exit(report.status === 'PASS' ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = { runChecks, collectFiles, confSection, serviceBlock, ALLOWLIST, REPORT_PATH, ROOT_DIR };
