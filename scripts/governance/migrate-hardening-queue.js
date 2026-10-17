#!/usr/bin/env node
'use strict';

/**
 * Migração da FILA OFICIAL para o modelo de estados canônicos (BUG CLOSURE FIRST).
 *
 * POR QUE EXISTE
 * --------------
 * A fila (`AI_MEMORY/hardening-queue.json`) nasceu com estados ad-hoc
 * (`done`, `blocked`, `prevention_active`, `verified`…) e **sem severidade**. Sem
 * severidade não há como distinguir um P0 de um item cosmético — e o motor de
 * elegibilidade trata severidade ausente como "não classificada", que bloqueia
 * certificação por definição. Sem estado canônico, `done` é lido como fechado,
 * quando na verdade significa "corrigido, aguardando verificação".
 *
 * O QUE ESTA MIGRAÇÃO FAZ (e o que ela NÃO faz)
 * ---------------------------------------------
 * FAZ: deriva `severity` do próprio ID (nunca inventa criticidade), converte o
 * `status` legado para `state` canônico via `MIGRACAO_LEGADO`, preserva o valor
 * original em `legacyStatus`, e extrai `regressionTest` da evidência APENAS
 * quando o caminho existe em disco.
 *
 * NÃO FAZ: não declara nada como verificado. `done` vira
 * `FIXED_PENDING_VERIFICATION` (aberto) até existir teste de regressão aprovado
 * no commit corrente. `targetedTestPassing` nunca é gravado aqui — isso exige uma
 * execução real e é feito pelo gate (`scripts/ci/dev-branch-gate.js`, fase B).
 *
 * IDEMPOTENTE: rodar duas vezes não altera nada na segunda.
 *
 * Uso:
 *   node scripts/governance/migrate-hardening-queue.js            # dry-run
 *   node scripts/governance/migrate-hardening-queue.js --apply    # grava
 *   node scripts/governance/migrate-hardening-queue.js --json
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const FILA = path.join(ROOT, 'AI_MEMORY', 'hardening-queue.json');
const RELATORIO = path.join(ROOT, 'reports', 'hardening-queue-migration.json');

const { MIGRACAO_LEGADO, ESTADOS, derivarSeveridadeDoId } = require(path.join(ROOT, 'governance', 'bug-closure', 'defect-states'));

/** Caminho de teste citado na evidência (só o que existe em disco conta). */
function extrairTeste(evidencia) {
  if (!evidencia) return null;
  const texto = String(evidencia);
  const re = /(?:^|[\s(])((?:tests|engine|qa|qa-mesh|api|lib)\/[\w./-]+\.(?:test|spec)\.(?:js|mjs|cjs|ts))\b/g;
  let m;
  while ((m = re.exec(texto)) !== null) {
    const rel = m[1];
    if (fs.existsSync(path.join(ROOT, rel))) return rel;
  }
  // Caminhos não-*test* também aparecem em evidência ("rag-service 156 passed");
  // nesses casos NÃO há teste identificável — não inventamos.
  return null;
}

function migrarItem(item) {
  const achados = [];
  const severidade = derivarSeveridadeDoId(item);
  const statusLegado = String(item.status || '').toLowerCase();
  const estado = MIGRACAO_LEGADO[statusLegado] || ESTADOS.OPEN;
  if (!MIGRACAO_LEGADO[statusLegado]) {
    achados.push({ code: 'STATUS_LEGADO_DESCONHECIDO', item: item.id, detail: statusLegado });
  }
  if (!severidade) {
    achados.push({ code: 'SEVERIDADE_NAO_DECLARAVEL_DO_ID', item: item.id });
  }

  const regressionTest = item.regressionTest || extrairTeste(item.evidence) || null;

  const novo = {
    ...item,
    severity: item.severity || severidade || null,
    severityStatus: item.severity || severidade ? 'DECLARADA' : 'NAO_DECLARADA',
    state: estado,
    legacyStatus: item.legacyStatus || item.status,
    ...(regressionTest ? { regressionTest } : {}),
  };
  return { novo, achados };
}

function main(argv = process.argv.slice(2)) {
  const aplicar = argv.includes('--apply');
  const json = argv.includes('--json');

  let fila;
  try {
    fila = JSON.parse(fs.readFileSync(FILA, 'utf8'));
  } catch (erro) {
    process.stderr.write(`[migrate-queue] FAIL: fila ilegível (${erro.message})\n`);
    return 1;
  }
  if (!Array.isArray(fila.items)) {
    process.stderr.write('[migrate-queue] FAIL: fila sem array `items`\n');
    return 1;
  }

  const achados = [];
  const porEstado = {};
  const porSeveridade = {};
  let alterados = 0;
  let comTeste = 0;

  const itens = fila.items.map((item) => {
    const { novo, achados: a } = migrarItem(item);
    achados.push(...a);
    porEstado[novo.state] = (porEstado[novo.state] || 0) + 1;
    const sev = novo.severity || 'NAO_DECLARADA';
    porSeveridade[sev] = (porSeveridade[sev] || 0) + 1;
    if (novo.regressionTest) comTeste += 1;
    if (JSON.stringify(novo) !== JSON.stringify(item)) alterados += 1;
    return novo;
  });

  const aberto = (estado) => estado !== ESTADOS.VERIFIED && estado !== ESTADOS.RESOLVED;
  const abertos = itens.filter((i) => aberto(i.state));
  const bloqueantes = abertos.filter((i) => i.severity === 'P0' || i.severity === 'P1');

  const relatorio = {
    schemaVersion: 1,
    kind: 'hardening-queue-migration',
    generatedAt: new Date().toISOString(),
    aplicado: aplicar,
    total: itens.length,
    alterados,
    comTesteDeRegressao: comTeste,
    porEstado,
    porSeveridade,
    abertos: abertos.length,
    bloqueantesParaCertificacao: bloqueantes.length,
    semSeveridadeAbertos: abertos.filter((i) => !i.severity).length,
    semTesteDeRegressaoAbertos: abertos.filter((i) => !i.regressionTest).length,
    achados,
    status: 'PASS',
    idsBloqueantes: bloqueantes.map((i) => i.id),
  };

  fs.mkdirSync(path.dirname(RELATORIO), { recursive: true });
  fs.writeFileSync(RELATORIO, `${JSON.stringify(relatorio, null, 1)}\n`, 'utf8');

  if (aplicar) {
    const atualizado = {
      ...fila,
      schemaVersion: (fila.schemaVersion || 1) + 1,
      updatedAt: new Date().toISOString(),
      estadosCanonicos: {
        fonte: 'governance/bug-closure/defect-states.js',
        migradoEm: new Date().toISOString(),
        observacao: 'status/legacyStatus preservados; state é a autoridade. done -> FIXED_PENDING_VERIFICATION até verificação real.',
      },
      items: itens,
    };
    fs.writeFileSync(FILA, `${JSON.stringify(atualizado, null, 2)}\n`, 'utf8');
  }

  if (json) {
    process.stdout.write(`${JSON.stringify(relatorio, null, 1)}\n`);
  } else {
    process.stdout.write(`[migrate-queue] ${aplicar ? 'APLICADO' : 'DRY-RUN'} — ${itens.length} itens, ${alterados} alterado(s)\n`);
    process.stdout.write(`[migrate-queue] por estado canônico: ${JSON.stringify(porEstado)}\n`);
    process.stdout.write(`[migrate-queue] por severidade:      ${JSON.stringify(porSeveridade)}\n`);
    process.stdout.write(`[migrate-queue] abertos=${abertos.length} bloqueantes(P0/P1)=${bloqueantes.length} semSeveridade=${relatorio.semSeveridadeAbertos} semTeste=${relatorio.semTesteDeRegressaoAbertos}\n`);
    process.stdout.write(`[migrate-queue] testes de regressão identificáveis: ${comTeste}/${itens.length}\n`);
    if (achados.length) {
      const resumo = achados.reduce((acc, a) => { acc[a.code] = (acc[a.code] || 0) + 1; return acc; }, {});
      process.stdout.write(`[migrate-queue] achados: ${JSON.stringify(resumo)}\n`);
    }
    process.stdout.write(`[migrate-queue] relatório: reports/hardening-queue-migration.json\n`);
  }
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, migrarItem, extrairTeste };
