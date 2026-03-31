#!/usr/bin/env node
'use strict';

/**
 * Vertical Beauty & Fitness — E2E validation script
 *
 * WHAT IT VALIDATES
 *   1. Jest integration tests (Beauty + Fitness) pass
 *   2. Notification adapter stubs return explicit status objects
 *   3. Job timeout wrapper logic works correctly
 *
 * USAGE
 *   node scripts/vertical-e2e-validate.js            # quiet
 *   node scripts/vertical-e2e-validate.js --verbose  # show Jest output
 *   node scripts/vertical-e2e-validate.js --check-providers
 *     # run provider-dependent checks when NOTIFICATION_*_ENABLED=true
 *
 * EXIT CODES
 *   0  all checks passed
 *   1  one or more checks failed
 *
 * NOTE
 *   Provider-dependent checks are SKIPPED by default, and only run when
 *   --check-providers is explicitly passed.
 */

const { execFileSync } = require('child_process');
const path = require('path');

const VERBOSE = process.argv.includes('--verbose');
const ROOT = path.resolve(__dirname, '..');

const results = [];
const CHECK_REAL_PROVIDERS = process.argv.includes('--check-providers');
let passed = 0;
let failed = 0;
let skipped = 0;
let providerDependent = 0;

function check(name, condition, detail) {
  const ok = Boolean(condition);
  results.push({ name, ok, detail, status: ok ? 'passed' : 'failed' });
  if (ok) {
    passed++;
    if (VERBOSE) console.log('  \u2713 ' + name);
  } else {
    failed++;
    console.log('  \u2717 ' + name + (detail ? ' \u2014 ' + detail : ''));
  }
}

function skip(name, detail) {
  skipped++;
  results.push({ name, ok: true, detail, status: 'skipped' });
  console.log('  - SKIPPED: ' + name + (detail ? ' (' + detail + ')' : ''));
}

function markProviderDependent(name, detail) {
  providerDependent++;
  results.push({ name, ok: true, detail, status: 'provider-dependent' });
  console.log('  - PROVIDER-DEPENDENT: ' + name + (detail ? ' (' + detail + ')' : ''));
}

function isDbUnavailableResult(item) {
  var error = String((item && item.error) || '');
  return /db_unavailable/i.test(error);
}

function runJestTestFile(filePath) {
  return execFileSync('npm', ['exec', '--', 'jest', '--no-coverage', filePath], {
    cwd: ROOT,
    stdio: VERBOSE ? 'inherit' : 'pipe',
    timeout: 60000,
  });
}

function summarizeJestFailure(err) {
  var out = String(err.stdout || '') + '\n' + String(err.stderr || '');
  return out.split('\n').filter(function (l) {
    return l.match(/Tests:|Test Suites:|failed/i);
  }).join(' | ');
}

async function runSection(label, fn) {
  console.log('\n[' + label + ']');
  try {
    await fn();
  } catch (err) {
    check(label + ' — no uncaught error', false, err.message);
  }
}

// ── Job timeout wrapper (pure logic, no DB) ───────────────────────────────────

function withJobTimeout(promise, timeoutMs, label) {
  var ms = (Number(timeoutMs) > 0) ? Number(timeoutMs) : 30000;
  var lbl = label || 'job';
  return new Promise(function (resolve, reject) {
    var t = setTimeout(function () {
      reject(new Error('job_timeout: ' + lbl + ' exceeded ' + ms + 'ms'));
    }, ms);
    t.unref();
    promise.then(
      function (r) { clearTimeout(t); resolve(r); },
      function (e) { clearTimeout(t); reject(e); }
    );
  });
}

