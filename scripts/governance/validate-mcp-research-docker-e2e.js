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
 *   1. Docker indisponível           -> REQUIRES_DOCKER_RUNTIME (não é falha)
 *   2. container ausente/doente      -> VIOLATION
 *   3. rap-internal não isolada      -> VIOLATION (controle declarado inerte)
 *   4. rap-internal não gerenciada   -> VIOLATION (drift de infraestrutura)
 *   5. container fora das 2 redes    -> VIOLATION (o desenho tem 2 papéis)
 *   6. API -> rap-internal -> MCP    -> VIOLATION se não responder
 *   7. egress externo funciona       -> VIOLATION se não funcionar
 *   8. NEGATIVO: Postgres/Redis/
 *      Asterisk inalcançáveis        -> VIOLATION se alcançar (vazamento)
 *
 * Uso: node scripts/governance/validate-mcp-research-docker-e2e.js [--with-restart]
 */

const { execFileSync } = require('child_process');
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

const CODES = Object.freeze({
  DOCKER_UNAVAILABLE: 'MCP_E2E_REQUIRES_DOCKER_RUNTIME',
  CONTAINER_MISSING: 'MCP_E2E_CONTAINER_MISSING',
  CONTAINER_UNHEALTHY: 'MCP_E2E_CONTAINER_UNHEALTHY',
  NETWORK_NOT_ISOLATED: 'MCP_E2E_INTERNAL_NETWORK_NOT_ISOLATED',
  NETWORK_UNMANAGED: 'MCP_E2E_INTERNAL_NETWORK_UNMANAGED',
  NETWORK_ATTACHMENT: 'MCP_E2E_NETWORK_ATTACHMENT_INCOMPLETE',
  API_UNREACHABLE: 'MCP_E2E_API_TO_MCP_UNREACHABLE',
  EGRESS_BROKEN: 'MCP_E2E_EGRESS_UNREACHABLE',
  OPERATIONAL_LEAK: 'MCP_E2E_OPERATIONAL_LEAK',
  RESTART_FAILED: 'MCP_E2E_RESTART_FAILED',
  MCP_PROTOCOL_INVALID: 'MCP_E2E_PROTOCOL_INVALID',
});

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
 * Sonda API -> MCP de DENTRO da rede.
 *
 * Com `rap-internal: internal: true` o HOST não alcança mais o container — o
 * que é o objetivo do controle. Então a sonda precisa sair de dentro. Usa-se o
 * mesmo image do serviço como cliente efêmero e, quando o container da API real
 * está provisionado (`--profile with-api`), ele é usado como principal.
 *
 * O relatório diz QUAL principal foi exercido. Afirmar "API exercida" quando o
 * que rodou foi um cliente de teste seria a mesma classe de defeito que este
 * trabalho vem caçando: prova apresentada por algo diferente do que se afirma.
 */
function probeMcpFromNetwork(mcpHost) {
  const clientContainer = process.env.RAP_E2E_API_CONTAINER || '';
  const script = `fetch('http://${mcpHost}:${MCP_PORT}/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream',authorization:'Bearer ${TOKEN}'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})}).then(async r=>{const t=await r.text();console.log(JSON.stringify({status:r.status,body:t.slice(0,4000)}));}).catch(e=>{console.log(JSON.stringify({error:String(e.message||e)}));});`;

  const runClient = (args) => {
    try {
      const out = docker(args, { timeout: 45000 });
      return out.trim();
    } catch (error) {
      return `${error.stdout || ''}${error.stderr || ''}`.trim();
    }
  };

  let raw;
  let principal;
  if (clientContainer) {
    principal = `api-container:${clientContainer}`;
    raw = runClient(['exec', clientContainer, 'node', '-e', script]);
  } else {
    principal = 'client-on-rap-internal (API real não provisionada)';
    raw = runClient([
      'run', '--rm', `--network=${INTERNAL_NETWORK}`,
      '--entrypoint', 'node', 'ragent2-mcp-research:local', '-e', script,
    ]);
  }

  const line = raw.split('\n').filter((l) => l.trim().startsWith('{')).pop();
  if (!line) return { reachable: false, principal, error: raw.slice(0, 200), tools: [] };
  try {
    const parsed = JSON.parse(line);
    if (parsed.error) return { reachable: false, principal, error: parsed.error, tools: [] };
    const tools = [...new Set([...String(parsed.body || '').matchAll(/"name":"(research_[a-z_]+)"/g)].map((m) => m[1]))];
    return { reachable: true, principal, httpStatus: parsed.status, tools };
  } catch (error) {
    return { reachable: false, principal, error: error.message, tools: [] };
  }
}

/** Chamada real ao MCP pelo endereço da rede interna. */
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

