'use strict';

const { failIfNeeded, readJson, statusFromIssues, writeReport } = require('./common');

const issues = [];
const replay = readJson('governance/replay-integrity-report.json', {});

if (replay.pass !== true) {
  issues.push({ code: 'replay_integrity_not_pass', message: 'Replay integrity report is not pass=true.' });
}
if (!replay.replaySigValid) {
  issues.push({ code: 'replay_signature_invalid', message: 'Replay signature is invalid or missing.' });
}
if (Number(replay.criticalIssues || 0) > 0) {
  issues.push({ code: 'replay_critical_issues', count: replay.criticalIssues, message: 'Replay integrity has critical issues.' });
}
if (!Array.isArray(replay.chain) || replay.chain.length === 0) {
  issues.push({ code: 'replay_chain_missing', message: 'Replay chain is missing.' });
} else {
  for (const item of replay.chain) {
    if (!/^[a-f0-9]{64}$/i.test(String(item.replayHash || ''))) {
      issues.push({ code: 'invalid_replay_hash', journeyId: item.journeyId, message: `Invalid replayHash for ${item.journeyId}.` });
    }
    if (!item.hasPhysicalHash) {
      issues.push({ code: 'replay_physical_hash_missing', journeyId: item.journeyId, message: `Physical hash missing for ${item.journeyId}.` });
    }
  }
}

const report = {
  name: 'validate-replay-governance',
  status: statusFromIssues(issues),
  totalReplays: replay.totalReplays || 0,
  replayRoot: replay.replayRoot || null,
  replaySigValid: Boolean(replay.replaySigValid),
  criticalIssues: Number(replay.criticalIssues || 0),
  issues,
  suggestions: issues.map((issue) => issue.message),
};

writeReport('replay-governance-validation-report.json', report);
failIfNeeded(report);
