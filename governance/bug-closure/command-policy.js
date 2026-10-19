'use strict';

/**
 * POLÍTICA DE COMANDO — BUG CLOSURE FIRST, aplicada a PROCESSOS FILHOS.
 *
 * POR QUE EXISTE
 * --------------
 * As guardas de shell/processo (`bug-closure-guard.sh`, `require-eligibility.js`)
 * protegem quem CHAMA os scripts oficiais. Mas Router, Mission, workers e
 * scheduler não rodam scripts por shell: eles SPAWNAM comandos (sandbox Docker,
 * fila de execução, deadline de operação). Esses caminhos são alternativas reais
 * de execução — se o gate só existir no shell, `runInSandbox('npm run
 * validate:governance-enforcement')` contornaria tudo.
 *
 * Esta política fecha o caminho: qualquer comando que corresponda a uma operação
 * EXTENSIVA é classificado e precisa de autorização. Comando de correção/teste
 * direcionado continua livre (senão o próprio laço de conserto morreria).
 *
 * PRINCÍPIO: a classificação é por PADRÃO EXPLÍCITO (lista fechada), nunca por
 * heurística de "parece extensivo". Comando desconhecido não é bloqueado por
 * aqui — as guardas de execução continuam valendo.
 */

const { execFileSync } = require('child_process');
const path = require('path');

const { evaluateExecutionEligibility, OPERACOES } = require('./eligibility');
const { carregarInventario } = require('./defect-registry');

const ROOT = path.resolve(__dirname, '..', '..');

function headSha() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (_) {
    return '';
  }
}

/**
 * Padrões que caracterizam execução EXTENSIVA (lista fechada e auditável).
 * `operacao` é o que o motor de elegibilidade avalia.
 */
const COMANDOS_EXTENSIVOS = Object.freeze([
  { padrao: /validate:governance-enforcement/, operacao: OPERACOES.L2_L3_EXTENSIVO, motivo: 'gate agregado de governança (63 passos)' },
  { padrao: /test:release-authoritative|run-release-suites/, operacao: OPERACOES.L2_L3_EXTENSIVO, motivo: 'suíte autoritativa de release (L2)' },
  { padrao: /release:seal|seal-release\.sh/, operacao: OPERACOES.SELO_FINAL, motivo: 'selagem de release' },
  { padrao: /zip:release|release-package\.sh/, operacao: OPERACOES.PUBLICACAO_RELEASE, motivo: 'empacotamento de release' },
  { padrao: /qa:mesh|runQaMesh|meshRunner\.js/, operacao: OPERACOES.QA_WAVES_COMPLETA, motivo: 'QA Mesh completo' },
  { padrao: /wave:(api-surface|page-surface|db-integrity)|api-surface-wave\.js|page-surface-wave\.js|db-integrity-wave\.js/, operacao: OPERACOES.QA_WAVES_COMPLETA, motivo: 'QA Wave técnica' },
  { padrao: /converge-governance\.sh/, operacao: OPERACOES.CONVERGENCIA_COMPLETA, motivo: 'convergência completa' },
  { padrao: /engineering-router:v2-seal|engineering-router-v2-seal\.js/, operacao: OPERACOES.SELO_FINAL, motivo: 'selo V2' },
  { padrao: /runFullValidation|pipeline:run/, operacao: OPERACOES.L2_L3_EXTENSIVO, motivo: 'pipeline de validação completa' },
  { padrao: /engineering-validation-orchestrator\.js/, operacao: OPERACOES.L2_L3_EXTENSIVO, motivo: 'orquestrador L1/L2/L3 (escala para L2/L3)' },
  { padrao: /test:system\b/, operacao: OPERACOES.L2_L3_EXTENSIVO, motivo: 'suíte de sistema (L2)' },
]);

/** Comandos que NUNCA são extensivos (correção/verificação direcionada). */
const SEMPRE_PERMITIDOS = Object.freeze([
  /^npx jest\b/,
  /^npm run test:unit\b/,
  /^node --check\b/,
  /^git (diff|status|log|show)\b/,
]);

function linhaDoComando(command, args) {
  const lista = Array.isArray(args) ? args.join(' ') : '';
  return `${command || ''} ${lista}`.trim();
}

/**
 * Classifica uma linha de comando.
 * @returns {{extensiva: false} | {extensiva: true, operacao: string, motivo: string}}
 */
function classificarComando(command, args) {
  const linha = linhaDoComando(command, args);
  if (!linha) return { extensiva: false };
  if (SEMPRE_PERMITIDOS.some((re) => re.test(linha))) return { extensiva: false };
  for (const regra of COMANDOS_EXTENSIVOS) {
    if (regra.padrao.test(linha)) {
      return { extensiva: true, operacao: regra.operacao, motivo: regra.motivo, comando: linha };
    }
  }
  return { extensiva: false };
}

/**
 * Avalia autorização para um comando de processo filho.
 *
 * @param {object} entrada
 * @param {string} entrada.command
 * @param {string[]} [entrada.args]
 * @param {string} [entrada.actor] — quem está spawnando (router, mission, worker…)
 * @param {object} [entrada.contexto] — sobrescreve commit/defeitos (testes)
 * @returns {{permitido: boolean, extensiva: boolean, operacao?: string, motivo?: string, decisao?: object}}
 */
function avaliarComando(entrada = {}) {
  const classe = classificarComando(entrada.command, entrada.args);
  if (!classe.extensiva) return { permitido: true, extensiva: false };

  let contexto = entrada.contexto;
  if (!contexto) {
    let inventario;
    try {
      inventario = carregarInventario();
    } catch (erro) {
      // Sem inventário não há prova de ausência de defeito: fail-closed.
      return {
        permitido: false,
        extensiva: true,
        operacao: classe.operacao,
        motivo: classe.motivo,
        comando: classe.comando,
        erroInventario: String(erro.message || erro),
      };
    }
    contexto = {
      commit: entrada.commit || process.env.SOURCE_COMMIT || headSha(),
      actor: { id: entrada.actor || 'command-policy', kind: 'child_process' },
      defects: inventario.defeitos,
    };
  }

  const decisao = evaluateExecutionEligibility(contexto, classe.operacao);
  return {
    permitido: decisao.allowed,
    extensiva: true,
    operacao: classe.operacao,
    motivo: classe.motivo,
    comando: classe.comando,
    decisao,
  };
}

/** Erro tipado usado pelos chamadores que precisam abortar com código próprio. */
function erroDeBloqueio(avaliacao) {
  const erro = new Error(
    `BUG_CLOSURE_BLOCKED: comando extensivo recusado (${avaliacao.operacao}) — `
    + `${(avaliacao.decisao && avaliacao.decisao.reasonCodes || ['INVENTARIO_INDISPONIVEL']).join(', ')}`
  );
  erro.code = 'BUG_CLOSURE_BLOCKED';
  erro.operacao = avaliacao.operacao;
  erro.decisao = avaliacao.decisao || null;
  erro.comando = avaliacao.comando || null;
  return erro;
}

module.exports = { COMANDOS_EXTENSIVOS, SEMPRE_PERMITIDOS, classificarComando, avaliarComando, erroDeBloqueio };
