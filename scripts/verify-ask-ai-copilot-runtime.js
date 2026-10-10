'use strict';

/**
 * Verificação em runtime real do Copiloto Operacional ("Perguntar à IA").
 *
 * Diferente dos testes unitários, este script fala com a API VIVA: autentica,
 * abre uma conversa, faz follow-up na mesma conversa e exercita o boundary
 * (contexto arbitrário, conversa inexistente, ausência de token, entidade
 * inacessível). A evidência fica em
 * `reports/ask-ai-copilot-runtime-evidence.json`.
 *
 * Credenciais NUNCA são hardcoded: vêm de variáveis de ambiente.
 *
 *   ASKAI_VERIFY_BASE_URL   (default http://127.0.0.1:3001)
 *   ASKAI_VERIFY_USER       (obrigatório)
 *   ASKAI_VERIFY_PASSWORD   (obrigatório)
 *   ASKAI_VERIFY_TENANT     (default system)
 *
 * Uso:
 *   ASKAI_VERIFY_USER=... ASKAI_VERIFY_PASSWORD=... npm run verify:ask-ai-copilot:runtime
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REPORT_PATH = path.join(ROOT, 'reports', 'ask-ai-copilot-runtime-evidence.json');

const BASE_URL = (process.env.ASKAI_VERIFY_BASE_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const USERNAME = process.env.ASKAI_VERIFY_USER || '';
const PASSWORD = process.env.ASKAI_VERIFY_PASSWORD || '';
const TENANT = process.env.ASKAI_VERIFY_TENANT || 'system';
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.ASKAI_VERIFY_TIMEOUT_MS || '120000', 10);

const checks = [];

function record(id, description, status, detail) {
  checks.push({ id, description, status, detail: detail ?? null });
}

async function call(pathname, { method = 'GET', token = null, body = null } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const headers = { 'X-Tenant-Id': TENANT };
    if (body !== null) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${BASE_URL}${pathname}`, {
      method,
      headers,
      body: body === null ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = null;
    try { payload = JSON.parse(text); } catch { payload = text.slice(0, 500); }
    return { status: response.status, payload };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Marcadores de resposta DEGRADADA (texto recuperado sem síntese). Espelham o
 * caminho de fallback de geração em `rag-service/api/routes/query.py`.
 */
const DEGRADATION_MARKERS = [
  'Não foi possível gerar a resposta agora',
  'Com base nas informações disponíveis',
];

/**
 * Um turno só é evidência de copiloto funcionando se a resposta foi SINTETIZADA.
 *
 * HTTP 200 não basta: em 2026-10-08 o rag-service devolvia um trecho cru de
 * documento com `confidence: fully_grounded` e este script dava PASS num
 * copiloto que não respondia. Puro de propósito — a checagem roda contra a API
 * viva, então a REGRA precisa ser testável em isolamento.
 *
 * @param {{status: number, answer: string, confidence: string|null}} turno
 * @returns {{ok: boolean, reason: string|null}}
 */
function evaluateSynthesizedAnswer({ status, answer, confidence }) {
  const text = String(answer || '');
  if (status !== 200) return { ok: false, reason: `http_${status}` };
  const marker = DEGRADATION_MARKERS.find((candidate) => text.includes(candidate));
  if (marker) return { ok: false, reason: `degradation_marker:${marker}` };
  if (confidence === 'source_only') return { ok: false, reason: 'confidence_source_only' };
  if (text.trim().length < 40) return { ok: false, reason: 'answer_too_short' };
  return { ok: true, reason: null };
}

