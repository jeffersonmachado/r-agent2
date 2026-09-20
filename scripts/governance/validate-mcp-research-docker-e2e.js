#!/usr/bin/env node
'use strict';

/**
 * validate-mcp-research-docker-e2e.js — gate MCP_RESEARCH_DOCKER_E2E.
 *
 * Diferente de `validate:mcp-research` (compose_integration), que lê o TEXTO do
 * docker-compose.prod.yml e confere se as redes estão DECLARADAS. Texto correto
 * não é runtime correto, e a divergência entre os dois é silenciosa — foi
 * exatamente o que a medição de 2026-09-19 encontrou:
 *
 *   docker-compose.prod.yml  rap-internal: driver: bridge, internal: true
 *   docker network inspect   rap-internal  Internal=false, labels={}
 *
 * A rede em execução foi criada MANUALMENTE (sem `--internal`, sem labels do
 * compose) e o compose a reutilizou por nome. Resultado: o controle de
 * isolamento declarado NÃO estava em vigor. O que impedia o container de
 * pesquisa de alcançar Postgres/Redis era o isolamento padrão entre bridges do
 * Docker — um efeito colateral, não o controle projetado. Bastaria um
 * `docker network connect` para expor o serviço, e nada acusaria.
 *
 * Este gate mede o RUNTIME:
 *   1. Docker indisponível           -> REQUIRES_DOCKER_RUNTIME (não é falha;
 *      o SEAL é quem exige o relatório com status PASS — ver seal-release.sh)
 *   2. container ausente/doente      -> VIOLATION
 *   3. rap-internal não isolada      -> VIOLATION (controle declarado inerte)
 *   4. rap-internal não gerenciada   -> VIOLATION (drift de infraestrutura)
 *   5. container fora das 2 redes    -> VIOLATION (o desenho tem 2 papéis)
 *   6. API -> rap-internal -> MCP    -> VIOLATION se tools/list não responder
 *   6b. GET /health de dentro da rede-> VIOLATION se não responder 200
 *   6c. tools/call REAL              -> VIOLATION se research_inspect_documentation
 *      (pura, sem efeito externo) não executar
 *   7. egress externo funciona       -> VIOLATION se não funcionar
 *   8. NEGATIVO: Postgres/Redis/
 *      Asterisk inalcançáveis        -> VIOLATION se alcançar (vazamento)
 *   8b. credencial AMI legada        -> VIOLATION se ainda autenticar
 *   9. --with-restart                -> VIOLATION se, após `docker restart`, o
 *      healthcheck não voltar a healthy OU tools/list não voltar a responder
 *
 * Uso: node scripts/governance/validate-mcp-research-docker-e2e.js [--with-restart]
 */

const { execFileSync } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..', '..');
const REPORT_PATH = path.join(ROOT_DIR, 'reports', 'mcp-research-docker-e2e-report.json');

const CONTAINER = process.env.MCP_RESEARCH_E2E_CONTAINER || 'mcp-research-e2e';
const INTERNAL_NETWORK = 'rap-internal';
const EGRESS_NETWORK = 'rap-research-egress';
const MCP_PORT = 8080;
const TOKEN = process.env.MCP_RESEARCH_E2E_TOKEN || 'e2e-container-token-32chars-minimum';

/** Alvos operacionais que o container de PESQUISA nunca pode alcançar. */
const OPERATIONAL_TARGETS = Object.freeze([
  { name: 'postgres', host: process.env.RAP_E2E_POSTGRES_HOST || '172.20.0.6', port: 5432 },
  { name: 'redis', host: process.env.RAP_E2E_REDIS_HOST || '172.20.0.2', port: 6379 },
  { name: 'asterisk', host: process.env.RAP_E2E_ASTERISK_HOST || '172.17.0.1', port: 5038 },
]);

/**
 * Conteúdo fixture para o tools/call REAL (check 6c).
 * research_inspect_documentation é PURA sobre o conteúdo recebido — zero
 * rede, zero efeito externo, funciona nos modos ONLINE e OFFLINE. É a única
 * tool cujo tools/call pode ser exigido em gate sem acionar egress nem
 * persistência.
 */
