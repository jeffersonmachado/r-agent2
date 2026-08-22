#!/usr/bin/env node
'use strict';

const path = require('path');
const {
  evaluateMasterScorecard,
  writeScorecard,
} = require('./master-scorecard-engine');
const { writeGeneratedDocs } = require('./master-scorecard-docs');

function revalidate(options = {}) {
  const rootDir = path.resolve(options.rootDir || path.join(__dirname, '..'));
  const scorecard = evaluateMasterScorecard({
    rootDir,
    registry: options.registry,
    runContext: options.runContext,
    sourceFingerprint: options.sourceFingerprint,
    now: options.now,
    requireCanonicalIds: options.requireCanonicalIds,
  });
  const outputPath = path.resolve(options.outputPath || path.join(rootDir, 'governance', 'rap-master-scorecard.json'));
  if (options.write !== false) {
    writeScorecard(scorecard, outputPath);
    if (options.docs !== false) writeGeneratedDocs(scorecard, rootDir);
  }
  return { scorecard, outputPath };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') {
      options.rootDir = argv[index + 1];
      index += 1;
    } else if (arg === '--output') {
      options.outputPath = argv[index + 1];
      index += 1;
    } else if (arg === '--check') {
      options.write = false;
    } else if (arg === '--no-docs') {
      options.docs = false;
    } else if (arg === '--db') {
      options.database = true;
    } else {
      throw new Error(`unknown_argument:${arg}`);
    }
  }
  return options;
}

function printSummary(scorecard) {
  const valid = scorecard.overallStatus === 'VERIFIED';
  // eslint-disable-next-line no-console
  console.log(valid ? 'MASTER_SCORECARD_VALID' : 'MASTER_SCORECARD_INVALID');
  // eslint-disable-next-line no-console
  console.log(`STATUS: ${scorecard.overallStatus}`);
  // eslint-disable-next-line no-console
  console.log(`DIMENSIONS: ${scorecard.summary.totalDimensions}`);
  // eslint-disable-next-line no-console
  console.log(`10_OF_10: ${scorecard.summary.dimensionsAt10}`);
  // eslint-disable-next-line no-console
  console.log(`BELOW_10: ${scorecard.summary.dimensionsBelow10}`);
  // eslint-disable-next-line no-console
  console.log(`OPEN_GAPS: ${scorecard.summary.openGaps}`);
  // eslint-disable-next-line no-console
  console.log(`BLOCKERS: ${scorecard.summary.openBlockers}`);
  // eslint-disable-next-line no-console
  console.log(`MANDATORY_GATE_FAILURES: ${scorecard.summary.mandatoryGateFailures}`);
  return valid;
}

module.exports = { revalidate, parseArgs, printSummary };

if (require.main === module) {
  if (process.env.RAP_CERTIFICATION_MODE === 'required' || process.argv.includes('--db')) {
    require('./revalidate-master-scorecard-db').revalidatePersisted().then((result) => {
      console.log(result.status === 'PASS' ? 'MASTER_SCORECARD_VALID' : 'MASTER_SCORECARD_INVALID');
      console.log(JSON.stringify(result));
      process.exitCode = result.status === 'PASS' ? 0 : 1;
    }).catch((error) => { console.error(`MASTER_SCORECARD_INVALID: ${error.message}`); process.exitCode = 1; });
  } else try {
    const { scorecard } = revalidate(parseArgs(process.argv.slice(2)));
    process.exitCode = printSummary(scorecard) ? 0 : 1;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`MASTER_SCORECARD_INVALID: ${error.message}`);
    process.exitCode = 1;
  }
}