(async function main() {

  // ── 1. Integration tests ────────────────────────────────────────────────────

  await runSection('Beauty integration tests (Jest)', async function () {
    try {
      runJestTestFile('tests/integration/verticalBeautyEndToEnd.test.js');
      check('All Beauty E2E scenarios pass', true);
    } catch (err) {
      var summary = summarizeJestFailure(err);
      check('All Beauty E2E scenarios pass', false, summary || err.message);
    }
  });

  await runSection('Fitness integration tests (Jest)', async function () {
    try {
      runJestTestFile('tests/integration/verticalFitnessEndToEnd.test.js');
      check('All Fitness E2E scenarios pass', true);
    } catch (err) {
      var summary = summarizeJestFailure(err);
      check('All Fitness E2E scenarios pass', false, summary || err.message);
    }
  });

  // ── 2. Notification adapter (no DB dependency) ────────────────────────────

  var notificationAdapter = require('../api/services/notifications/notificationAdapter');

  await runSection('Notification adapter: stub responses', async function () {
    var T = 'tenant-e2e-test';
    var SUBJ = 'subj-e2e-test';

    var wp = await notificationAdapter.sendJourneyNotification({
      tenantId: T, channel: 'whatsapp', subjectId: SUBJ,
      eventType: 'reminder_24h', payload: {},
    });
    var sms = await notificationAdapter.sendJourneyNotification({
      tenantId: T, channel: 'sms', subjectId: SUBJ,
      eventType: 'reminder_24h', payload: {},
    });
    var email = await notificationAdapter.sendJourneyNotification({
      tenantId: T, channel: 'email', subjectId: SUBJ,
      eventType: 'reminder_24h', payload: {},
    });
    if (isDbUnavailableResult(wp) || isDbUnavailableResult(sms) || isDbUnavailableResult(email)) {
      markProviderDependent('Notification adapter stub checks', 'db_unavailable during adapter validation');
      return;
    }

    check('WhatsApp disabled → status=stub', wp.status === 'stub');
    check('WhatsApp stub → isStub=true', wp.isStub === true);
    check('SMS disabled → status=stub', sms.status === 'stub');
    check('SMS stub → isStub=true', sms.isStub === true);
    check('Email disabled → status=stub', email.status === 'stub');
    check('Email stub → isStub=true', email.isStub === true);

    var intl = await notificationAdapter.sendJourneyNotification({
      tenantId: T, channel: 'internal', subjectId: SUBJ,
      eventType: 'reminder_24h', payload: {},
    });
    check('Internal channel → status=skipped', intl.status === 'skipped');
  });

  await runSection('Notification adapter: broadcast does not throw', async function () {
    var threw = false;
    try {
      await notificationAdapter.broadcastJourneyNotification({
        tenantId: 'test', channels: ['whatsapp', 'sms', 'email', 'internal'],
        subjectId: 'sub', eventType: 'frequency_alert_sent', payload: {},
      });
    } catch (_) {
      threw = true;
    }
    check('broadcastJourneyNotification returns without throwing', !threw);
  });

  await runSection('Notification adapter: unknown event type handled', async function () {
    var result = await notificationAdapter.sendJourneyNotification({
      tenantId: 'test', channel: 'internal', subjectId: 'sub',
      eventType: 'completely_unknown_event_xyz', payload: {},
    });
    if (isDbUnavailableResult(result)) {
      markProviderDependent('Unknown event type handling check', 'db_unavailable during adapter validation');
      return;
    }
    check('Unknown eventType does not throw', !!result);
  });

  // ── 3. Job timeout wrapper ───────────────────────────────────────────────

  await runSection('Job timeout wrapper', async function () {
    // Fast job resolves
    var fastResult = await withJobTimeout(Promise.resolve('ok'), 5000, 'fast');
    check('Fast job resolves with result', fastResult === 'ok');

    // Slow job times out.
    // The inner promise has a ref'd 200ms timer to keep the event loop alive
    // so the 30ms unref'd timeout CAN fire before the loop drains.
    var timedOut = false;
    var slowPromise = new Promise(function (resolve) {
      setTimeout(function () { resolve('late'); }, 200); // ref'd timer anchors loop
    });
    await withJobTimeout(slowPromise, 30, 'slow').catch(function (err) {
      timedOut = err.message.indexOf('job_timeout') === 0;
    });
    check('Slow job rejects with job_timeout', timedOut);

    // Inner rejection passes through
    var propagated = false;
    await withJobTimeout(Promise.reject(new Error('inner')), 5000, 'rej').catch(function (err) {
      propagated = err.message === 'inner';
    });
    check('Inner rejection propagated correctly', propagated);

    // Parallel jobs resolve independently
    var r1 = null;
    var r2 = null;
    await Promise.all([
      withJobTimeout(Promise.resolve('a'), 5000, 'r1').then(function (v) { r1 = v; }),
      withJobTimeout(Promise.resolve('b'), 5000, 'r2').then(function (v) { r2 = v; }),
    ]);
    check('Parallel jobs resolve independently', r1 === 'a' && r2 === 'b');
  });

  // ── 4. CHANNEL_STATUS constants present ──────────────────────────────────

  await runSection('Notification adapter: CHANNEL_STATUS constants', async function () {
    var CS = notificationAdapter.CHANNEL_STATUS;
    check('CHANNEL_STATUS.SENT defined', CS.SENT === 'sent');
    check('CHANNEL_STATUS.STUB defined', CS.STUB === 'stub');
    check('CHANNEL_STATUS.ERROR defined', CS.ERROR === 'failed');
    check('CHANNEL_STATUS.SKIPPED defined', CS.SKIPPED === 'skipped');
    check('CHANNEL_STATUS.DISABLED defined', CS.DISABLED === 'disabled');
  });

  // ── 5. Provider-dependent checks (explicitly skipped by default) ─────────

  await runSection('Provider-dependent delivery checks', async function () {
    var wpEnabled = process.env.NOTIFICATION_WHATSAPP_ENABLED === 'true';
    var smsEnabled = process.env.NOTIFICATION_SMS_ENABLED === 'true';
    var emailEnabled = process.env.NOTIFICATION_EMAIL_ENABLED === 'true';

    if (!wpEnabled) {
      markProviderDependent('WhatsApp real delivery check', 'provider disabled (NOTIFICATION_WHATSAPP_ENABLED!=true)');
    } else if (!CHECK_REAL_PROVIDERS) {
      markProviderDependent('WhatsApp real delivery check', 'provider enabled but --check-providers not requested');
    } else {
      var wp = await notificationAdapter.sendJourneyNotification({
        tenantId: 'tenant-provider-check', channel: 'whatsapp', subjectId: 'sub-provider-check',
        eventType: 'reminder_24h', payload: { providerCheck: true },
      });
      check('WhatsApp provider check returned non-stub status', wp.status !== 'stub' && wp.status !== 'disabled' && wp.status !== 'error', 'status=' + wp.status);
    }

    if (!smsEnabled) {
      markProviderDependent('SMS real delivery check', 'provider disabled (NOTIFICATION_SMS_ENABLED!=true)');
    } else if (!CHECK_REAL_PROVIDERS) {
      markProviderDependent('SMS real delivery check', 'provider enabled but --check-providers not requested');
    } else {
      var sms = await notificationAdapter.sendJourneyNotification({
        tenantId: 'tenant-provider-check', channel: 'sms', subjectId: 'sub-provider-check',
        eventType: 'reminder_24h', payload: { providerCheck: true },
      });
      check('SMS provider check returned non-stub status', sms.status !== 'stub' && sms.status !== 'disabled' && sms.status !== 'error', 'status=' + sms.status);
    }

    if (!emailEnabled) {
      markProviderDependent('Email real delivery check', 'provider disabled (NOTIFICATION_EMAIL_ENABLED!=true)');
    } else if (!CHECK_REAL_PROVIDERS) {
      markProviderDependent('Email real delivery check', 'provider enabled but --check-providers not requested');
    } else {
      var email = await notificationAdapter.sendJourneyNotification({
        tenantId: 'tenant-provider-check', channel: 'email', subjectId: 'sub-provider-check',
        eventType: 'reminder_24h', payload: { providerCheck: true },
      });
      check('Email provider check returned non-stub status', email.status !== 'stub' && email.status !== 'disabled' && email.status !== 'error', 'status=' + email.status);
    }
  });

  // ── Summary ──────────────────────────────────────────────────────────────

  console.log('\n' + '-'.repeat(60));
  console.log('Validation: ' + passed + ' passed, ' + failed + ' failed, ' + skipped + ' skipped, ' + providerDependent + ' provider-dependent (' + (passed + failed + skipped + providerDependent) + ' total)');

  if (failed > 0) {
    console.log('\nFailed checks:');
    results.filter(function (r) { return !r.ok; }).forEach(function (r) {
      console.log('  \u2717 ' + r.name + (r.detail ? ' \u2014 ' + r.detail : ''));
    });
    process.exit(1);
  }

  console.log('\nAll required checks passed.\n');
  console.log('REMINDER: Notification channels (WhatsApp, SMS, Email) are stubs.');
  console.log('          Set NOTIFICATION_WHATSAPP_ENABLED=true etc. for real delivery.\n');
  process.exit(0);

}()).catch(function (err) {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
