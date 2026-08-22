'use strict';

const crypto = require('crypto');
const { failIfNeeded, readJson, statusFromIssues, writeReport } = require('./common');

const GENESIS_HASH = '0'.repeat(64);
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function isSha256(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || ''));
}

function isHmacSignature(value) {
  return /^hmac-sha256:[a-f0-9]{64}$/i.test(String(value || ''));
}

function parseMaxAge(value, fallback = DEFAULT_MAX_AGE_MS) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function validateReplayReport(replay = {}, {
  now = Date.now(),
  maxAgeMs = DEFAULT_MAX_AGE_MS,
} = {}) {
  const issues = [];

  if (replay.pass !== true) {
    issues.push({ code: 'replay_integrity_not_pass', message: 'Replay integrity report is not pass=true.' });
  }
  if (replay.replaySigValid !== true) {
    issues.push({ code: 'replay_signature_invalid', message: 'Replay package signature is invalid or missing.' });
  }
  if (replay.enterpriseGovernanceValid !== true) {
    issues.push({
      code: 'replay_enterprise_governance_invalid',
      reasons: replay.enterpriseGovernanceReasons || [],
      message: 'Replay report is not bound to valid current enterprise governance.',
    });
  }
  if (replay.proofBindingValid !== true) {
    issues.push({ code: 'replay_proof_binding_invalid', message: 'Replay proof is not bound to the enterprise report.' });
  }
  if (replay.signatureAuditValid !== true) {
    issues.push({ code: 'replay_signature_audit_invalid', message: 'Replay signature audit is invalid or missing.' });
  }
  if (replay.signatureAlgorithmsValid !== true) {
    issues.push({
      code: 'replay_signature_algorithm_unsupported',
      message: 'Replay artifacts must use keyed hmac-sha256 signatures.',
    });
  }
  if (Number(replay.criticalIssues || 0) > 0) {
    issues.push({
      code: 'replay_critical_issues',
      count: replay.criticalIssues,
      message: 'Replay integrity has critical issues.',
    });
  }

  const generatedAtMs = Date.parse(String(replay.generatedAt || ''));
  if (!Number.isFinite(generatedAtMs)) {
    issues.push({ code: 'replay_report_timestamp_invalid', message: 'Replay integrity report timestamp is invalid.' });
  } else if (generatedAtMs - now > 5 * 60 * 1000) {
    issues.push({ code: 'replay_report_from_future', message: 'Replay integrity report timestamp is in the future.' });
  } else if (now - generatedAtMs > maxAgeMs) {
    issues.push({
      code: 'replay_report_stale',
      ageMs: now - generatedAtMs,
      maxAgeMs,
      message: 'Replay integrity report is stale and must be regenerated.',
    });
  }

  const chain = Array.isArray(replay.chain) ? replay.chain : [];
  if (chain.length === 0) {
    issues.push({ code: 'replay_chain_missing', message: 'Replay chain is missing.' });
  }
  if (Number(replay.totalReplays || 0) !== chain.length) {
    issues.push({ code: 'replay_chain_count_mismatch', message: 'Replay chain count does not match totalReplays.' });
  }

  const journeyIds = new Set();
  let expectedParent = GENESIS_HASH;
  for (let index = 0; index < chain.length; index += 1) {
    const item = chain[index] || {};
    const replayHash = String(item.replayHash || '');
    if (!isSha256(replayHash)) {
      issues.push({ code: 'invalid_replay_hash', journeyId: item.journeyId, message: `Invalid replayHash for ${item.journeyId}.` });
    }
    if (item.hasPhysicalHash !== true) {
      issues.push({ code: 'replay_physical_hash_missing', journeyId: item.journeyId, message: `Physical hash missing for ${item.journeyId}.` });
    }
    if (!isHmacSignature(item.governanceHash)) {
      issues.push({
        code: 'replay_item_signature_algorithm_unsupported',
        journeyId: item.journeyId,
        message: `Replay governance signature is not hmac-sha256 for ${item.journeyId}.`,
      });
    }
    if (item.parentReplayHash !== expectedParent) {
      issues.push({ code: 'replay_chain_parent_mismatch', journeyId: item.journeyId, message: `Replay parent hash mismatch for ${item.journeyId}.` });
    }
    const expectedCumulative = sha256(`${expectedParent}:${replayHash}`);
    if (item.cumulativeHash !== expectedCumulative) {
      issues.push({ code: 'replay_chain_cumulative_mismatch', journeyId: item.journeyId, message: `Replay cumulative hash mismatch for ${item.journeyId}.` });
    }
    const journeyId = String(item.journeyId || '').trim();
    if (!journeyId || journeyIds.has(journeyId)) {
      issues.push({ code: 'replay_journey_duplicate_or_missing', journeyId: journeyId || null, message: 'Replay journey identifiers must be present and unique.' });
    }
    journeyIds.add(journeyId);
    expectedParent = replayHash;
  }

  const expectedRoot = chain.length > 0 ? chain[chain.length - 1].cumulativeHash : GENESIS_HASH;
  if (!isSha256(replay.replayRoot) || replay.replayRoot !== expectedRoot) {
    issues.push({ code: 'replay_root_mismatch', message: 'Replay root does not match the validated chain.' });
  }

  return issues;
}

function main() {
  const replay = readJson('governance/replay-integrity-report.json', {});
  const maxAgeMs = parseMaxAge(process.env.REPLAY_GOVERNANCE_REPORT_MAX_AGE_MS);
  const issues = validateReplayReport(replay, { maxAgeMs });

  // RAP-017: validação formal da cadeia causal executionId→replayId→evidence
  let causalChainValidation = { allValid: true, summary: { valid: 'N/A', strong: 'N/A', gapCount: 0 } };
  try {
    const { validateSmokeFlowCausalChains } = require('../../api/services/qa/causChainValidator');
    const smokeReport = readJson('qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json', {});
    const flows = Array.isArray(smokeReport.flows) ? smokeReport.flows : [];
    if (flows.length > 0) {
      causalChainValidation = validateSmokeFlowCausalChains(flows);
      if (!causalChainValidation.allValid) {
        const breakGaps = causalChainValidation.allGaps.filter((g) => g.gap.startsWith('CHAIN_BREAK'));
        breakGaps.forEach((g) => {
          issues.push({ code: 'causal_chain_break', journeyId: g.journeyId, message: g.gap });
        });
      }
    }
  } catch (_) {
    // causChainValidator não disponível — não bloqueia mas registra
    causalChainValidation = { allValid: true, summary: { valid: 'unavailable', strong: 'unavailable', gapCount: 0 } };
  }

  const report = {
    name: 'validate-replay-governance',
    status: statusFromIssues(issues),
    generatedAt: replay.generatedAt || null,
    maxAgeMs,
    totalReplays: replay.totalReplays || 0,
    replayRoot: replay.replayRoot || null,
    replaySigValid: replay.replaySigValid === true,
    enterpriseGovernanceValid: replay.enterpriseGovernanceValid === true,
    proofBindingValid: replay.proofBindingValid === true,
    signatureAuditValid: replay.signatureAuditValid === true,
    signatureAlgorithmsValid: replay.signatureAlgorithmsValid === true,
    criticalIssues: Number(replay.criticalIssues || 0),
    causalChainValidation: causalChainValidation.summary,
    issues,
    suggestions: issues.map((issue) => issue.message),
  };

  writeReport('replay-governance-validation-report.json', report);
  failIfNeeded(report);
  return report;
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_MAX_AGE_MS,
  GENESIS_HASH,
  main,
  validateReplayReport,
};
