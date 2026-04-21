const fs = require('fs');
const { spawnSync } = require('child_process');

const DEFAULT_SYSTEM_BROWSER_CANDIDATES = [
  process.env.RPA_BROWSER_PATH,
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  process.env.CHROME_BIN,
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/snap/bin/chromium',
].filter(Boolean);

function dedupe(values) {
  const seen = new Set();
  return values.filter((value) => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function resolveSystemBrowserPath() {
  const commandCandidates = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'];
  const discovered = [];

  for (const command of commandCandidates) {
    const result = spawnSync('which', [command], { encoding: 'utf8' });
    if (result.status === 0) {
      const candidate = String(result.stdout || '').trim();
      if (candidate) discovered.push(candidate);
    }
  }

  const candidates = dedupe([...DEFAULT_SYSTEM_BROWSER_CANDIDATES, ...discovered]);
  const existing = candidates.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch (_) {
      return false;
    }
  });

  return {
    path: existing || null,
    candidates,
  };
}

function isMissingBrowserError(error) {
  const message = String(error && error.message ? error.message : error || '').toLowerCase();
  return (
    message.includes('executable doesn\'t exist') ||
    message.includes('browser executable') ||
    message.includes('please run the following command') ||
    message.includes('failed to launch chromium') ||
    message.includes('enoent')
  );
}

async function launchChromiumWithFallback(chromium, baseOptions = {}) {
  try {
    const browser = await chromium.launch(baseOptions);
    return {
      browser,
      browserSource: 'playwright-bundled',
      executablePath: null,
    };
  } catch (error) {
    if (!isMissingBrowserError(error)) {
      throw error;
    }

    const resolution = resolveSystemBrowserPath();
    if (!resolution.path) {
      const installHint = 'Instale o browser do Playwright com "npx playwright install chromium" ou defina RPA_BROWSER_PATH.';
      const details = resolution.candidates.length > 0
        ? ` Caminhos verificados: ${resolution.candidates.join(', ')}`
        : '';
      throw new Error(`${error.message}. ${installHint}${details}`);
    }

    const browser = await chromium.launch({
      ...baseOptions,
      executablePath: resolution.path,
    });

    return {
      browser,
      browserSource: 'system-browser',
      executablePath: resolution.path,
    };
  }
}

module.exports = {
  resolveSystemBrowserPath,
  launchChromiumWithFallback,
  isMissingBrowserError,
};
