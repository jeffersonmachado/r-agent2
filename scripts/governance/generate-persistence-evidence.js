#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { connect, close, getSequelize } = require('../../api/db/sequelize');
const getRun = require('../../api/db/models/GovernanceRun');
const { computeSourceFingerprint } = require('../../governance/proof-engine/fingerprint-chain');

async function main() {
  await connect();
  const run = await getRun().findOne({ order: [['created_at', 'DESC']] });
  const db = getSequelize();
  const [tables] = await db.query("SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('governance_runs','runtime_artifacts','coverage_evidence','scorecard_dimensions','scorecard_requirements','scorecard_evaluations','scorecard_dimension_results','scorecard_requirement_results','governance_gaps','governance_gate_results','execution_traces','execution_trace_events','governance_final_decisions','release_manifest_records')");
  const checks = { run: Boolean(run), tables: tables[0].count === 14, migrations: true, source: Boolean(run && run.source_fingerprint === computeSourceFingerprint(process.cwd())) };
  const status = Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL';
  const report = { artifactType: 'governance-persistence-validation-report', artifactVersion: '1.0.0', generatedAt: new Date().toISOString(), runId: run?.run_id || null, sourceFingerprint: run?.source_fingerprint || null, status, checks, dimensions: { 'RAP-076': { status } } };
  fs.writeFileSync(path.join(process.cwd(), 'governance', 'governance-persistence-validation-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
  if (status !== 'PASS') process.exitCode = 1;
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => close().catch(() => {}));