const TOOL_CALL_FIXTURE = Object.freeze({
  name: 'research_inspect_documentation',
  arguments: Object.freeze({
    url: 'https://docs.acme-fitness.example/platform',
    content: [
      '# Acme Fitness Platform',
      '',
      '## Capabilities',
      '',
      '- member check-in by QR code',
      '- membership plans',
      '',
      '## Journeys',
      '',
      '1. Member signs up at reception',
      '2. Member checks in at the turnstile',
    ].join('\n'),
  }),
});

const LIMITATIONS = Object.freeze([
  'A reconexão RAP-side (circuit breaker do MCP hub) após restart não é exercitada sem a API real no ambiente; o profile with-api do docker-compose.mcp-research-e2e.yml provisiona rap-api-e2e para esse fim, mas o gate atual mede a recovery do SERVIÇO (healthcheck + tools/list), não a do consumidor.',
  'A sonda API->MCP usa um cliente efêmero na mesma rede quando a API real não está provisionada; o relatório declara qual principal foi exercido.',
]);

const CODES = Object.freeze({
  DOCKER_UNAVAILABLE: 'MCP_E2E_REQUIRES_DOCKER_RUNTIME',
  CONTAINER_MISSING: 'MCP_E2E_CONTAINER_MISSING',
  CONTAINER_UNHEALTHY: 'MCP_E2E_CONTAINER_UNHEALTHY',
  NETWORK_NOT_ISOLATED: 'MCP_E2E_INTERNAL_NETWORK_NOT_ISOLATED',
  NETWORK_UNMANAGED: 'MCP_E2E_INTERNAL_NETWORK_UNMANAGED',
  NETWORK_ATTACHMENT: 'MCP_E2E_NETWORK_ATTACHMENT_INCOMPLETE',
  API_UNREACHABLE: 'MCP_E2E_API_TO_MCP_UNREACHABLE',
  HEALTH_UNREACHABLE: 'MCP_E2E_HEALTH_UNREACHABLE',
  TOOL_CALL_FAILED: 'MCP_E2E_TOOL_CALL_FAILED',
  EGRESS_BROKEN: 'MCP_E2E_EGRESS_UNREACHABLE',
  OPERATIONAL_LEAK: 'MCP_E2E_OPERATIONAL_LEAK',
  LEGACY_CREDENTIAL_ACCEPTED: 'MCP_E2E_AMI_LEGACY_CREDENTIAL_ACCEPTED',
  RESTART_FAILED: 'MCP_E2E_RESTART_FAILED',
  MCP_PROTOCOL_INVALID: 'MCP_E2E_PROTOCOL_INVALID',
});

// ---------------------------------------------------------------------------
// Funções PURAS (sem docker, sem IO) — extraídas para teste unitário. O gate
// executável (main) é a fiação destas decisões com as medições reais.
// ---------------------------------------------------------------------------

/** Redes anexadas a partir do `docker inspect --format` (lista separada por espaço). */
function parseAttachedNetworks(attached) {
  return attached ? String(attached).split(/\s+/).filter(Boolean) : [];
}

/** Decisão do check 2 (container presente e saudável). */
function evaluateContainer(status, health, container = CONTAINER) {
  if (status === null || status === undefined) {
    return { code: CODES.CONTAINER_MISSING, detail: `container ${container} não existe` };
  }
  if (status !== 'running' || (health !== 'none' && health !== 'healthy')) {
    return { code: CODES.CONTAINER_UNHEALTHY, detail: `status=${status} health=${health}` };
  }
  return null;
}

/** Decisão dos checks 3/4 (isolamento e gestão da rede interna no RUNTIME). */
function evaluateInternalNetwork(internalFlag, labels, networkName = INTERNAL_NETWORK) {
  const violations = [];
  if (internalFlag === null || internalFlag === undefined) {
    violations.push({ code: CODES.NETWORK_NOT_ISOLATED, detail: `rede ${networkName} não existe` });
  } else if (internalFlag !== 'true') {
    violations.push({
      code: CODES.NETWORK_NOT_ISOLATED,
      detail: `rede ${networkName} em execução tem Internal=${internalFlag}; o compose declara internal: true. O controle declarado NÃO está em vigor — o isolamento observado é efeito colateral do bridge, não o mecanismo projetado.`,
    });
  }
  if (labels !== null && labels !== undefined && !String(labels).includes('com.docker.compose.network')) {
    violations.push({
      code: CODES.NETWORK_UNMANAGED,
      detail: `rede ${networkName} sem labels do compose — criada fora do compose e reutilizada por nome; a definição do arquivo não governa o objeto em execução`,
    });
  }
  return violations;
}

