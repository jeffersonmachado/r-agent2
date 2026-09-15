#!/usr/bin/env node
'use strict';

/**
 * validate-mcp-research.js — gate do container MCP Research.
 *
 * Checagens EXECUTÁVEIS (fail-closed — qualquer falha = exit 1):
 *   1. container_files          — arquivos do serviço existem;
 *   2. dockerfile_properties    — USER não-root, HEALTHCHECK, deps pinadas
 *                                 (package-lock + npm ci), sem segredos;
 *   3. compose_integration      — serviço mcp-research + redes rap-internal/
 *                                 rap-research-egress + env da API + limites;
 *   4. tool_contract_parity     — paridade 1:1 das 5 tools com
 *                                 researchCapabilities + bootstrap;
 *   5. security_controls        — wiring estático: política de endpoint,
 *                                 neutralização de injeção, OFFLINE sem egress,
 *                                 auth fail-closed, default de política estrito;
 *   6. documentation            — manifesto config/mcp-research-docs-manifest.json
 *                                 (documentos produzidos pela frente de docs);
 *   7. offline_mode_execution   — smoke real OFFLINE (snapshot fixture);
 *   8. protocol_smoke           — initialize/tools/list/tools/call reais
 *                                 em-processo + 401 sem bearer.
 *
 * Saída: reports/mcp-research-report.json
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const REPORT = path.join(ROOT, 'reports', 'mcp-research-report.json');
const SERVICE_DIR = path.join(ROOT, 'services', 'mcp-research');
const COMPOSE_FILE = path.join(ROOT, 'docker-compose.prod.yml');
const DOCS_MANIFEST = path.join(ROOT, 'config', 'mcp-research-docs-manifest.json');
const GATE_SMOKE = path.join(ROOT, 'scripts', 'governance', 'mcp-research-gate-smoke.js');

function read(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return null;
  }
}

function checkContainerFiles() {
  const required = [
    'Dockerfile', 'package.json', 'package-lock.json', 'README.md',
    'src/index.js', 'src/config.js', 'src/httpServer.js', 'src/mcpServer.js',
    'src/researchTools.js', 'src/snapshotStore.js', 'src/auth.js', 'src/logger.js',
  ];
  const missing = required.filter((rel) => !fs.existsSync(path.join(SERVICE_DIR, rel)));
  return { ok: missing.length === 0, missing };
}

function checkDockerfile() {
  const source = read(path.join(SERVICE_DIR, 'Dockerfile'));
  if (!source) return { ok: false, reason: 'dockerfile_missing' };
  const failures = [];

  const userLines = source.split('\n').filter((line) => /^\s*USER\s+/m.test(line));
  if (userLines.length === 0) failures.push('missing USER directive');
  if (/^\s*USER\s+(root|0)\s*$/m.test(source)) failures.push('USER root proibido');
  if (!/^\s*HEALTHCHECK\s+/m.test(source)) failures.push('missing HEALTHCHECK');
  if (!/npm ci --omit=dev/.test(source)) failures.push('deps não pinadas (npm ci --omit=dev ausente)');
  if (!fs.existsSync(path.join(SERVICE_DIR, 'package-lock.json'))) failures.push('package-lock.json ausente');
  // Segredos: nenhum valor literal de token/senha/chave na imagem.
  if (/(TOKEN|PASSWORD|SECRET|API[_-]?KEY)\s*[=:]\s*["']?[A-Za-z0-9+/=_-]{8,}/i.test(source)) {
    failures.push('possível segredo literal no Dockerfile');
  }
  if (/COPY\s+.*\.env/i.test(source)) failures.push('COPY de .env proibido');
  return { ok: failures.length === 0, failures };
}

function checkComposeIntegration() {
  const source = read(COMPOSE_FILE);
  if (!source) return { ok: false, reason: 'compose_missing' };
  const failures = [];
  const expectations = [
    [/^\s{2}mcp-research:/m, 'serviço mcp-research ausente'],
    [/^\s{2}rap-internal:\n\s+driver: bridge\n\s+internal: true/m, 'rede rap-internal (internal:true) ausente'],
    [/^\s{2}rap-research-egress:\n\s+driver: bridge/m, 'rede rap-research-egress ausente'],
    [/MCP_RESEARCH_ENDPOINT:/, 'MCP_RESEARCH_ENDPOINT ausente na API'],
    [/MCP_RESEARCH_TOKEN:/, 'MCP_RESEARCH_TOKEN ausente'],
    [/r-agent2-research-snapshots:\/snapshots:ro/, 'volume de snapshot read-only ausente'],
  ];
  for (const [pattern, message] of expectations) {
    if (!pattern.test(source)) failures.push(message);
  }

  const serviceBlock = source.match(/^\s{2}mcp-research:([\s\S]*?)(?=^\s{2}\S)/m);
  if (!serviceBlock) {
    failures.push('bloco do serviço mcp-research não isolado');
  } else {
    const block = serviceBlock[1];
    if (!/healthcheck:/.test(block)) failures.push('healthcheck ausente no serviço');
    if (!/restart: unless-stopped/.test(block)) failures.push('restart policy ausente');
    if (!/limits:[\s\S]*memory:/.test(block)) failures.push('resource limits ausentes');
    if (!/rap-internal/.test(block) || !/rap-research-egress/.test(block)) {
      failures.push('serviço não está nas duas redes (rap-internal + rap-research-egress)');
    }
    if (/r-agent2-network/.test(block)) {
      failures.push('serviço NÃO pode estar em r-agent2-network (alcançaria postgres/redis)');
    }
    if (/ports:/.test(block)) failures.push('serviço não pode publicar porta no host (expose only)');
  }
  return { ok: failures.length === 0, failures };
}

function checkToolContractParity() {
  try {
    const { TOOL_DEFINITIONS, TOOL_CAPABILITY_MAP } = require('../../services/mcp-research/src/researchTools');
    const { RESEARCH_CAPABILITIES } = require('../../api/services/benchmark/researchCapabilities');
    const { RESEARCH_TOOLS } = require('../../api/services/mcp/registerMcpResearchConnection');

    const capabilityIds = RESEARCH_CAPABILITIES.map((c) => c.capability).sort();
    const toolNames = TOOL_DEFINITIONS.map((t) => t.name).sort();
    const mapCapabilities = Object.values(TOOL_CAPABILITY_MAP).sort();
    const bootstrapNames = RESEARCH_TOOLS.map((t) => t.name).sort();
    const bootstrapCapabilities = RESEARCH_TOOLS.map((t) => t.capability).sort();

    const failures = [];
    if (toolNames.length !== 5) failures.push(`tools != 5 (${toolNames.length})`);
    if (JSON.stringify(mapCapabilities) !== JSON.stringify(capabilityIds)) {
      failures.push('TOOL_CAPABILITY_MAP não é 1:1 com researchCapabilities');
    }
    if (JSON.stringify(bootstrapNames) !== JSON.stringify(toolNames)) {
      failures.push('bootstrap RESEARCH_TOOLS diverge das tools do container');
    }
    if (JSON.stringify(bootstrapCapabilities) !== JSON.stringify(capabilityIds)) {
      failures.push('bootstrap capabilities divergem de researchCapabilities');
    }
    for (const tool of TOOL_DEFINITIONS) {
      if (!tool.inputSchema || tool.inputSchema.type !== 'object') {
        failures.push(`inputSchema ausente em ${tool.name}`);
      }
    }
    return { ok: failures.length === 0, failures, tools: toolNames };
  } catch (error) {
    return { ok: false, failures: [error.message] };
  }
}

function checkSecurityControls() {
  const failures = [];
  const tools = read(path.join(SERVICE_DIR, 'src', 'researchTools.js')) || '';
  const config = read(path.join(SERVICE_DIR, 'src', 'config.js')) || '';
  const http = read(path.join(SERVICE_DIR, 'src', 'httpServer.js')) || '';
  const provider = read(path.join(ROOT, 'api', 'services', 'research', 'nativeResearchProvider.js')) || '';

  // Reuso (não fork) dos engines provados.
  if (!tools.includes("require('../../../api/services/research/nativeResearchProvider')")) {
    failures.push('container não reusa nativeResearchProvider');
  }
  if (!tools.includes("require('../../../api/services/askAi/injectionGuard')")) {
    failures.push('container não neutraliza injeção (injectionGuard)');
  }
  if (!provider.includes('endpointPolicyOverrides')) {
    failures.push('provider sem passthrough de política (wiring ausente)');
  }
  // OFFLINE sem egress.
  if (!tools.includes('research_offline_egress_forbidden')) {
    failures.push('sentinela de egress OFFLINE ausente');
  }
  // Auth fail-closed.
  if (!config.includes('MCP_RESEARCH_TOKEN ausente')) {
    failures.push('config não é fail-closed sem token');
  }
  // Default de política ESTRITO: exceções só com env explícita === 'true'.
  if (!/allowPrivateNetwork\s*=\s*source\.MCP_RESEARCH_ALLOW_PRIVATE_NETWORK === 'true'/.test(config)) {
    failures.push('default de allowPrivateNetwork não é estrito');
  }
  if (!/allowPlaintextHttp\s*=\s*source\.MCP_RESEARCH_ALLOW_PLAINTEXT_HTTP === 'true'/.test(config)) {
    failures.push('default de allowPlaintextHttp não é estrito');
  }
  // Fronteira autenticada antes do /mcp.
  if (!http.includes('isAuthorized(req, config.authToken)')) {
    failures.push('fronteira de auth ausente no HTTP server');
  }
  // TLS: nunca rejectUnauthorized=false no código do container.
  const allSources = ['src/index.js', 'src/config.js', 'src/httpServer.js', 'src/mcpServer.js', 'src/researchTools.js', 'src/snapshotStore.js', 'src/auth.js']
    .map((rel) => read(path.join(SERVICE_DIR, rel)) || '')
    .join('\n');
  if (/rejectUnauthorized\s*:\s*false/.test(allSources)) {
    failures.push('rejectUnauthorized:false proibido no container');
  }
  return { ok: failures.length === 0, failures };
}

function checkDocumentation() {
  const raw = read(DOCS_MANIFEST);
  if (!raw) return { ok: false, missing: ['config/mcp-research-docs-manifest.json'] };
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (error) {
    return { ok: false, missing: [`manifest inválido: ${error.message}`] };
  }
  const documents = Array.isArray(manifest.documents) ? manifest.documents : [];
  if (documents.length === 0) return { ok: false, missing: ['manifest sem documentos'] };
  const missing = documents.filter((rel) => !fs.existsSync(path.join(ROOT, rel)));
  return { ok: missing.length === 0, missing, documents };
}

function checkProtocolSmoke() {
  try {
    const output = execFileSync(process.execPath, [GATE_SMOKE], { encoding: 'utf8', timeout: 60000 });
    const parsed = JSON.parse(output.trim());
    if (!parsed.ok) {
      return { ok: false, failures: [`smoke falhou: ${JSON.stringify(parsed)}`] };
    }
    const checks = parsed.checks || {};
    return {
      offline: { ok: checks.offlineFetch === true && checks.snapshotMissTyped === true, checks },
      protocol: {
        ok: checks.health === true && checks.initialize === true
          && checks.toolsList === true && checks.unauthorizedRejected === true,
        checks,
      },
    };
  } catch (error) {
    const detail = error.stdout ? String(error.stdout).slice(-500) : error.message;
    return { ok: false, offline: { ok: false }, protocol: { ok: false }, failures: [`smoke exec falhou: ${detail}`] };
  }
}

function main() {
  const checks = {
    container_files: checkContainerFiles(),
    dockerfile_properties: checkDockerfile(),
    compose_integration: checkComposeIntegration(),
    tool_contract_parity: checkToolContractParity(),
    security_controls: checkSecurityControls(),
    documentation: checkDocumentation(),
  };
  const smoke = checkProtocolSmoke();
  checks.offline_mode_execution = smoke.offline || { ok: false };
  checks.protocol_smoke = smoke.protocol || { ok: false };

  const failed = Object.entries(checks).filter(([, result]) => result.ok !== true);
  const report = {
    status: failed.length === 0 ? 'PASS' : 'FAIL',
    decision: failed.length === 0 ? 'MCP_RESEARCH_CONTAINER_VERIFIED' : 'MCP_RESEARCH_CONTAINER_GAP',
    generatedAt: new Date().toISOString(),
    artifactType: 'mcp-research-report',
    artifactVersion: '1.0.0',
    checks,
    failedChecks: failed.map(([name]) => name),
  };

  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);

  if (failed.length > 0) {
    console.error(`[mcp-research] FALHA: ${failed.map(([name]) => name).join(', ')}`);
    console.error(`[mcp-research] relatório: ${path.relative(ROOT, REPORT)}`);
    process.exit(1);
  }
  console.log(`[mcp-research] PASS — relatório em ${path.relative(ROOT, REPORT)}`);
}

main();
