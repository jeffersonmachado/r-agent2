/**
 * Utilitário para comparar replays e gerar diffs.
 * 
 * Execute: node tests/rpa/replayDiff.js <baseline> <actual>
 */

const { ReplaySystem } = require('../../core/rpa/replaySystem');
const fs = require('fs');
const path = require('path');

function generateDiffReport(baselineFile, actualFile) {
  console.log('🔍 Gerando Diff de Replays\n');
  console.log('='.repeat(70));

  // Carrega replays
  const baseline = ReplaySystem.load(baselineFile);
  const actual = ReplaySystem.load(actualFile);

  console.log(`\n📊 Baseline: ${baseline.id} (${baseline.recordingId})`);
  console.log(`📊 Atual: ${actual.id} (${actual.recordingId})\n`);

  // Gera diff
  const diff = ReplaySystem.generateDiff(baseline, actual);

  // Relatório
  const report = [];
  report.push('='.repeat(70));
  report.push('📋 RELATÓRIO DE DIFF');
  report.push('='.repeat(70));
  report.push('');

  // Diff de telas
  if (diff.screens.length > 0) {
    report.push('📺 DIFERENÇAS EM TELAS:');
    report.push('-'.repeat(70));
    diff.screens.forEach((screenDiff, index) => {
      report.push(`${index + 1}. Step ${screenDiff.step} - ${screenDiff.type.toUpperCase()}`);
      if (screenDiff.type === 'changed') {
        report.push(`   Esperado: ${JSON.stringify(screenDiff.expected, null, 2)}`);
        report.push(`   Atual: ${JSON.stringify(screenDiff.actual, null, 2)}`);
      } else if (screenDiff.type === 'added') {
        report.push(`   Tela adicionada: ${screenDiff.screen.signature}`);
      } else if (screenDiff.type === 'removed') {
        report.push(`   Tela removida: ${screenDiff.screen.signature}`);
      }
      report.push('');
    });
  } else {
    report.push('✅ Nenhuma diferença em telas');
    report.push('');
  }

  // Diff de ações
  if (diff.actions.length > 0) {
    report.push('🎬 DIFERENÇAS EM AÇÕES:');
    report.push('-'.repeat(70));
    diff.actions.forEach((actionDiff, index) => {
      report.push(`${index + 1}. Step ${actionDiff.step} - ${actionDiff.type.toUpperCase()}`);
      if (actionDiff.type === 'changed') {
        report.push(`   Motivo: ${actionDiff.reason}`);
        report.push(`   Esperado: ${actionDiff.expected.success ? '✅' : '❌'}`);
        report.push(`   Atual: ${actionDiff.actual.success ? '✅' : '❌'}`);
        if (actionDiff.actual.error) {
          report.push(`   Erro: ${actionDiff.actual.error}`);
        }
      } else if (actionDiff.type === 'added') {
        report.push(`   Ação adicionada: ${actionDiff.action.type}`);
      } else if (actionDiff.type === 'removed') {
        report.push(`   Ação removida: ${actionDiff.action.type}`);
      }
      report.push('');
    });
  } else {
    report.push('✅ Nenhuma diferença em ações');
    report.push('');
  }

  // Diff de timings
  if (diff.timings.total) {
    report.push('⏱️  DIFERENÇAS EM TIMINGS:');
    report.push('-'.repeat(70));
    report.push(`   Esperado: ${diff.timings.total.expected}ms`);
    report.push(`   Atual: ${diff.timings.total.actual}ms`);
    report.push(`   Diferença: ${diff.timings.total.difference}ms`);
    report.push('');
  } else {
    report.push('✅ Nenhuma diferença significativa em timings');
    report.push('');
  }

  // Erros novos
  if (diff.errors.length > 0) {
    report.push('❌ ERROS NOVOS:');
    report.push('-'.repeat(70));
    diff.errors.forEach((error, index) => {
      report.push(`${index + 1}. Step ${error.step}`);
      report.push(`   Mensagem: ${error.message}`);
      report.push('');
    });
  }

  report.push('='.repeat(70));

  const reportText = report.join('\n');
  console.log(reportText);

  // Salva diff
  const diffDir = path.join(__dirname, 'replay');
  if (!fs.existsSync(diffDir)) {
    fs.mkdirSync(diffDir, { recursive: true });
  }

  const diffFile = path.join(diffDir, `diff-${baselineFile}-${actualFile}-${Date.now()}.txt`);
  fs.writeFileSync(diffFile, reportText, 'utf8');
  console.log(`\n💾 Diff salvo em: ${diffFile}\n`);

  return {
    hasDifferences: diff.screens.length > 0 || diff.actions.length > 0 || diff.errors.length > 0,
    diff,
  };
}

// Executa se chamado diretamente
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error('Uso: node replayDiff.js <baseline> <actual>');
    console.error('Exemplo: node replayDiff.js replay-123 replay-456');
    process.exit(1);
  }

  const [baselineFile, actualFile] = args;
  generateDiffReport(baselineFile, actualFile);
}

module.exports = {
  generateDiffReport,
};