/** Decisão do check 5 (anexo às duas redes do desenho). */
function evaluateAttachments(networks) {
  if (!networks.includes(INTERNAL_NETWORK) || !networks.includes(EGRESS_NETWORK)) {
    return {
      code: CODES.NETWORK_ATTACHMENT,
      detail: `container em [${networks.join(', ')}]; esperado [${INTERNAL_NETWORK}, ${EGRESS_NETWORK}]`,
    };
  }
  return null;
}

/**
 * Decisão do check 8 (NEGATIVO): probe `open` é vazamento; `unknown` também é
 * violação — "não consegui medir" NUNCA conta como "está isolado".
 */
function decideOperationalProbe(target, result) {
  if (result === 'open') {
    return {
      code: CODES.OPERATIONAL_LEAK,
      detail: `container de pesquisa ALCANÇA ${target.name} em ${target.host}:${target.port} — fronteira de rede violada`,
    };
  }
  if (result === 'unknown') {
    return {
      code: CODES.OPERATIONAL_LEAK,
      detail: `não foi possível medir alcance a ${target.name} (${target.host}:${target.port}) — desconhecido não conta como isolado`,
    };
  }
  return null;
}

/** Decisão do check 8b: a credencial legada NÃO pode autenticar. */
function evaluateLegacyCredential(result) {
  if (result && result.reachable && result.accepted) {
    return {
      code: CODES.LEGACY_CREDENTIAL_ACCEPTED,
      detail: `a credencial do repositório autenticou no AMI em ${result.host}:${result.port} — o segredo não foi efetivamente trocado, ou a ACL que deveria barrá-la está inerte`,
    };
  }
  return null;
}

/** Decisão do check 6b (health HTTP de dentro da rede). */
function evaluateHttpHealth(health) {
  if (!health.reachable) {
    return { code: CODES.HEALTH_UNREACHABLE, detail: `GET /health falhou de dentro da rede — ${health.error}` };
  }
  if (health.httpStatus !== 200) {
    return { code: CODES.HEALTH_UNREACHABLE, detail: `GET /health respondeu HTTP ${health.httpStatus} (esperado 200)` };
  }
  return null;
}

/** Decisão do check 6c (tools/call real, tool pura). */
function evaluateToolCall(toolCall) {
  if (!toolCall.reachable) {
    return { code: CODES.TOOL_CALL_FAILED, detail: `tools/call ${TOOL_CALL_FIXTURE.name} falhou — ${toolCall.error}` };
  }
  if (!toolCall.isErrorFalse) {
    return {
      code: CODES.TOOL_CALL_FAILED,
      detail: `tools/call ${TOOL_CALL_FIXTURE.name} respondeu HTTP ${toolCall.httpStatus} mas isError não é false (execução real não comprovada)`,
    };
  }
  return null;
}

/** Decisão do check 9 (recovery real após restart). */
function evaluateRestartRecovery(recovery) {
  const violations = [];
  if (recovery.status !== 'running' || recovery.health !== 'healthy') {
    violations.push({
      code: CODES.RESTART_FAILED,
      detail: `após restart: status=${recovery.status} health=${recovery.health} (esperado running/healthy)`,
    });
  }
  if (!recovery.toolsListReachable) {
    violations.push({
      code: CODES.RESTART_FAILED,
      detail: `após restart healthy, tools/list não voltou a responder de dentro da rede — ${recovery.toolsListError || 'sem resposta'}`,
    });
  }
  return violations;
}

/** Relatório do caminho sem docker: ausência de pré-requisito, não falha. */
function buildRequiresDockerReport(generatedAt) {
  return {
    validator: 'validate-mcp-research-docker-e2e',
    gate: 'MCP_RESEARCH_DOCKER_E2E',
    generatedAt,
    status: 'REQUIRES_DOCKER_RUNTIME',
    reason: 'Docker indisponível neste ambiente',
    violations: [],
  };
}