async function main() {
  const startedAt = new Date().toISOString();
  const violations = [];
  const checks = {};

  if (!dockerAvailable()) {
    // Não é falha: é ausência de pré-requisito. O gate declara o estado em vez
    // de reprovar por algo que o ambiente não pode prover.
    const report = {
      validator: 'validate-mcp-research-docker-e2e',
      gate: 'MCP_RESEARCH_DOCKER_E2E',
      generatedAt: startedAt,
      status: 'REQUIRES_DOCKER_RUNTIME',
      reason: 'Docker indisponível neste ambiente',
      violations: [],
    };
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log('[mcp-research-docker-e2e] status=REQUIRES_DOCKER_RUNTIME (Docker indisponível)');
    return;
  }

  // 2. Container presente e saudável
  const status = inspect('{{.State.Status}}');
  const health = inspect('{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}');
  checks.container = { present: status !== null, status, health };
  if (status === null) {
    violations.push({ code: CODES.CONTAINER_MISSING, detail: `container ${CONTAINER} não existe` });
  } else if (status !== 'running' || (health !== 'none' && health !== 'healthy')) {
    violations.push({ code: CODES.CONTAINER_UNHEALTHY, detail: `status=${status} health=${health}` });
  }

  // 3/4. Isolamento e gestão da rede interna — o RUNTIME, não o texto
  const internalFlag = networkInspect('{{.Internal}}', INTERNAL_NETWORK);
  const labels = networkInspect('{{json .Labels}}', INTERNAL_NETWORK);
  checks.internalNetwork = { internal: internalFlag, labels };
  if (internalFlag === null) {
    violations.push({ code: CODES.NETWORK_NOT_ISOLATED, detail: `rede ${INTERNAL_NETWORK} não existe` });
  } else if (internalFlag !== 'true') {
    violations.push({
      code: CODES.NETWORK_NOT_ISOLATED,
      detail: `rede ${INTERNAL_NETWORK} em execução tem Internal=${internalFlag}; o compose declara internal: true. O controle declarado NÃO está em vigor — o isolamento observado é efeito colateral do bridge, não o mecanismo projetado.`,
    });
  }
  if (labels !== null && !labels.includes('com.docker.compose.network')) {
    violations.push({
      code: CODES.NETWORK_UNMANAGED,
      detail: `rede ${INTERNAL_NETWORK} sem labels do compose — criada fora do compose e reutilizada por nome; a definição do arquivo não governa o objeto em execução`,
    });
  }

  // 5. Anexos: o desenho tem dois papéis (interna para o tráfego da API, egress
  //    para a única saída externa)
  const attached = inspect('{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}');
  const networks = attached ? attached.split(/\s+/).filter(Boolean) : [];
  const containerIp = inspect(`{{with index .NetworkSettings.Networks "${INTERNAL_NETWORK}"}}{{.IPAddress}}{{end}}`);
  checks.attachments = { networks, containerIp };
  if (!networks.includes(INTERNAL_NETWORK) || !networks.includes(EGRESS_NETWORK)) {
    violations.push({
      code: CODES.NETWORK_ATTACHMENT,
      detail: `container em [${networks.join(', ')}]; esperado [${INTERNAL_NETWORK}, ${EGRESS_NETWORK}]`,
    });
  }

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
    if (result === 'open') {
      violations.push({
        code: CODES.OPERATIONAL_LEAK,
        detail: `container de pesquisa ALCANÇA ${target.name} em ${target.host}:${target.port} — fronteira de rede violada`,
      });
    } else if (result === 'unknown') {
      // Desconhecido não é aprovado: não foi possível medir.
      violations.push({
        code: CODES.OPERATIONAL_LEAK,
        detail: `não foi possível medir alcance a ${target.name} (${target.host}:${target.port}) — desconhecido não conta como isolado`,
      });
    }
  }

  // 9. Restart (opcional: caro e indisponível em CI)
  if (process.argv.includes('--with-restart')) {
    try {
      docker(['restart', CONTAINER], { timeout: 90000 });
      const after = inspect('{{.State.Status}}');
      checks.restart = { status: after };
      if (after !== 'running') {
        violations.push({ code: CODES.RESTART_FAILED, detail: `após restart: ${after}` });
      }
    } catch (error) {
      violations.push({ code: CODES.RESTART_FAILED, detail: error.message });
    }
  }

  const report = {
    validator: 'validate-mcp-research-docker-e2e',
    gate: 'MCP_RESEARCH_DOCKER_E2E',
    generatedAt: startedAt,
    status: violations.length === 0 ? 'PASS' : 'FAIL',
    container: CONTAINER,
    checks,
    violations,
  };

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

module.exports = { CODES, OPERATIONAL_TARGETS, tcpProbe, probeMcpFromNetwork };
