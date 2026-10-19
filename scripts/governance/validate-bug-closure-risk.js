#!/usr/bin/env node
'use strict';

/**
 * AUDITORIA DE RISK_ACCEPTED — BUG CLOSURE FIRST (missão 2026-10-17, item 5).
 *
 * REGRA: aceitação de risco NUNCA dispensa controle inegociável
 * (`INTEGRIDADE_CRIPTOGRAFICA`, `IDENTIDADE`, `AUTORIZACAO`, `GATE_OBRIGATORIO`)
 * e nunca se aplica a um P0. Um `RISK_ACCEPTED` sem aprovador, justificativa,
 * escopo e prazo é alegação — não decisão auditável.
 *
 * Escopo da auditoria:
 *  1. itens da fila oficial em estado `RISK_ACCEPTED`;
 *  2. relatórios de waiver do Security Intelligence (`reports/security-intel-waiver*`),
 *     quando existirem: waiver aprovado sobre controle crítico é violação.
 *
 * NÃO decide aceitação de risco: apenas verifica se o registro está completo e se
 * toca controle proibido. A decisão de negócio continua sendo do responsável.
 *
 * Uso: node scripts/governance/validate-bug-closure-risk.js [--json]
 * Exit 0 = nenhuma violação; 1 = violação (bloqueia).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const RELATORIO = path.join(ROOT, 'reports', 'bug-closure-risk-report.json');

const { ESTADOS, CONTROLES_INEGOCIAVEIS } = require(path.join(ROOT, 'governance', 'bug-closure', 'defect-states'));
const { carregarInventario } = require(path.join(ROOT, 'governance', 'bug-closure', 'defect-registry'));

const NAO_VAZIO = (v) => v !== undefined && v !== null && String(v).trim() !== '';

const CAMPOS_OBRIGATORIOS_RISCO = Object.freeze(['justification', 'approvedBy', 'approvedAt', 'scope', 'expiresAt']);

/** Controles que o item declara tocar (`touches`), normalizados. */
function controlesDoItem(item) {
  const bruto = item && item.touches;
  const lista = Array.isArray(bruto) ? bruto : (NAO_VAZIO(bruto) ? [bruto] : []);
  return lista.map((t) => String(t).trim().toUpperCase());
}

function auditarItem(item) {
  const violacoes = [];
  const riscos = item.riskAcceptance && typeof item.riskAcceptance === 'object' ? item.riskAcceptance : item;

  for (const campo of CAMPOS_OBRIGATORIOS_RISCO) {
    if (!NAO_VAZIO(riscos[campo])) {
      violacoes.push({
        code: 'RISCO_ACEITO_SEM_REGISTRO',
        item: item.id,
        detail: `RISK_ACCEPTED exige "${campo}" (aceitação sem registro não é decisão auditável)`,
      });
    }
  }

  const aceito = String((item.severity) || '').toUpperCase();
  if (aceito === 'P0') {
    violacoes.push({
      code: 'RISCO_ACEITO_EM_P0',
      item: item.id,
      detail: 'P0 não pode ser aceito como risco: exige correção verificada',
    });
  }

  const tocaCritico = controlesDoItem(item).filter((c) => CONTROLES_INEGOCIAVEIS.includes(c));
  if (tocaCritico.length > 0) {
    violacoes.push({
      code: 'RISCO_EM_CONTROLE_INEGOCIAVEL',
      item: item.id,
      detail: `toca ${tocaCritico.join(',')} — não dispensável por aceitação de risco`,
    });
  }

  return violacoes;
}

/** Relatórios do Security Intelligence: waiver aprovado sobre controle crítico. */
function auditarRelatoriosDeWaiver() {
  const violacoes = [];
  const alvos = [
    'reports/security-intel-waivers-report.json',
    'reports/security-intel-waiver-request-report.json',
  ];
  const lidos = [];
  for (const rel of alvos) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    let dados;
    try {
      dados = JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch (erro) {
      violacoes.push({ code: 'WAIVER_ILEGIVEL', detail: `${rel}: ${String(erro.message || erro).slice(0, 120)}` });
      continue;
    }
    const itens = Array.isArray(dados) ? dados : (dados.waivers || dados.items || dados.requests || []);
    lidos.push({ relatorio: rel, itens: itens.length });
    for (const w of itens) {
      const controle = String((w && (w.control || w.controle || w.controlId)) || '').toUpperCase();
      const aprovado = String((w && (w.status || w.state)) || '').toLowerCase();
      const critico = CONTROLES_INEGOCIAVEIS.includes(controle);
      if (critico && /aprov|approved|granted|active/.test(aprovado)) {
        violacoes.push({
          code: 'WAIVER_APROVADO_EM_CONTROLE_INEGOCIAVEL',
          detail: `${rel}: waiver ${w.id || '(sem id)'} aprovado sobre ${controle}`,
        });
      }
    }
  }
  return { violacoes, lidos };
}

function main(argv = process.argv.slice(2)) {
  const json = argv.includes('--json');
  const violacoes = [];
  let resumoFila = null;

  try {
    const inventario = carregarInventario();
    const aceitos = inventario.defeitos.filter((d) => d.state === ESTADOS.RISK_ACCEPTED);
    for (const item of aceitos) violacoes.push(...auditarItem(item));
    resumoFila = {
      total: inventario.resumo.total,
      riscoAceito: aceitos.length,
      idsRiscoAceito: aceitos.map((d) => d.id),
    };
  } catch (erro) {
    violacoes.push({ code: 'INVENTARIO_INDISPONIVEL', detail: String(erro.message || erro) });
  }

  const waivers = auditarRelatoriosDeWaiver();
  violacoes.push(...waivers.violacoes);

  const status = violacoes.length === 0 ? 'PASS' : 'FAIL';
  const relatorio = {
    schemaVersion: 1,
    kind: 'bug-closure-risk',
    generatedAt: new Date().toISOString(),
    status,
    controlesInegociaveis: CONTROLES_INEGOCIAVEIS,
    camposObrigatoriosRisco: CAMPOS_OBRIGATORIOS_RISCO,
    fila: resumoFila,
    relatoriosDeWaiver: waivers.lidos,
    violacoes,
  };

  fs.mkdirSync(path.dirname(RELATORIO), { recursive: true });
  fs.writeFileSync(RELATORIO, `${JSON.stringify(relatorio, null, 1)}\n`, 'utf8');

  if (json) {
    process.stdout.write(`${JSON.stringify(relatorio, null, 1)}\n`);
  } else {
    process.stdout.write(
      `[bug-closure-risk] risco aceito na fila: ${resumoFila ? resumoFila.riscoAceito : '?'} `
      + `| relatórios de waiver: ${waivers.lidos.map((l) => `${l.relatorio}(${l.itens})`).join(', ') || 'nenhum'}\n`
    );
    if (status === 'PASS') {
      process.stdout.write('[bug-closure-risk] PASS — nenhuma dispensa de controle inegociável\n');
    } else {
      process.stdout.write(`[bug-closure-risk] FAIL: ${violacoes.length} violação(ões)\n`);
      for (const v of violacoes.slice(0, 8)) process.stdout.write(`  ${v.code} ${v.item || ''} — ${v.detail || ''}\n`);
    }
  }
  return status === 'PASS' ? 0 : 1;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, auditarItem, auditarRelatoriosDeWaiver, CAMPOS_OBRIGATORIOS_RISCO };