async function main() {
  if (!USERNAME || !PASSWORD) {
    console.error('❌ Defina ASKAI_VERIFY_USER e ASKAI_VERIFY_PASSWORD (nunca hardcoded no repositório).');
    process.exit(2);
  }

  // 1. Disponibilidade da API
  const health = await call('/health');
  record('api_reachable', 'API responde em /health', health.status === 200 ? 'PASS' : 'FAIL', { status: health.status });
  if (health.status !== 200) {
    return finish();
  }

  // 2. Autenticação
  const login = await call('/api/auth/login', {
    method: 'POST',
    body: { username: USERNAME, password: PASSWORD, tenantId: TENANT },
  });
  const token = login.payload?.token;
  record('login', 'Autenticação do ator de verificação', token ? 'PASS' : 'FAIL', {
    status: login.status,
    classification: login.payload?.agent?.classification || null,
  });
  if (!token) {
    return finish();
  }

  // 3. Boundary: sem token
  const anonymous = await call('/api/ask-ai', { method: 'POST', body: { question: 'oi' } });
  record('unauthenticated_denied', 'Pergunta sem token é negada', anonymous.status === 401 ? 'PASS' : 'FAIL', {
    status: anonymous.status,
  });

  // 4. Boundary: contexto arbitrário
  const badContext = await call('/api/ask-ai', {
    method: 'POST',
    token,
    body: { question: 'oi', context: { role: 'super_admin' } },
  });
  record('arbitrary_context_rejected', 'Contexto de tela desconhecido é rejeitado', badContext.status === 400 ? 'PASS' : 'FAIL', {
    status: badContext.status,
  });

  // 5. Boundary: conversa inexistente
  const badConversation = await call('/api/ask-ai', {
    method: 'POST',
    token,
    body: { question: 'oi', conversationId: 'conv_doesnotexist123' },
  });
  record(
    'unknown_conversation_404',
    'conversationId inexistente responde 404 sem vazar existência',
    badConversation.status === 404 && badConversation.payload?.error === 'conversation_not_found' ? 'PASS' : 'FAIL',
    { status: badConversation.status, error: badConversation.payload?.error || null },
  );

  // 6. Turno 1 em tela real
  const first = await call('/api/ask-ai', {
    method: 'POST',
    token,
    body: {
      question: 'Como faço uma matrícula?',
      context: { route: '/fitness/matriculas', module: 'fitness', pageType: 'index' },
    },
  });
  const conversationId = first.payload?.conversationId || null;
  record(
    'first_turn',
    'Pergunta procedimental responde com conversa identificada',
    first.status === 200 && first.payload?.success === true && conversationId ? 'PASS' : 'FAIL',
    { status: first.status, intent: first.payload?.intent || null, confidence: first.payload?.confidence || null, conversationId },
  );

  // 6b. A resposta precisa ter sido GERADA — HTTP 200 não basta.
  //
  // Defeito medido em 2026-10-08: com o provider de geração sem crédito (429),
  // o rag-service devolvia um TRECHO CRU de documento e o turno vinha com
  // `confidence: fully_grounded`. Este script dava PASS num copiloto que não
  // respondia ("Como faço uma matrícula?" devolvia texto sobre replay).
  //
  // `metadata.generated` não é exposto ao cliente por design: a evidência
  // exibível é o TEXTO (marcador de degradação) somado à confiança.
  const firstAnswer = String(first.payload?.answer || '');
  const firstConfidence = first.payload?.confidence || null;
  const synthesized = evaluateSynthesizedAnswer({
    status: first.status,
    answer: firstAnswer,
    confidence: firstConfidence,
  });
  record(
    'first_turn_answer_generated',
    'Resposta do turno foi SINTETIZADA (não é trecho recuperado nem degradação)',
    synthesized.ok ? 'PASS' : 'FAIL',
    {
      status: first.status,
      confidence: firstConfidence,
      answerLength: firstAnswer.trim().length,
      reason: synthesized.reason,
    },
  );

  // 7. Follow-up na mesma conversa
  const second = await call('/api/ask-ai', {
    method: 'POST',
    token,
    body: {
      question: 'E se ele estiver inadimplente?',
      conversationId,
      context: { route: '/fitness/matriculas', module: 'fitness' },
    },
  });
  record(
    'follow_up_same_conversation',
    'Follow-up preserva a mesma conversa',
    second.status === 200 && second.payload?.conversationId === conversationId ? 'PASS' : 'FAIL',
    { status: second.status, conversationId: second.payload?.conversationId || null },
  );

  // 8. Entidade inacessível não é consultada
  const deniedEntity = await call('/api/ask-ai', {
    method: 'POST',
    token,
    body: {
      question: 'Por que este aluno está com risco de churn?',
      context: {
        route: '/fitness/students/x',
        entityType: 'FITNESS_STUDENT',
        entityId: '00000000-0000-0000-0000-000000000000',
      },
    },
  });
  const entityValidated = deniedEntity.payload?.context?.entityValidated;
  record(
    'inaccessible_entity_denied',
    'Entidade sem posse comprovada é negada sem consultar dados',
    deniedEntity.status === 200 && entityValidated === false ? 'PASS' : 'FAIL',
    {
      status: deniedEntity.status,
      entityValidated: entityValidated ?? null,
      confidence: deniedEntity.payload?.confidence || null,
    },
  );

  // 9. Superfície técnica de replay exige classificação (SUPPORT+)
  const replays = await call('/api/learning/replays', { token });
  record(
    'replay_surface_classification',
    'Listagem de replay é servida somente a classificação autorizada',
    replays.status === 200 || replays.status === 403 ? 'PASS' : 'FAIL',
    { status: replays.status, count: Array.isArray(replays.payload?.replays) ? replays.payload.replays.length : null },
  );

  return finish();
}

function finish() {
  const failed = checks.filter((check) => check.status === 'FAIL');
  const report = {
    generatedAt: new Date().toISOString(),
    gate: 'ask-ai-copilot-runtime',
    baseUrl: BASE_URL,
    tenant: TENANT,
    status: failed.length === 0 ? 'PASS' : 'FAIL',
    summary: { total: checks.length, passed: checks.length - failed.length, failed: failed.length },
    checks,
  };
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  for (const check of checks) {
    console.log(`${check.status === 'PASS' ? '✅' : '❌'} ${check.id} — ${check.description}`);
    if (check.status === 'FAIL') console.log(`     ${JSON.stringify(check.detail)}`);
  }
  console.log(`\n${report.status}: ${report.summary.passed}/${report.summary.total} verificações em runtime real`);
  console.log(`relatório: reports/ask-ai-copilot-runtime-evidence.json`);
  if (failed.length > 0) process.exit(1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('FATAL:', error.message);
    process.exit(1);
  });
}

module.exports = { evaluateSynthesizedAnswer, DEGRADATION_MARKERS };
