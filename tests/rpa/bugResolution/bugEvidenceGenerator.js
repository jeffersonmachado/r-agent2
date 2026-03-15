const fs = require('fs');
const path = require('path');

class BugEvidenceGenerator {
  constructor(options = {}) {
    this.outputDir = options.outputDir || path.join(__dirname, '..', 'reports', 'bugs');
  }

  ensureOutputDir() {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  buildMarkdown(evidence) {
    const lines = [];
    lines.push(`# Bug Evidence Report`);
    lines.push('');
    lines.push(`- id: ${evidence.id}`);
    lines.push(`- generatedAt: ${evidence.generatedAt}`);
    lines.push(`- bugType: ${evidence.classification?.type || 'UNKNOWN_ERROR'}`);
    lines.push(`- probableCause: ${evidence.classification?.probableCause || 'n/a'}`);
    lines.push(`- severity: ${evidence.classification?.severity || 'n/a'}`);
    lines.push(`- owner: ${evidence.owner || 'UNCERTAIN'}`);
    lines.push(`- finalDecision: ${evidence.finalDecision || 'FAIL_UNKNOWN'}`);
    lines.push('');

    lines.push('## Selectors');
    lines.push(`- originalSelector: ${evidence.action?.selector || 'n/a'}`);
    lines.push(`- repairedSelector: ${evidence.selectorRepair?.appliedSelector || 'n/a'}`);
    lines.push('');

    lines.push('## Classification');
    lines.push('```json');
    lines.push(JSON.stringify(evidence.classification || {}, null, 2));
    lines.push('```');
    lines.push('');

    lines.push('## Recovery Plan');
    lines.push('```json');
    lines.push(JSON.stringify(evidence.recoveryPlan || {}, null, 2));
    lines.push('```');
    lines.push('');

    lines.push('## Recovery Attempts');
    lines.push('```json');
    lines.push(JSON.stringify(evidence.recoveryAttempts || [], null, 2));
    lines.push('```');
    lines.push('');

    lines.push('## Console Errors');
    lines.push('```json');
    lines.push(JSON.stringify(evidence.pageStateSnapshot?.consoleErrors || [], null, 2));
    lines.push('```');
    lines.push('');

    lines.push('## Failed Requests');
    lines.push('```json');
    lines.push(JSON.stringify(evidence.pageStateSnapshot?.failedRequests || [], null, 2));
    lines.push('```');
    lines.push('');

    lines.push('## DOM Context (partial)');
    lines.push('```html');
    lines.push(String(evidence.pageStateSnapshot?.partialHtml || '').slice(0, 8000));
    lines.push('```');
    lines.push('');

    if (evidence.pageStateSnapshot?.screenshotPath) {
      lines.push(`screenshot: ${evidence.pageStateSnapshot.screenshotPath}`);
      lines.push('');
    }

    return lines.join('\n');
  }

  generate(input = {}) {
    this.ensureOutputDir();

    const now = Date.now();
    const id = input.id || `bug-${now}-${Math.random().toString(36).slice(2, 8)}`;

    const evidence = {
      id,
      generatedAt: new Date().toISOString(),
      classification: input.classification || null,
      owner: input.owner || 'UNCERTAIN',
      action: input.action || null,
      selectorRepair: input.selectorRepair || null,
      pageStateSnapshot: input.pageStateSnapshot || null,
      recoveryPlan: input.recoveryPlan || null,
      recoveryAttempts: input.recoveryAttempts || [],
      finalDecision: input.finalDecision || 'FAIL_UNKNOWN',
      patchSuggestions: input.patchSuggestions || [],
      notes: input.notes || null,
    };

    const jsonPath = path.join(this.outputDir, `${id}.json`);
    const mdPath = path.join(this.outputDir, `${id}.md`);

    fs.writeFileSync(jsonPath, JSON.stringify(evidence, null, 2), 'utf8');
    fs.writeFileSync(mdPath, this.buildMarkdown(evidence), 'utf8');

    return {
      id,
      jsonPath,
      markdownPath: mdPath,
    };
  }
}

module.exports = {
  BugEvidenceGenerator,
};
