'use strict';

/**
 * governance/risk-acceptance/index.js — CARREGADOR E AGREGADOR DOS BLOQUEIOS CLASSIFICADOS.
 *
 * Entrega ao gate `validate-engineer-supervised-readiness` os quatro baldes exigidos pela missão
 * L-1 FINAL §6 — e nunca os mistura:
 *
 *   RESOLVED_VERIFIED  — o defeito foi corrigido e um PROBE executado agora provou isso;
 *   ACCEPTED_RISK      — risco vivo, aceito por autoridade humana com assinatura válida;
 *   NOT_APPLICABLE     — risco vivo, mas pertence a OUTRA decisão (roteado, não aceito);
 *   BLOCKED            — nada disso vale: continua bloqueando.
 *
 * Regras de carregamento (todas fail-closed):
 *   - roteamento ausente/ilegível ⇒ TODOS os itens ficam BLOCKED (não existe "sem opinião = ok");
 *   - aceite ilegível/ inválido   ⇒ BLOCKED com o motivo, nunca ignorado;
 *   - probe executado com `spawnSync` e allowlist de prefixo (`npm run`, `node scripts/`,
 *     `bash scripts/`) — o roteamento é ato de governança versionado, mas não pode virar execução
 *     arbitrária se alguém editar o JSON;
 *   - timeout curto por probe: um probe lento não pode travar a decisão.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const { resolverItemBloqueado, DECISOES } = require('./policy');

const ROUTING_REL = 'governance/risk-routing/l1-scope-routing.json';
const ACCEPT_DIR = 'governance/risk-acceptance/acceptances';
const AUTHORITIES_REL = 'governance/risk-acceptance/authorities.json';

const PROBE_PREFIXOS_PERMITIDOS = ['npm run', 'node scripts/', 'bash scripts/'];
const PROBE_TIMEOUT_MS = Number(process.env.RISK_PROBE_TIMEOUT_MS) || 240000;

function lerJsonAbs(abs) {
  try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (_) { return null; }
}

/**
 * Executa um probe declarado no roteamento, de forma restrita e auditável.
 * @returns {{exitCode:number|null, sha256Saida:string, comando:string, motivo?:string}}
 */
function criarExecutorDeProbe(rootDir) {
  return (comando) => {
    const cmd = String(comando || '').trim();
    if (!PROBE_PREFIXOS_PERMITIDOS.some((p) => cmd.startsWith(p))) {
      return { exitCode: null, sha256Saida: '', comando: cmd, motivo: 'PROBE_FORA_DA_ALLOWLIST' };
    }
    const r = spawnSync('bash', ['-lc', cmd], {
      cwd: rootDir,
      encoding: 'utf8',
      timeout: PROBE_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    const saida = `${r.stdout || ''}${r.stderr || ''}`;
    return {
      exitCode: typeof r.status === 'number' ? r.status : 1,
      sha256Saida: crypto.createHash('sha256').update(saida, 'utf8').digest('hex'),
      comando: cmd,
      ...(r.error ? { motivo: r.error.code || 'PROBE_ERRO' } : {}),
    };
  };
}

/**
 * Carrega aceites individuais (um arquivo por risco).
 * @returns {Map<string, object>} riskId → aceite
 */
function carregarAceites(rootDir) {
  const mapa = new Map();
  const dir = path.join(rootDir, ACCEPT_DIR);
  let arquivos = [];
  try { arquivos = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch (_) { return mapa; }
  for (const arquivo of arquivos) {
    const doc = lerJsonAbs(path.join(dir, arquivo));
    if (doc && typeof doc.riskId === 'string') mapa.set(doc.riskId, doc);
  }
  return mapa;
}

/**
 * Resolve TODOS os itens bloqueados da fila para a decisão pedida.
 *
 * @param {object} input
 * @param {string} input.rootDir raiz do repositório
 * @param {object[]} input.itensBloqueados itens com status blocked/blocked_external
 * @param {string} input.sourceCommit commit medido (HEAD)
 * @param {string} [input.decisao]
 * @param {number} [input.agora]
 * @returns {{baldes:{RESOLVED_VERIFIED:object[],ACCEPTED_RISK:object[],NOT_APPLICABLE:object[],BLOCKED:object[]}, roteamentoLegivel:boolean, aceitesLegiveis:number, autoridades:number, problemas:string[]}}
 */
function resolverBloqueios({
  rootDir,
  itensBloqueados = [],
  sourceCommit,
  decisao = 'ENGINEER_SUPERVISED_READINESS',
  agora,
} = {}) {
  const problemas = [];
  if (!DECISOES[decisao]) problemas.push(`DECISAO_DESCONHECIDA:${decisao}`);

  const roteamento = lerJsonAbs(path.join(rootDir, ROUTING_REL));
  const roteamentoLegivel = Boolean(roteamento && roteamento.items && typeof roteamento.items === 'object');
  if (!roteamentoLegivel) problemas.push('ROTEAMENTO_AUSENTE_OU_ILEGIVEL');

  const autoridadesDoc = lerJsonAbs(path.join(rootDir, AUTHORITIES_REL));
  const autoridades = autoridadesDoc && Array.isArray(autoridadesDoc.authorities) ? autoridadesDoc.authorities : [];
  const aceites = carregarAceites(rootDir);

  const ctxBase = {
    sourceCommit,
    decisao,
    autoridades,
    agora,
    existeArquivo: (rel) => fs.existsSync(path.join(rootDir, rel)),
    executarProbe: criarExecutorDeProbe(rootDir),
  };

  const baldes = { RESOLVED_VERIFIED: [], ACCEPTED_RISK: [], NOT_APPLICABLE: [], BLOCKED: [] };

  for (const item of itensBloqueados) {
    const riskId = String(item && item.id);
    const rota = roteamentoLegivel ? roteamento.items[riskId] : null;
    const aceite = aceites.get(riskId) || null;
    const resultado = resolverItemBloqueado(item, rota, { ...ctxBase, riskId, aceite });
    baldes[resultado.estado] ? baldes[resultado.estado].push({ ...resultado, statusOriginal: item.status })
      : baldes.BLOCKED.push({ ...resultado, statusOriginal: item.status });
  }

  return {
    baldes,
    roteamentoLegivel,
    aceitesLegiveis: aceites.size,
    autoridades: autoridades.length,
    problemas,
  };
}

module.exports = { resolverBloqueios, carregarAceites, criarExecutorDeProbe, ROUTING_REL, ACCEPT_DIR, AUTHORITIES_REL };
