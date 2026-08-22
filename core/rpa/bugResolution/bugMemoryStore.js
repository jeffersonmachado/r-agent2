const fs = require('fs');
const path = require('path');
const dbStateStore = require('../../../qa/state/dbStateStore');

const BUG_MEMORY_KEY = 'core/rpa/reports/bugs/bug-memory.json';

class BugMemoryStore {
  constructor(options = {}) {
    this.storagePath = options.storagePath || path.join(__dirname, '..', 'reports', 'bugs', 'bug-memory.json');
  }

  ensureStore() {
    const dir = path.dirname(this.storagePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.storagePath)) {
      fs.writeFileSync(this.storagePath, JSON.stringify({ entries: {}, stats: {} }, null, 2), 'utf8');
    }
  }

  readStore() {
    this.ensureStore();
    try {
      return JSON.parse(fs.readFileSync(this.storagePath, 'utf8'));
    } catch (error) {
      return { entries: {}, stats: {} };
    }
  }

  writeStore(store) {
    // RAP-078: DB canônico + JSON como export derivado.
    fs.writeFileSync(this.storagePath, JSON.stringify(store, null, 2), 'utf8');
    dbStateStore.saveSyncExport(BUG_MEMORY_KEY, store);
  }

  registerBug(input = {}) {
    const fingerprint = input.fingerprint;
    if (!fingerprint) {
      return {
        recurring: false,
        entry: null,
      };
    }

    const store = this.readStore();
    const existing = store.entries[fingerprint] || {
      fingerprint,
      occurrences: 0,
      lastSeen: null,
      probableOwner: 'UNCERTAIN',
      topRecoveryOutcome: null,
      failures: 0,
      recoveries: 0,
    };

    existing.occurrences += 1;
    existing.lastSeen = new Date().toISOString();
    existing.probableOwner = input.owner || existing.probableOwner;

    if (input.recoverySucceeded) {
      existing.recoveries += 1;
      existing.topRecoveryOutcome = input.topRecoveryOutcome || existing.topRecoveryOutcome || 'RECOVERED';
    } else {
      existing.failures += 1;
      existing.topRecoveryOutcome = input.topRecoveryOutcome || existing.topRecoveryOutcome || 'FAILED';
    }

    store.entries[fingerprint] = existing;

    const allEntries = Object.values(store.entries);
    const recurringCount = allEntries.filter((entry) => entry.occurrences > 1).length;
    const flakyCount = allEntries.filter((entry) => entry.recoveries > 0 && entry.failures > 0).length;

    store.stats = {
      totalFingerprints: allEntries.length,
      recurringCount,
      flakyCount,
      recurringBugFingerprintRate: allEntries.length > 0 ? Number((recurringCount / allEntries.length).toFixed(4)) : 0,
      flakyStepRate: allEntries.length > 0 ? Number((flakyCount / allEntries.length).toFixed(4)) : 0,
      updatedAt: new Date().toISOString(),
    };

    this.writeStore(store);

    return {
      recurring: existing.occurrences > 1,
      flaky: existing.recoveries > 0 && existing.failures > 0,
      entry: existing,
      stats: store.stats,
    };
  }

  getStats() {
    const store = this.readStore();
    return store.stats || {};
  }
}

module.exports = {
  BugMemoryStore,
};