/** Montagem do relatório: PASS só com zero violações. */
function buildReport({ generatedAt, container, checks, violations }) {
  return {
    validator: 'validate-mcp-research-docker-e2e',
    gate: 'MCP_RESEARCH_DOCKER_E2E',
    generatedAt,
    status: violations.length === 0 ? 'PASS' : 'FAIL',
    container,
    checks,
    violations,
    limitations: [...LIMITATIONS],
  };
}

// ---------------------------------------------------------------------------
// Fiação com o runtime (docker, TCP, HTTP de dentro da rede)
// ---------------------------------------------------------------------------

function docker(args, options = {}) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: options.timeout || 30000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function dockerAvailable() {
  try {
    docker(['version', '--format', '{{.Server.Version}}'], { timeout: 15000 });
    return true;
  } catch (_) {
    return false;
  }
}

function inspect(format, target = CONTAINER) {
  try {
    return docker(['inspect', target, '--format', format]).trim();
  } catch (_) {
    return null;
  }
}

function networkInspect(format, name) {
  try {
    return docker(['network', 'inspect', name, '--format', format]).trim();
  } catch (_) {
    return null;
  }
}

/** Executa um comando dentro do container; devolve {ok, out}. */
function execIn(command, timeout = 25000) {
  try {
    const out = docker(['exec', CONTAINER, 'sh', '-c', command], { timeout });
    return { ok: true, out: out.trim() };
  } catch (error) {
    const out = `${error.stdout || ''}${error.stderr || ''}`.trim();
    return { ok: false, out };
  }
}

/**
 * Sonda TCP de dentro do container. `nc` pode não existir na imagem; nesse caso
 * o resultado é `unknown` — e desconhecido NUNCA conta como aprovado, porque
 * "não consegui medir" não é o mesmo que "está isolado".
 */
function tcpProbe(host, port) {
  const result = execIn(`(nc -z -w 3 ${host} ${port} && echo OPEN) || echo CLOSED`);
  if (!result.ok) return 'unknown';
  if (result.out.includes('OPEN')) return 'open';
  if (result.out.includes('CLOSED')) return 'closed';
  return 'unknown';
}

/**
 * Tenta autenticar no AMI com a credencial que já esteve versionada no
 * repositório.
 *
 * POR QUE ESTE CHECK EXISTE (defeito de processo, não de código):
 * Em 2026-09-19 eu commitei um mecanismo de injeção do segredo e verifiquei só
 * que o SEGREDO NOVO funcionava. A ACL tinha ficado INERTE e eu não percebi —
 * só descobri porque apontei `permit` para um endereço impossível e TODAS as
 * origens continuaram recebendo resposta. Ou seja: o caminho felizinho passou e
 * a proteção não existia.
 *
 * Este check é o critério de aceite durável que faltava: a credencial antiga,
 * que esteve publicada, NÃO pode autenticar — em nenhuma origem, com nenhuma
 * ACL. Se ela autentica, o segredo não foi efetivamente trocado, ou a ACL que
 * deveria barrá-la não está em vigor. Qualquer um dos dois é falha.
 */
async function checkLegacyAmiCredential() {
  const host = process.env.RAP_E2E_AMI_HOST || '127.0.0.1';
  const port = Number(process.env.RAP_E2E_AMI_PORT || 5038);
  const legacy = process.env.RAP_E2E_AMI_LEGACY_SECRET || 'ragent2';

  return await new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let buffer = '';
    const done = (result) => { try { socket.destroy(); } catch (_) {} resolve(result); };
    socket.setTimeout(6000);
    socket.on('connect', () => {
      socket.write(`Action: Login\r\nUsername: ragent2\r\nSecret: ${legacy}\r\n\r\n`);
    });
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      if (/Authentication (accepted|failed)/i.test(buffer)) {
        done({ reachable: true, accepted: /Authentication accepted/i.test(buffer), host, port });
      }
    });
    socket.on('timeout', () => done({ reachable: true, accepted: false, host, port, note: 'timeout' }));
    socket.on('error', () => done({ reachable: false, accepted: false, host, port }));
  });
}

/**
 * Cliente de DENTRO da rede.
 *
 * Com `rap-internal: internal: true` o HOST não alcança mais o container por
 * esse caminho — que é o objetivo do controle. Então a sonda precisa sair de
 * dentro. Usa-se o mesmo image do serviço como cliente efêmero e, quando o
 * container da API real está provisionado (`--profile with-api`), ele é usado
 * como principal.
 *
 * O relatório diz QUAL principal foi exercido. Afirmar "API exercida" quando o
 * que rodou foi um cliente de teste seria a mesma classe de defeito que este
 * trabalho vem caçando: prova apresentada por algo diferente do que se afirma.
 */
