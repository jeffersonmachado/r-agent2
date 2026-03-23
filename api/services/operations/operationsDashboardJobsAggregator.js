'use strict';

/**
 * Job row mapping and aggregation helpers for the listJobs endpoint.
 * All helpers are injected to keep this module stateless and easily testable.
 */

/**
 * Maps raw ExecutionJob DB rows to normalised job objects.
 *
 * @param {any[]} rows
 * @param {{mapExecutionStatus: Function, computeDurationMs: Function, toIso: Function, safeString: Function}} deps
 * @returns {Object[]}
 */
function mapJobRows(rows, { mapExecutionStatus, computeDurationMs, toIso, safeString }) {
  return rows.map((row) => {
    const item = row.toJSON ? row.toJSON() : row;
    const normalizedStatus = mapExecutionStatus(item.status);
    const durationMs = computeDurationMs(item);
    return {
      id: item.id,
      kind: item.kind,
      tenantId: item.tenant_key,
      status: normalizedStatus,
      startedAt: toIso(item.processing_at || item.created_at),
      finishedAt: normalizedStatus === 'pending' ? null : toIso(item.updated_at),
      durationMs,
      attempt: Number(item.attempts || 0) + (item.status === 'dead' || item.status === 'done' ? 1 : 0),
      retries: Math.max(Number(item.attempts || 0), 0),
      error: item.last_error ? safeString(item.last_error).slice(0, 240) : null,
      rawStatus: item.status,
      priority: item.priority,
      nextAttemptAt: toIso(item.next_attempt_at),
    };
  });
}

/**
 * Builds a by-kind aggregation map from a list of mapped job objects.
 *
 * @param {Object[]} jobs
 * @returns {Object[]} sorted array of per-kind bucket objects
 */
function aggregateJobsByKind(jobs) {
  const byKindMap = {};
  for (const job of jobs) {
    if (!byKindMap[job.kind]) {
      byKindMap[job.kind] = {
        kind: job.kind,
        executed: 0,
        success: 0,
        failed: 0,
        pending: 0,
        retries: 0,
        lastExecution: null,
      };
    }
    const bucket = byKindMap[job.kind];
    if (job.status === 'success' || job.status === 'failed') bucket.executed += 1;
    if (job.status === 'success') bucket.success += 1;
    if (job.status === 'failed') bucket.failed += 1;
    if (job.status === 'pending') bucket.pending += 1;
    bucket.retries += job.retries;

    if (!bucket.lastExecution || new Date(job.startedAt).getTime() > new Date(bucket.lastExecution.startedAt).getTime()) {
      bucket.lastExecution = {
        id: job.id,
        status: job.status,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        durationMs: job.durationMs,
        error: job.error,
      };
    }
  }
  return Object.values(byKindMap).sort((a, b) => a.kind.localeCompare(b.kind));
}

/**
 * Builds the summary object from a list of mapped job objects.
 *
 * @param {Object[]} jobs
 * @returns {Object}
 */
function buildJobsSummary(jobs) {
  const executed = jobs.filter((j) => j.status === 'success' || j.status === 'failed').length;
  const success = jobs.filter((j) => j.status === 'success').length;
  const failed = jobs.filter((j) => j.status === 'failed').length;
  const pending = jobs.filter((j) => j.status === 'pending').length;
  const retries = jobs.reduce((sum, j) => sum + Math.max(Number(j.retries || 0), 0), 0);
  const durations = jobs.map((j) => j.durationMs).filter((v) => Number.isFinite(v));
  const avgDurationMs = durations.length
    ? Math.round(durations.reduce((acc, v) => acc + v, 0) / durations.length)
    : null;
  return { executed, success, failed, avgDurationMs, retries, backlogEstimated: pending, pending };
}

module.exports = { mapJobRows, aggregateJobsByKind, buildJobsSummary };
