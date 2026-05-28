'use strict';

const fs = require('fs');
const path = require('path');
const {
  ROOT,
  exists,
  failIfNeeded,
  listFiles,
  readText,
  statusFromIssues,
  writeReport,
} = require('./common');

const requiredFiles = [
  'AI_MEMORY/architecture.md',
  'AI_MEMORY/platform-vision.md',
  'AI_MEMORY/qa-waves.md',
  'AI_MEMORY/replay-governance.md',
  'AI_MEMORY/release-process.md',
  'AI_MEMORY/operational-mesh.md',
  'AI_MEMORY/coding-standards.md',
  'AI_MEMORY/operational-rules.md',
  'AI_MEMORY/anti-patterns.md',
  'AI_MEMORY/validation-rules.md',
  'AI_MEMORY/smoke-rules.md',
  'AI_MEMORY/deployment-rules.md',
  'AI_MEMORY/workspace.md',
  'AI_MEMORY/omnichannel.md',
  'AI_MEMORY/pbx-ivr.md',
  'AI_MEMORY/rag-rules.md',
  'AI_MEMORY/replay-engine.md',
  'AI_MEMORY/self-proving.md',
  'AI_MEMORY/runtime-navigation.md',
  'AI_MEMORY/authentication.md',
  'AI_MEMORY/self-proving-rules.md',
  'AI_MEMORY/project-map.md',
  'AI_MEMORY/project-runtime-map.md',
  'AI_MEMORY/glossary.md',
  'AI_MEMORY/operational-checklists/release-checklist.md',
  'AI_MEMORY/operational-checklists/replay-checklist.md',
  'AI_MEMORY/operational-checklists/qa-checklist.md',
  'AI_MEMORY/operational-checklists/deployment-checklist.md',
  'AI_MEMORY/operational-checklists/governance-checklist.md',
  'AI_MEMORY/operational-checklists/browser-validation-checklist.md',
  'AGENTS.md',
  'CLAUDE.md',
  '.github/copilot-instructions.md',
];

const requiredTerms = [
  'QA Waves',
  'Replay',
  'Self-Proving',
  'Release',
  'Operational Mesh',
  'RAP Workspace',
];

const requiredRoutes = [
  '/support',
  '/dev/system-status',
  '/dev/rpa-replays',
  '/rag-documents',
  '/channel-accounts',
  '/channel-health',
  '/generate-system',
];

const issues = [];
const warnings = [];

for (const file of requiredFiles) {
  if (!exists(file)) {
    issues.push({ code: 'required_file_missing', file, message: `${file} is required by AI governance.` });
    continue;
  }
  const text = readText(file);
  if (!text.trim()) {
    issues.push({ code: 'empty_file', file, message: `${file} is empty.` });
  }
}

const memoryFiles = listFiles('AI_MEMORY', (full) => full.endsWith('.md'));
for (const file of memoryFiles) {
  const text = readText(file);
  for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1];
    if (/^(https?:|mailto:|#)/i.test(target)) continue;
    const cleanTarget = target.split('#')[0].replace(/^<|>$/g, '');
    const resolved = path.resolve(path.dirname(path.join(ROOT, file)), cleanTarget);
    if (!fs.existsSync(resolved)) {
      issues.push({ code: 'broken_markdown_link', file, target, message: `Broken markdown link ${target} in ${file}.` });
    }
  }
}

const combinedMemory = memoryFiles.map((file) => readText(file)).join('\n');
for (const term of requiredTerms) {
  if (!combinedMemory.includes(term)) {
    issues.push({ code: 'required_concept_missing', term, message: `AI_MEMORY does not mention required concept: ${term}.` });
  }
}

const runtimeText = exists('AI_MEMORY/project-runtime-map.md') ? readText('AI_MEMORY/project-runtime-map.md') : '';
for (const route of requiredRoutes) {
  if (!runtimeText.includes(route)) {
    issues.push({ code: 'route_missing_from_runtime_map', route, message: `${route} is absent from AI_MEMORY/project-runtime-map.md.` });
  }
}

if (runtimeText.includes('/system-status') && !runtimeText.includes('/dev/system-status')) {
  issues.push({ code: 'canonical_route_alias_missing', route: '/system-status', message: 'Requested /system-status is documented without canonical /dev/system-status alias.' });
}

const sourceDocs = [
  'README.md',
  'docs/governance/PLATFORM_STATUS.md',
  'docs/governance/QA_WAVES_STATUS.md',
  'docs/governance/REPLAY_OPERATIONAL_STATUS.md',
  'docs/runtime-governance.md',
  'docs/release-contract.md',
];
for (const doc of sourceDocs) {
  if (!combinedMemory.includes(doc)) {
    warnings.push({ code: 'source_doc_not_referenced', doc, message: `${doc} should be referenced by AI_MEMORY consolidation.` });
  }
}

const headings = new Map();
for (const file of memoryFiles) {
  const firstHeading = (readText(file).match(/^#\s+(.+)$/m) || [])[1];
  if (!firstHeading) continue;
  const normalized = firstHeading.trim().toLowerCase();
  const previous = headings.get(normalized);
  if (previous) {
    warnings.push({ code: 'possible_duplicate_heading', files: [previous, file], heading: firstHeading });
  } else {
    headings.set(normalized, file);
  }
}

const report = {
  name: 'validate-ai-memory',
  status: statusFromIssues(issues),
  filesChecked: requiredFiles.length,
  memoryFilesChecked: memoryFiles.length,
  issues,
  warnings,
  suggestions: warnings.map((warning) => warning.message || warning.code),
};

writeReport('ai-memory-validation-report.json', report);
failIfNeeded(report);