function runNetworkClient(script) {
  const clientContainer = process.env.RAP_E2E_API_CONTAINER || '';
  const runClient = (args) => {
    try {
      return docker(args, { timeout: 45000 }).trim();
    } catch (error) {
      return `${error.stdout || ''}${error.stderr || ''}`.trim();
    }
  };

  if (clientContainer) {
    return {
      principal: `api-container:${clientContainer}`,
      raw: runClient(['exec', clientContainer, 'node', '-e', script]),
    };
  }
  return {
    principal: 'client-on-rap-internal (API real não provisionada)',
    raw: runClient([
      'run', '--rm', `--network=${INTERNAL_NETWORK}`,
      '--entrypoint', 'node', 'ragent2-mcp-research:local', '-e', script,
    ]),
  };
}

/** Extrai a ÚLTIMA linha JSON do stdout do cliente efêmero. */
function parseClientJson(raw) {
  const line = String(raw).split('\n').filter((l) => l.trim().startsWith('{')).pop();
  if (!line) return null;
  try {
    return JSON.parse(line);
  } catch (_) {
    return null;
  }
}

/**
 * RPC MCP (POST /mcp) de dentro da rede. Devolve
 * { reachable, principal, httpStatus, body } — body é o texto cru (SSE).
 */
function rpcFromNetwork(mcpHost, method, params) {
  const script = `fetch('http://${mcpHost}:${MCP_PORT}/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream',authorization:'Bearer ${TOKEN}'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:${JSON.stringify(method)},params:${JSON.stringify(params || {})}})}).then(async r=>{const t=await r.text();console.log(JSON.stringify({status:r.status,body:t.slice(0,4000)}));}).catch(e=>{console.log(JSON.stringify({error:String(e.message||e)}));});`;

  const { principal, raw } = runNetworkClient(script);
  const parsed = parseClientJson(raw);
  if (!parsed) return { reachable: false, principal, error: String(raw).slice(0, 200), body: '' };
  if (parsed.error) return { reachable: false, principal, error: parsed.error, body: '' };
  return { reachable: true, principal, httpStatus: parsed.status, body: String(parsed.body || '') };
}

/** GET HTTP simples de dentro da rede (sem bearer — /health é público). */
function httpGetFromNetwork(url) {
  const script = `fetch('${url}').then(async r=>{const t=await r.text();console.log(JSON.stringify({status:r.status,body:t.slice(0,1000)}));}).catch(e=>{console.log(JSON.stringify({error:String(e.message||e)}));});`;
  const { principal, raw } = runNetworkClient(script);
  const parsed = parseClientJson(raw);
  if (!parsed) return { reachable: false, principal, error: String(raw).slice(0, 200) };
  if (parsed.error) return { reachable: false, principal, error: parsed.error };
  return { reachable: true, principal, httpStatus: parsed.status, body: String(parsed.body || '') };
}

/** Check 6: API -> rap-internal -> MCP, tools/list de dentro da rede. */
function probeMcpFromNetwork(mcpHost) {
  const rpc = rpcFromNetwork(mcpHost, 'tools/list', {});
  if (!rpc.reachable) return { reachable: false, principal: rpc.principal, error: rpc.error, tools: [] };
  const tools = [...new Set([...rpc.body.matchAll(/"name":"(research_[a-z_]+)"/g)].map((m) => m[1]))];
  return { reachable: true, principal: rpc.principal, httpStatus: rpc.httpStatus, tools };
}

/** Check 6c: tools/call REAL numa tool pura (sem efeito externo). */
function probeToolCallFromNetwork(mcpHost) {
  const rpc = rpcFromNetwork(mcpHost, 'tools/call', TOOL_CALL_FIXTURE);
  if (!rpc.reachable) {
    return { tool: TOOL_CALL_FIXTURE.name, reachable: false, principal: rpc.principal, error: rpc.error, isErrorFalse: false };
  }
  return {
    tool: TOOL_CALL_FIXTURE.name,
    reachable: true,
    principal: rpc.principal,
    httpStatus: rpc.httpStatus,
    isErrorFalse: /"isError":false/.test(rpc.body),
  };
}

