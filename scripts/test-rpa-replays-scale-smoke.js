#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { runtimeAwarePath, resolveWorkspacePath } = require('../tools/system/lib/runtime-paths');

const ROOT = path.resolve(__dirname, '..');
const REPLAY_DIR = path.join(ROOT, 'tests', 'rpa', 'replay');
const REPORTS_DIR = path.join(ROOT, 'tests', 'rpa', 'reports');
const LATEST_REPORT_MD = path.join(REPORTS_DIR, 'screen-catalog-latest.md');
const DEFAULT_COUNT = 3000;
const FIXTURE_PREFIX = 'qa-scale-replay';

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function buildReplayFilename(runId, index) {
  return `${FIXTURE_PREFIX}-${runId}-${String(index + 1).padStart(4, '0')}.json`;
}

function buildReplayPayload(runId, index) {
  const start = new Date(Date.UTC(2026, 3, 11, 12, 0, 0, index));
  const end = new Date(start.getTime() + 1500);
  return {
    id: `${runId}-replay-${index + 1}`,
    recordingId: `qa-scale-recording-${index + 1}`,
    mode: 'ci',
    result: index % 7 === 0 ? 'failed' : 'success',
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    actions: [
      {
        type: 'navigate',
        target: '/rpa-replays',
        at: start.toISOString(),
      },
      {
        type: 'assert',
        target: '/tests/rpa/replay',
        at: end.toISOString(),
      },
    ],
    screens: [],
    metadata: {
      synthetic: true,
      scenario: 'rpa-replays-scale-smoke',
      ordinal: index + 1,
    },
  };
}

function createSyntheticReplays({ count, runId, replayDir = REPLAY_DIR, fsImpl = fs, pathImpl = path }) {
  ensureDir(replayDir);
  const createdFiles = [];

  for (let index = 0; index < count; index += 1) {
    const filename = buildReplayFilename(runId, index);
    const filePath = pathImpl.join(replayDir, filename);
    const payload = buildReplayPayload(runId, index);
    fsImpl.writeFileSync(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
    createdFiles.push(filePath);
  }

  return createdFiles;
}

function cleanupSyntheticReplays(filePaths, { fsImpl = fs } = {}) {
  const removed = [];

  for (const filePath of filePaths) {
    if (!fsImpl.existsSync(filePath)) continue;
    fsImpl.unlinkSync(filePath);
    removed.push(filePath);
  }

  return removed;
}

function resolveLatestGeneratedReportPaths({ fsImpl = fs, reportsDir = REPORTS_DIR, pathImpl = path } = {}) {
  if (!fsImpl.existsSync(reportsDir)) {
    return { markdownPath: LATEST_REPORT_MD, jsonPath: null };
  }

  const latestJson = fsImpl.readdirSync(reportsDir)
    .filter((name) => /^screen-catalog-.*\.json$/.test(name))
    .sort()
    .pop() || null;

  return {
    markdownPath: LATEST_REPORT_MD,
    jsonPath: latestJson ? pathImpl.join(reportsDir, latestJson) : null,
  };
}

function writeEvidence(evidence) {
  const evidencePath = resolveWorkspacePath(
    ROOT,
    runtimeAwarePath(ROOT, 'qa/l07-rpa-replays-scale-evidence.json', 'RPA_REPLAY_SCALE_EVIDENCE_PATH'),
  );
  ensureDir(path.dirname(evidencePath));
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return evidencePath;
}

function runScaleSmoke({ count = DEFAULT_COUNT } = {}) {
  const runId = `${Date.now()}`;
  const keepFixtures = process.env.RPA_REPLAY_SCALE_KEEP === '1';
  const evidence = {
    generatedAt: new Date().toISOString(),
    ok: false,
    count,
    runId,
    createdCount: 0,
    removedCount: 0,
    keepFixtures,
    smokeExitCode: null,
    reportMarkdownPath: LATEST_REPORT_MD,
    reportJsonPath: null,
  };

  let createdFiles = [];

  try {
    createdFiles = createSyntheticReplays({ count, runId });
    evidence.createdCount = createdFiles.length;
    console.log(`[rpa-replays-scale-smoke] Criados ${createdFiles.length} replays sintéticos em ${REPLAY_DIR}`);

    const result = spawnSync(process.execPath, ['core/rpa/cli.js', 'screens', 'rpa-replays'], {
      cwd: ROOT,
      stdio: 'inherit',
      env: {
        ...process.env,
        LEGACY_RPA_ENTRYPOINT_ALLOWED: '1',
      },
    });

    evidence.smokeExitCode = typeof result.status === 'number' ? result.status : 1;
    evidence.ok = evidence.smokeExitCode === 0;
    const reportPaths = resolveLatestGeneratedReportPaths();
    evidence.reportMarkdownPath = reportPaths.markdownPath;
    evidence.reportJsonPath = reportPaths.jsonPath;
  } finally {
    if (!keepFixtures) {
      evidence.removedCount = cleanupSyntheticReplays(createdFiles).length;
    }
    evidence.evidencePath = writeEvidence(evidence);
  }

  return evidence;
}

function main() {
  const count = parsePositiveInt(process.env.RPA_REPLAY_SCALE_COUNT, DEFAULT_COUNT);
  const result = runScaleSmoke({ count });

  console.log(
    `[rpa-replays-scale-smoke] ${result.ok ? 'OK' : 'FAIL'} count=${result.count} created=${result.createdCount} removed=${result.removedCount} evidence=${result.evidencePath}`
  );

  process.exit(result.ok ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = {
  buildReplayFilename,
  buildReplayPayload,
  createSyntheticReplays,
  cleanupSyntheticReplays,
  resolveLatestGeneratedReportPaths,
  runScaleSmoke,
};