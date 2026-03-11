'use strict';

class ProcessTimerService {
  constructor() {
    this.timers = new Map();
  }

  schedule({ timerId, delayMs, callback }) {
    const id = String(timerId || `timer_${Date.now()}`);
    const delay = Number.isFinite(Number(delayMs)) ? Number(delayMs) : 0;

    this.cancel(id);

    const handle = setTimeout(() => {
      this.timers.delete(id);
      if (typeof callback === 'function') callback();
    }, Math.max(0, delay));

    this.timers.set(id, handle);
    return id;
  }

  cancel(timerId) {
    const id = String(timerId || '').trim();
    if (!id || !this.timers.has(id)) return false;
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    return true;
  }

  clearAll() {
    Array.from(this.timers.keys()).forEach((timerId) => this.cancel(timerId));
  }
}

module.exports = {
  ProcessTimerService,
};
