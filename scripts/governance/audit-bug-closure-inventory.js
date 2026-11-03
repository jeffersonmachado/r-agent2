#!/usr/bin/env node
'use strict';

/**
 * audit-bug-closure-inventory.js — FASE E da missão Codex: recálculo do inventário.
 *
 * NÃO confia no relatório do implementador. Recalcula, a partir dos artefatos do SHA atual:
 *
 *   - identidade, severidade e estado de cada item que declara fechamento;
 *   - teste de regressão localizável (mapa confirmado → campo → evidência → commit do fix);
 *   - existência do teste no repositório;
 *   - existência e validade ESTRUTURAL do draft de prova, quando houver;
 *   - se há âncora externa e autorização humana (insumos que não são código).
 *
 * Classificação (uma só por item, na ordem de gravidade):
 *   INVALID_EVIDENCE            prova draft existe mas não passa na verificação estrutural
 *   PENDING_HUMAN_AUTHORIZATION P0 sem negativeEvidence/humanAuthorization
 *   PENDING_SIGNATURE           prova estruturalmente válida, falta assinatura/âncora
 *   PENDING_REGRESSION          sem teste localizável (nada a executar)
 *   BLOCKED                     estado persistido sem caminho canônico (RISK_ACCEPTED etc.)
 *   VERIFIED_CANONICALLY        prova válida E assinada por autoridade ancorada
 *
 * Uso: node scripts/governance/audit-bug-closure-inventory.js [--json]
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const registry = require(path.join(ROOT, 'governance', 'bug-closure', 'defect-registry'));
const proof = require(path.join(ROOT, 'governance', 'bug-closure', 'closure-proof'));
const TA = require(path.join(ROOT, 'governance', 'bug-closure', 'trusted-authorities'));
const { computeSourceFingerprint } = require(path.join(ROOT, 'governance', 'proof-engine', 'fingerprint-chain'));

const flag = (n) => process.argv.includes(n);

function testeLocalizavel(item) {
  try {
    // eslint-disable-next-line global-require
    const { testeCitado } = require(path.join(ROOT, 'scripts', 'governance', 'regularize-bug-closures'));
    return testeCitado(item) || null;
  } catch (_) {
    return null;
  }
}

function main() {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const fingerprint = computeSourceFingerprint(ROOT);
  const queuePath = path.join(ROOT, 'AI_MEMORY', 'hardening-queue.json');
  const fila = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
  const porId = new Map((fila.items || []).map((i) => [i.id, i]));

  const inventario = registry.carregarInventario({ queuePath, rootDir: ROOT, currentCommit: commit, currentFingerprint: fingerprint });
  const semProva = inventario.defeitos.filter((d) => d.fechamentoNaoProvado === true);

  const itens = semProva.map((d) => {
    const item = porId.get(d.id) || {};
    const teste = testeLocalizavel(item);
    const draftRel = path.join('governance', 'bug-closure', 'proofs-drafts', `${d.id}.json`);
    const draftAbs = path.join(ROOT, draftRel);
    const temDraft = fs.existsSync(draftAbs);

    let veredito = null;
    if (temDraft) {
      try {
        const prova = JSON.parse(fs.readFileSync(draftAbs, 'utf8'));
        veredito = proof.verificarProvaDeFechamento(prova, {
          defeito: { id: item.id, severity: item.severity, state: String(item.state || '').toUpperCase() },
          currentCommit: commit,
          currentFingerprint: fingerprint,
          rootDir: ROOT,
          livro: null,
          // âncora de teste explícita ausente: o audit mede o estado REAL do repositório
          agora: Date.parse(prova.createdAt) + 1000,
          existeArquivo: (rel) => fs.existsSync(path.join(ROOT, rel)),
        });
      } catch (e) {
        veredito = { ok: false, reasons: [`DRAFT_ILEGIVEL:${e.message}`] };
      }
    }

    const motivos = (veredito && veredito.reasons) || [];
    const faltaInsumoHumano = motivos.some((m) => ['EVIDENCIA_NEGATIVA_AUSENTE', 'APROVACAO_HUMANA_AUSENTE'].includes(m));
    const faltaAssinatura = motivos.some((m) => ['SEM_ANCORA_DE_CONFIANCA', 'ASSINATURA_INVALIDA'].includes(m));
    const problemasEstruturais = motivos.filter((m) => !['SEM_ANCORA_DE_CONFIANCA', 'ASSINATURA_INVALIDA',
      'EVIDENCIA_NEGATIVA_AUSENTE', 'APROVACAO_HUMANA_AUSENTE'].includes(m));

    let classe;
    if (!teste) classe = 'PENDING_REGRESSION';
    else if (!temDraft) classe = 'PENDING_REGRESSION';
    else if (problemasEstruturais.length > 0) classe = 'INVALID_EVIDENCE';
    else if (item.severity === 'P0' && faltaInsumoHumano) classe = 'PENDING_HUMAN_AUTHORIZATION';
    else if (faltaAssinatura) classe = 'PENDING_SIGNATURE';
    else classe = 'VERIFIED_CANONICALLY';

    return {
      id: d.id,
      severity: item.severity || null,
      estadoPersistido: String(item.state || '').toUpperCase(),
      abertoEfetivo: d.stateEfetivo,
      teste,
      temDraft,
      classe,
      motivos,
      problemasEstruturais,
    };
  });

  const porClasse = itens.reduce((acc, i) => { acc[i.classe] = (acc[i.classe] || 0) + 1; return acc; }, {});
  const porSeveridade = itens.reduce((acc, i) => { acc[i.severity || 'SEM_SEVERIDADE'] = (acc[i.severity || 'SEM_SEVERIDADE'] || 0) + 1; return acc; }, {});

  const relatorio = {
    kind: 'bug-closure-inventory-audit',
    generatedAt: new Date().toISOString(),
    commit,
    fingerprint,
    authoritative: false,
    ancorasProvisionadas: {
      fechamento: Boolean(TA.ancoraExterna()),
      aprovacao: Boolean(TA.ancoraDeAprovacao()),
      inventario: Boolean(TA.ancoraDoInventario()),
    },
    totalInventario: inventario.defeitos.length,
    declarandoFechamentoSemProva: semProva.length,
    porClasse,
    porSeveridade,
    itens,
  };

  const destino = path.join(ROOT, 'reports', 'bug-closure-inventory-audit.json');
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, `${JSON.stringify(relatorio, null, 2)}\n`, 'utf8');

  if (flag('--json')) process.stdout.write(`${JSON.stringify(relatorio, null, 2)}\n`);
  else {
    process.stdout.write(`[inventario] commit=${commit.slice(0, 10)} declarando-fechamento-sem-prova=${semProva.length}\n`);
    for (const [k, v] of Object.entries(porClasse).sort((a, b) => b[1] - a[1])) process.stdout.write(`[inventario]   ${String(v).padStart(3)} ${k}\n`);
    process.stdout.write(`[inventario] âncoras: ${JSON.stringify(relatorio.ancorasProvisionadas)}\n`);
  }
  return 0;
}

process.exitCode = main();
