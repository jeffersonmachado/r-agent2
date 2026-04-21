const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class PageStateInspector {
  constructor(options = {}) {
    this.outputDir = options.outputDir || path.join(__dirname, '..', 'reports', 'bugs');
    this.assetsDir = options.assetsDir || path.join(this.outputDir, 'assets');
  }

  ensureDirs() {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
    if (!fs.existsSync(this.assetsDir)) {
      fs.mkdirSync(this.assetsDir, { recursive: true });
    }
  }

  hashSnapshot(payload) {
    return crypto.createHash('sha1').update(JSON.stringify(payload)).digest('hex');
  }

  async inspect(page, options = {}) {
    this.ensureDirs();

    if (!page) {
      return {
        collectedAt: new Date().toISOString(),
        url: null,
        title: null,
        domSnapshot: null,
        partialHtml: null,
        candidateElements: [],
        consoleErrors: [],
        failedRequests: [],
        performanceTiming: null,
        screenshotPath: null,
        pageStateHash: this.hashSnapshot({ empty: true }),
      };
    }

    const selectorHint = String(options.selector || '').trim();

    const [url, title] = await Promise.all([
      Promise.resolve().then(() => page.url()).catch(() => null),
      Promise.resolve().then(() => page.title()).catch(() => null),
    ]);

    const domInfo = await page.evaluate((selector) => {
      const safeText = (value, max = 300) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
      const selectors = [];
      if (selector) {
        selector
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean)
          .forEach((part) => selectors.push(part));
      }
      selectors.push('[data-testid]', '[data-id]', '[aria-label]', 'button', 'input', 'textarea', '[role]');

      const unique = new Set();
      const candidateElements = [];

      selectors.forEach((sel) => {
        try {
          const list = Array.from(document.querySelectorAll(sel)).slice(0, 6);
          list.forEach((el) => {
            if (!el || unique.has(el)) return;
            unique.add(el);

            const rect = el.getBoundingClientRect();
            const styles = window.getComputedStyle(el);

            candidateElements.push({
              tag: el.tagName.toLowerCase(),
              text: safeText(el.innerText || el.textContent),
              attributes: {
                id: el.getAttribute('id') || null,
                name: el.getAttribute('name') || null,
                role: el.getAttribute('role') || null,
                class: el.getAttribute('class') || null,
                'data-testid': el.getAttribute('data-testid') || null,
                'data-id': el.getAttribute('data-id') || null,
                'aria-label': el.getAttribute('aria-label') || null,
              },
              boundingBox: {
                x: Number(rect.x.toFixed(2)),
                y: Number(rect.y.toFixed(2)),
                width: Number(rect.width.toFixed(2)),
                height: Number(rect.height.toFixed(2)),
              },
              visible: !!(rect.width > 0 && rect.height > 0 && styles.visibility !== 'hidden' && styles.display !== 'none'),
              disabled: !!el.disabled,
            });
          });
        } catch (error) {
          // Ignore invalid selectors
        }
      });

      const html = document.documentElement ? document.documentElement.outerHTML : '';
      const bodyHtml = document.body ? document.body.innerHTML : '';

      return {
        domSnapshot: html.slice(0, 200000),
        partialHtml: bodyHtml.slice(0, 25000),
        candidateElements,
      };
    }, selectorHint).catch(() => ({ domSnapshot: null, partialHtml: null, candidateElements: [] }));

    const performanceTiming = await page.evaluate(() => {
      try {
        const nav = performance.getEntriesByType('navigation')[0];
        if (nav) {
          return {
            domComplete: Math.round(nav.domComplete),
            domInteractive: Math.round(nav.domInteractive),
            responseEnd: Math.round(nav.responseEnd),
            loadEventEnd: Math.round(nav.loadEventEnd),
            duration: Math.round(nav.duration),
          };
        }

        return {
          timing: performance.timing
            ? {
                domComplete: performance.timing.domComplete,
                responseEnd: performance.timing.responseEnd,
                loadEventEnd: performance.timing.loadEventEnd,
              }
            : null,
        };
      } catch (error) {
        return null;
      }
    }).catch(() => null);

    const screenshotName = `bug-state-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const screenshotPath = path.join(this.assetsDir, screenshotName);
    const screenshotSaved = await page
      .screenshot({ path: screenshotPath, fullPage: true })
      .then(() => screenshotPath)
      .catch(() => null);

    const consoleErrors = Array.isArray(options.consoleLogs)
      ? options.consoleLogs.filter((entry) => String(entry?.level || '').toLowerCase() === 'error')
      : [];

    const failedRequests = Array.isArray(options.httpErrors)
      ? options.httpErrors.filter((entry) => Number(entry?.status || 0) >= 400 || entry?.type === 'request_failed')
      : [];

    const pageStateHash = this.hashSnapshot({
      url,
      title,
      partialHtml: domInfo.partialHtml,
      candidateElements: domInfo.candidateElements,
      consoleErrors: consoleErrors.map((item) => item.text || item.message || null),
      failedRequests: failedRequests.map((item) => item.url || item.message || null),
    });

    return {
      collectedAt: new Date().toISOString(),
      url,
      title,
      domSnapshot: domInfo.domSnapshot,
      partialHtml: domInfo.partialHtml,
      candidateElements: domInfo.candidateElements,
      consoleErrors,
      failedRequests,
      performanceTiming,
      screenshotPath: screenshotSaved,
      pageStateHash,
    };
  }
}

module.exports = {
  PageStateInspector,
};
