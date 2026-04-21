const path = require('path');
const { BUG_TYPES } = require('./bugClassification');

class PatchSuggestionEngine {
  suggest(input = {}) {
    const classification = input.classification || {};
    const action = input.action || {};
    const selectorRepair = input.selectorRepair || null;
    const stepRepair = input.stepRepair || null;

    const suggestions = [];

    if (
      (classification.type === BUG_TYPES.SELECTOR_BROKEN || classification.type === BUG_TYPES.SELECTOR_DRIFT) &&
      selectorRepair?.bestCandidate?.selector
    ) {
      suggestions.push({
        patchType: 'SELECTOR_REPLACEMENT',
        targetFile: input.targetFile || path.join('tests', 'rpa', 'seeds', '<recording>.json'),
        currentSnippet: `"selector": "${action.selector || ''}"`,
        proposedSnippet: `"selector": "${selectorRepair.bestCandidate.selector}"`,
        rationale: 'Stable selector candidate was found with higher confidence.',
        riskLevel: 'LOW',
      });
    }

    if (classification.type === BUG_TYPES.ASSERTION_MISMATCH) {
      suggestions.push({
        patchType: 'ASSERTION_UPDATE',
        targetFile: input.targetFile || path.join('tests', 'rpa', 'seeds', '<recording>.json'),
        currentSnippet: JSON.stringify({ text: action.text, textContains: action.textContains }, null, 2),
        proposedSnippet: JSON.stringify({ textContains: action.textContains || action.text }, null, 2),
        rationale: 'Strict assertion appears stale for current UI content.',
        riskLevel: 'MEDIUM',
      });
    }

    if (classification.type === BUG_TYPES.RENDER_TIMEOUT) {
      suggestions.push({
        patchType: 'TIMEOUT_TUNING',
        targetFile: input.targetFile || path.join('tests', 'rpa', 'seeds', '<recording>.json'),
        currentSnippet: `"timeout": ${Number(action.timeout || 0) || '<default>'}`,
        proposedSnippet: `"timeout": ${Math.max(Number(action.timeout || 0), 12000) || 12000}`,
        rationale: 'Observed render delay indicates timeout should be increased.',
        riskLevel: 'LOW',
      });
    }

    if (stepRepair?.changeType && stepRepair.changeType !== 'NO_CHANGE') {
      suggestions.push({
        patchType: 'STEP_REPAIR',
        targetFile: input.targetFile || path.join('tests', 'rpa', 'seeds', '<recording>.json'),
        currentSnippet: JSON.stringify(action, null, 2),
        proposedSnippet: JSON.stringify(stepRepair.repairedStep || action, null, 2),
        rationale: stepRepair.rationale || 'Autonomous engine identified a safer step shape.',
        riskLevel: 'MEDIUM',
      });
    }

    if (classification.type === BUG_TYPES.FLOW_LOGIC_ERROR) {
      suggestions.push({
        patchType: 'FLOW_CORRECTION',
        targetFile: input.targetFile || path.join('engine', 'flowToRpaConverter.js'),
        currentSnippet: 'Generated flow step without explicit precondition.',
        proposedSnippet: 'Inject precondition asserts before branch-sensitive actions.',
        rationale: 'Runtime indicates the generated flow order is unsafe for current behavior.',
        riskLevel: 'HIGH',
      });
    }

    return suggestions;
  }
}

module.exports = {
  PatchSuggestionEngine,
};
