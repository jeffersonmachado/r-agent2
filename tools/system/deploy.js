#!/usr/bin/env node
'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { findLatestReleaseArtifact, extractArtifact, resolveExtractedRoot } = require('./lib/release-artifact');
const { runtimeAwarePath, resolveWorkspacePath } = require('./lib/runtime-paths');
const {
  buildQaWavesEnterpriseGovernance,
  validateQaWavesEnterpriseGovernance,
  writeQaWavesEnterpriseGovernanceWithMirror,
} = require('./lib/qa-waves-enterprise-governance-bridge');

const ROOT = path.join(__dirname, '..', '..');
const DEPLOY_REPORT_PATH = runtimeAwarePath(ROOT, 'qa/deploy-report.json', 'SYSTEM_DEPLOY_REPORT_PATH');
const QA_WAVES_ENTERPRISE_GOVERNANCE_PATH = runtimeAwarePath(ROOT, 'qa/qa-waves-enterprise-governance.json', 'QA_WAVES_ENTERPRISE_GOVERNANCE_PATH');
const QA_WAVES_GOVERNANCE_AUDIT_PATH = runtimeAwarePath(ROOT, 'qa/qa-waves-governance-audit.jsonl', 'QA_WAVES_GOVERNANCE_AUDIT_PATH');
const WORKSPACE_QA_WAVES_ENTERPRISE_GOVERNANCE_PATH = path.join(ROOT, 'qa', 'qa-waves-enterprise-governance.json');
const WORKSPACE_QA_WAVES_GOVERNANCE_AUDIT_PATH = path.join(ROOT, 'qa', 'qa-waves-governance-audit.jsonl');
const PORT_SPECS = [
  {
    service: 'api',
    envVar: 'API_PUBLIC_PORT',
    containerName: 'r-agent2-api-prod',
    internalPort: '3000/tcp',
    defaultPort: 3001,
    candidates: [3001, 3101, 3201, 3301, 3401],
  },
  {
    service: 'frontend',
    envVar: 'FRONTEND_PORT',
    containerName: 'r-agent2-frontend-prod',
    internalPort: '80/tcp',
    defaultPort: 8086,
    candidates: [8086, 8186, 8286, 8386, 8486],
  },
  {
    service: 'rag-service',
    envVar: 'RAG_PORT',
    containerName: 'r-agent2-rag-service-prod',
    internalPort: '8000/tcp',
    defaultPort: 8002,
    candidates: [8002, 8102, 8202, 8302, 8402],
  },
  {
    service: 'postgres',
    envVar: 'POSTGRES_PUBLIC_PORT',
    containerName: 'r-agent2-postgres-prod',
    internalPort: '5432/tcp',
    defaultPort: 5433,
    candidates: [5433, 5533, 5633, 5733, 5833],
  },
  {
    service: 'redis',
    envVar: 'REDIS_PORT',
    containerName: 'r-agent2-redis-prod',
    internalPort: '6379/tcp',
    defaultPort: 6380,
    candidates: [6380, 6480, 6580, 6680, 6780],
  },
  {
    service: 'asterisk-ami',
    envVar: 'AMI_PUBLIC_PORT',
    containerName: 'r-agent2-asterisk-prod',
    internalPort: '5038/tcp',
    defaultPort: 5038,
    candidates: [5038, 5138, 5238, 5338, 5438],
  },
];

function run(command, label, cwd = ROOT, env = process.env) {
  // eslint-disable-next-line no-console
  console.log(`[system:deploy] ${label}`);
  execSync(command, {
    cwd,
    stdio: 'inherit',
    env,
  });
}

function writeReport(report) {
  const absPath = resolveWorkspacePath(ROOT, DEPLOY_REPORT_PATH);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function tryExec(command, cwd = ROOT) {
  try {
    return execSync(command, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      env: process.env,
    }).trim();
  } catch {
    return null;
  }
}

