'use strict';

class PatchProposalService {
  inferFilesToChange({ diagnosis = {}, event = {}, evidence = null }) {
    const explicit = [];
    const sourceRef = evidence?.source_ref || event?.payload?.source_ref || {};
    const metadata = evidence?.metadata || event?.payload?.metadata || {};
    [sourceRef.filePath, metadata.filePath, metadata.affectedFile].filter(Boolean).forEach((item) => explicit.push(item));

    const moduleName = String(diagnosis.affectedModule || '').toLowerCase();
    if (/workspace/.test(moduleName)) explicit.push('frontend/src/pages/WorkspacePage.jsx');
    if (/qa|rpa/.test(moduleName)) explicit.push('api/services/qaWavesExecutionService.js');
    if (/auth|login/.test(moduleName)) explicit.push('frontend/src/components/Login.jsx');
    if (/payment|billing/.test(moduleName)) explicit.push('api/services/workspace/WorkspaceOperationsService.js');

    return [...new Set(explicit.filter(Boolean))].slice(0, 8);
  }

  inferTestsToRun({ diagnosis = {}, sourceType = '', sourceId = '' }) {
    const affected = String(diagnosis.affectedModule || '').toLowerCase();
    const tests = [];
    if (/qa|rpa/.test(affected) || /wave|replay|evidence/.test(sourceType)) {
      tests.push('npm test -- api/services/__tests__/qaWavesExecutionService.test.js');
      tests.push(`node scripts/qa-waves-execute.js --source ${sourceId}`);
      tests.push(`node scripts/test-rpa-replays-scale-smoke.js --source ${sourceId}`);
    }
    if (/workspace/.test(affected)) {
      tests.push('npx jest api/services/__tests__/workspaceCore.test.js --runInBand');
      tests.push('npx jest api/modules/workspace/workspace.routes.test.js --runInBand');
      tests.push('cd frontend && npm run test -- src/pages/WorkspacePage.test.jsx');
      tests.push('node scripts/workspace-core-smoke.js');
    }
    if (/auth|login/.test(affected)) {
      tests.push('node login-simple-test.js');
    }
    if (tests.length === 0) {
      tests.push('npm test -- --runInBand');
      tests.push('node scripts/workspace-core-smoke.js');
    }
    return [...new Set(tests)];
  }

  buildDiff({ diagnosis = {}, filesToChange = [] }) {
    const file = filesToChange[0] || 'arquivo-alvo';
    return [
      `diff --git a/${file} b/${file}`,
      '--- a/' + file,
      '+++ b/' + file,
      '@@',
      `- // comportamento atual com falha em ${diagnosis.affectedModule || 'modulo desconhecido'}`,
      `+ // patch candidato sugerido para tratar: ${diagnosis.rootCause || 'falha identificada'}`,
      `+ // recomendacao: ${diagnosis.recommendedFix || 'corrigir fluxo e validar testes relacionados'}`,
    ].join('\n');
  }

  async proposePatch({ diagnosis = {}, sourceType = '', sourceId = '', event = {}, evidence = null } = {}) {
    const filesToChange = this.inferFilesToChange({ diagnosis, event, evidence });
    const testsToRun = this.inferTestsToRun({ diagnosis, sourceType, sourceId });
    return {
      filesToChange,
      patchSummary: `${diagnosis.recommendedFix || 'Patch candidato gerado'} Nenhuma aplicacao automatica sera executada sem aprovacao humana.`,
      diff: this.buildDiff({ diagnosis, filesToChange }),
      testsToRun,
    };
  }
}

module.exports = PatchProposalService;