/** Chamada real ao MCP pelo endereço da rede interna (caminho do HOST, legado). */
async function probeMcp(ip) {
  const url = `http://${ip}:${MCP_PORT}/mcp`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      signal: controller.signal,
    });
    const text = await response.text();
    const tools = [...text.matchAll(/"name":"(research_[a-z_]+)"/g)].map((m) => m[1]);
    return { reachable: true, httpStatus: response.status, tools: [...new Set(tools)] };
  } catch (error) {
    return { reachable: false, error: error.message, tools: [] };
  } finally {
    clearTimeout(timer);
  }
}

/** Espera o healthcheck voltar a `healthy` (ou `none`) após o restart. */
function waitHealthy(timeoutMs = 90000, intervalMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = inspect('{{.State.Status}}');
    const health = inspect('{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}');
    if (status === 'running' && (health === 'healthy' || health === 'none')) {
      return { status, health };
    }
    execFileSync('sh', ['-c', `sleep ${intervalMs / 1000}`]);
  }
  return {
    status: inspect('{{.State.Status}}'),
    health: inspect('{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}'),
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  const violations = [];
  const checks = {};

  if (!dockerAvailable()) {
    // Não é falha: é ausência de pré-requisito. O gate declara o estado em vez
    // de reprovar por algo que o ambiente não pode prover. O SEAL é a camada
    // que exige o relatório com status PASS de verdade (release final não
    // existe sem a prova) — ver scripts/governance/seal-release.sh.
    const report = buildRequiresDockerReport(startedAt);
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log('[mcp-research-docker-e2e] status=REQUIRES_DOCKER_RUNTIME (Docker indisponível)');
    return;
  }

  // 2. Container presente e saudável
  const status = inspect('{{.State.Status}}');
  const health = inspect('{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}');
  checks.container = { present: status !== null, status, health };
  const containerViolation = evaluateContainer(status, health);
  if (containerViolation) violations.push(containerViolation);

  // 3/4. Isolamento e gestão da rede interna — o RUNTIME, não o texto
  const internalFlag = networkInspect('{{.Internal}}', INTERNAL_NETWORK);
  const labels = networkInspect('{{json .Labels}}', INTERNAL_NETWORK);
  checks.internalNetwork = { internal: internalFlag, labels };
  violations.push(...evaluateInternalNetwork(internalFlag, labels));

  // 5. Anexos: o desenho tem dois papéis (interna para o tráfego da API, egress
  //    para a única saída externa)
  const attached = inspect('{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}');
  const networks = parseAttachedNetworks(attached);
  const containerIp = inspect(`{{with index .NetworkSettings.Networks "${INTERNAL_NETWORK}"}}{{.IPAddress}}{{end}}`);
  checks.attachments = { networks, containerIp };
  const attachmentViolation = evaluateAttachments(networks);
  if (attachmentViolation) violations.push(attachmentViolation);

  // 6. API -> rap-internal -> MCP (chamada REAL, de dentro da rede)
  const mcpHost = process.env.RAP_E2E_MCP_HOST || CONTAINER;
  const mcp = probeMcpFromNetwork(mcpHost);
  checks.mcp = mcp;
  if (!mcp.reachable) {
    violations.push({ code: CODES.API_UNREACHABLE, detail: `principal=${mcp.principal} — ${mcp.error}` });
  } else if (mcp.tools.length === 0) {
    violations.push({
      code: CODES.MCP_PROTOCOL_INVALID,
      detail: `respondeu HTTP ${mcp.httpStatus} mas tools/list não devolveu nenhuma ferramenta research_*`,
    });
  }

  // 6b. Health HTTP direto de dentro da rede (prova o caminho de liveness que
  //     o healthcheck do compose usa, mas pelo LADO da rede, não do processo)
  const httpHealth = httpGetFromNetwork(`http://${mcpHost}:${MCP_PORT}/health`);
  checks.httpHealth = httpHealth;
  const healthViolation = evaluateHttpHealth(httpHealth);
  if (healthViolation) violations.push(healthViolation);

  // 6c. tools/call REAL numa tool pura. tools/list prova o handshake; só um
  //     tools/call prova que o serviço EXECUTA trabalho. A tool escolhida
  //     (research_inspect_documentation) é pura sobre o conteúdo recebido:
  //     zero egress, zero persistência — ver TOOL_CALL_FIXTURE.
  const toolCall = probeToolCallFromNetwork(mcpHost);
  checks.mcpToolCall = toolCall;
  const toolCallViolation = evaluateToolCall(toolCall);
  if (toolCallViolation) violations.push(toolCallViolation);

  // 7. Egress real de dentro do container
  const egress = execIn('(nc -z -w 4 1.1.1.1 443 && echo OPEN) || echo CLOSED');
  checks.egress = { ok: egress.ok, out: egress.out };
  const egressOpen = egress.out.includes('OPEN');
  if (!egressOpen) {
    violations.push({ code: CODES.EGRESS_BROKEN, detail: `saída externa indisponível: ${egress.out || 'sem resposta'}` });
  }

  // 8. NEGATIVO: o container de pesquisa não pode alcançar nada operacional.
  //
  // ATENÇÃO MEDIDA (2026-09-19): bloquear isso NÃO se resolve só isolando
  // `rap-internal`. O container PRECISA de egress, e a rede de egress
  // (`rap-research-egress`) é um bridge comum: por ela o container alcança o
  // gateway do host (docker0, 172.17.0.1) e, com ele, qualquer serviço escutando
  // em 0.0.0.0 — foi assim que o AMI do Asterisk permaneceu exposto MESMO com a
  // rede interna já isolada e gerenciada pelo compose. Restringir egress exige
  // filtro de destino (iptables/proxy): o Docker não oferece isso por si.
  checks.operationalReachability = {};
  for (const target of OPERATIONAL_TARGETS) {
    const result = tcpProbe(target.host, target.port);
    checks.operationalReachability[target.name] = result;
    const leak = decideOperationalProbe(target, result);
    if (leak) violations.push(leak);
  }

  // 8b. A credencial LEGADA não pode autenticar. Ver o comentário de
  // checkLegacyAmiCredential: este é o critério que pega ACL inerte, que uma
  // verificação de caminho felizinho não pega.
  const legacyCredential = await checkLegacyAmiCredential();
  checks.legacyCredential = legacyCredential;
  const legacyViolation = evaluateLegacyCredential(legacyCredential);
  if (legacyViolation) violations.push(legacyViolation);

  // 9. Restart (opcional: caro e indisponível em CI). Não basta o container
  //    voltar a `running`: o healthcheck tem de voltar a healthy E o tools/list
  //    tem de voltar a responder de dentro da rede — recovery do SERVIÇO, não
  //    do processo. A reconexão do CONSUMIDOR (circuit breaker RAP-side) está
  //    fora de alcance sem a API real no e2e — ver `limitations` no relatório.
  if (process.argv.includes('--with-restart')) {
    try {
      docker(['restart', CONTAINER], { timeout: 90000 });
      const recovered = waitHealthy();
      const toolsAfter = probeMcpFromNetwork(mcpHost);
      checks.restart = {
        ...recovered,
        toolsListReachable: toolsAfter.reachable && toolsAfter.tools.length > 0,
        toolsListError: toolsAfter.reachable ? null : toolsAfter.error,
        toolsListPrincipal: toolsAfter.principal,
      };
      violations.push(...evaluateRestartRecovery(checks.restart));
    } catch (error) {
      violations.push({ code: CODES.RESTART_FAILED, detail: error.message });
    }
  }

  const report = buildReport({ generatedAt: startedAt, container: CONTAINER, checks, violations });

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(
    `[mcp-research-docker-e2e] status=${report.status} container=${CONTAINER} `
    + `redes=${networks.join(',')} violacoes=${violations.length}`
  );
  for (const violation of violations) {
    console.log(`  - ${violation.code}: ${violation.detail}`);
  }
  console.log(`[mcp-research-docker-e2e] relatório: ${path.relative(ROOT_DIR, REPORT_PATH)}`);

  if (violations.length > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}

module.exports = {
  CODES,
  OPERATIONAL_TARGETS,
  TOOL_CALL_FIXTURE,
  LIMITATIONS,
  tcpProbe,
  probeMcpFromNetwork,
  probeToolCallFromNetwork,
  checkLegacyAmiCredential,
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
};