function inspectExistingPublicPort(spec) {
  const template = `'{{.State.Status}} {{range $p, $bindings := .NetworkSettings.Ports}}{{if eq $p "${spec.internalPort}"}}{{if $bindings}}{{(index $bindings 0).HostPort}}{{end}}{{end}}{{end}}'`;
  const command = `docker inspect --format ${template} ${spec.containerName}`;
  const output = tryExec(command);
  if (!output) {
    return null;
  }
  const [status, portValue] = output.split(/\s+/, 2);
  const port = Number(portValue);
  if (!status || !Number.isInteger(port) || port <= 0) {
    return null;
  }
  if (!['running', 'created', 'restarting'].includes(String(status).toLowerCase())) {
    return null;
  }
  return port;
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => resolve(false));
    server.listen({ host: '0.0.0.0', port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function resolvePublicPort(spec) {
  const explicitPort = Number(process.env[spec.envVar] || 0);
  if (Number.isInteger(explicitPort) && explicitPort > 0) {
    return {
      service: spec.service,
      envVar: spec.envVar,
      selectedPort: explicitPort,
      strategy: 'explicit_env',
      candidates: [explicitPort],
    };
  }

  const existingPort = inspectExistingPublicPort(spec);
  if (Number.isInteger(existingPort) && existingPort > 0) {
    // eslint-disable-next-line no-console
    console.log(`[system:deploy] Reutilizando ${spec.envVar}=${existingPort} do container existente ${spec.containerName}`);
    return {
      service: spec.service,
      envVar: spec.envVar,
      selectedPort: existingPort,
      strategy: 'reuse_existing_container',
      candidates: [existingPort],
    };
  }

  const checked = [];
  for (const candidate of spec.candidates) {
    checked.push(candidate);
    if (await isPortAvailable(candidate)) {
      const strategy = candidate === spec.defaultPort ? 'default_free' : 'fallback_free';
      if (candidate !== spec.defaultPort) {
        // eslint-disable-next-line no-console
        console.log(`[system:deploy] ${spec.envVar}=${spec.defaultPort} indisponível; usando porta alternativa explícita ${candidate}`);
      }
      return {
        service: spec.service,
        envVar: spec.envVar,
        selectedPort: candidate,
        strategy,
        candidates: checked,
      };
    }
  }

  throw new Error(`${spec.envVar.toLowerCase()}_unavailable:${checked.join(',')}`);
}

async function resolvePortBindings() {
  const resolutions = [];
  for (const spec of PORT_SPECS) {
    resolutions.push(await resolvePublicPort(spec));
  }
  return resolutions;
}

function findLatestApprovedArtifact() {
  return findLatestReleaseArtifact({
    requireAuditPassed: true,
    requireGoNoGoGo: true,
  });
}

async function main() {
  const qaWavesReport = writeQaWavesEnterpriseGovernanceWithMirror(
    buildQaWavesEnterpriseGovernance({ root: ROOT }),
    resolveWorkspacePath(ROOT, QA_WAVES_ENTERPRISE_GOVERNANCE_PATH),
    resolveWorkspacePath(ROOT, QA_WAVES_GOVERNANCE_AUDIT_PATH),
    {
      workspaceMirrorPath: WORKSPACE_QA_WAVES_ENTERPRISE_GOVERNANCE_PATH,
      workspaceAuditPath: WORKSPACE_QA_WAVES_GOVERNANCE_AUDIT_PATH,
    }
  );
  const qaWavesValidation = validateQaWavesEnterpriseGovernance(qaWavesReport);
  if (!qaWavesValidation.valid) {
    throw new Error(`qa_waves_deployment_governance_blocked:${qaWavesValidation.reasons.join(',')}`);
  }

  const artifact = findLatestApprovedArtifact();
  const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r-agent2-deploy-'));
  extractArtifact(artifact.zipPath, extractDir);
  const artifactRoot = resolveExtractedRoot(extractDir);
  const report = {
    startedAt: new Date().toISOString(),
    status: 'running',
    artifact: {
      name: artifact.zip,
      sha256: artifact.manifest.sha256 || null,
    },
    artifactRoot,
    qaWavesGovernance: {
      path: QA_WAVES_ENTERPRISE_GOVERNANCE_PATH,
      status: qaWavesReport.governanceStatus,
      operationalConfidence: qaWavesReport.operationalConfidence,
      confidenceGrade: qaWavesReport.confidenceGrade,
      riskLevel: qaWavesReport.riskLevel,
      deploymentSafety: qaWavesReport.deploymentSafety,
    },
    portResolution: [],
  };

  // eslint-disable-next-line no-console
  console.log(`[system:deploy] Artefato aprovado: ${artifact.zip}${artifact.manifest.sha256 ? ` (sha256: ${artifact.manifest.sha256.slice(0, 16)}...)` : ''}`);
  // eslint-disable-next-line no-console
  console.log(`[system:deploy] Origem do deploy: dist/${artifact.zip} -> ${artifactRoot}`);

  const portResolution = await resolvePortBindings();
  report.portResolution = portResolution;
  const deployEnv = {
    ...process.env,
  };
  for (const resolution of portResolution) {
    deployEnv[resolution.envVar] = String(resolution.selectedPort);
  }

  const executeDeploy = String(process.env.SYSTEM_DEPLOY_EXECUTE || '0') === '1';
  if (!executeDeploy) {
    report.status = 'dry-run';
    report.finishedAt = new Date().toISOString();
    writeReport(report);
    // eslint-disable-next-line no-console
    console.log('[system:deploy] Modo dry-run (SYSTEM_DEPLOY_EXECUTE=0). Nenhuma alteração em infraestrutura foi aplicada.');
    // eslint-disable-next-line no-console
    console.log('[system:deploy] Para executar deploy real: SYSTEM_DEPLOY_EXECUTE=1 npm run system:deploy');
    return;
  }

  run('npm run deploy:build', 'Construindo imagens a partir do artefato extraído', artifactRoot, deployEnv);
  run('npm run deploy:up', 'Executando deploy a partir do artefato extraído', artifactRoot, deployEnv);
  run('npm run deploy:status', 'Validando status do deploy', artifactRoot, deployEnv);
  report.status = 'pass';
  report.finishedAt = new Date().toISOString();
  writeReport(report);
}

if (require.main === module) {
  main()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      const report = {
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        status: 'fail',
        error: error.message || String(error),
      };
      try {
        writeReport(report);
      } catch {}
      // eslint-disable-next-line no-console
      console.error(`[system:deploy] FAIL: ${error.message || error}`);
      process.exit(1);
    });
}
