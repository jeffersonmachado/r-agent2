'use strict';

let cron = null;
try {
  cron = require('node-cron');
} catch (_) {
  cron = {
    schedule(expression, task) {
      const knownIntervals = {
        '*/15 * * * *': 15 * 60 * 1000,
        '0 2 * * *': 24 * 60 * 60 * 1000,
      };
      const interval = knownIntervals[expression] || 60 * 1000;
      const timer = setInterval(task, interval);
      return {
        start() {},
        stop() { clearInterval(timer); },
        destroy() { clearInterval(timer); },
      };
    },
    validate() {
      return true;
    },
  };
}

module.exports = cron;
