'use strict';

let cron = null;
try {
  cron = require('node-cron');
} catch (error) {
  // eslint-disable-next-line no-console
  console.error(`[qa-mesh/nodeCronCompat] node-cron indisponível, usando polyfill explícito: ${error.message || error}`);
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
