const fs = require('fs');
const path = require('path');

const FRONTEND_SRC_DIR = path.join(__dirname, '../../frontend/src');
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const DOMAIN_ALLOWLIST_FILES = new Set([
  // Exemplo: 'frontend/src/pages/DocsPage.jsx'
]);
const DOMAIN_ALLOWLIST_LINE_MARKER = 'url-regression-allow-domain';

function collectSourceFiles(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(entryPath));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(entryPath);
    }
  }

  return files;
}

function findViolations(sourceFiles, regex, options = {}) {
  const { allowlistFiles = new Set(), allowlistLineMarker = null } = options;
  const violations = [];

  for (const sourceFile of sourceFiles) {
    const relativePath = path.relative(process.cwd(), sourceFile);
    if (allowlistFiles.has(relativePath)) {
      continue;
    }

    const content = fs.readFileSync(sourceFile, 'utf8');
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      if (allowlistLineMarker && line.includes(allowlistLineMarker)) {
        return;
      }

      if (regex.test(line)) {
        violations.push(`${relativePath}:${index + 1}`);
      }
      regex.lastIndex = 0;
    });
  }

  return violations;
}

describe('Frontend URL usage regression', () => {
  test('must not use fetch("/api/..." ) directly in frontend source', () => {
    const sourceFiles = collectSourceFiles(FRONTEND_SRC_DIR);
    const directApiFetchRegex = /fetch\(\s*['"]\/api\//g;
    const violations = findViolations(sourceFiles, directApiFetchRegex);

    expect(violations).toEqual([]);
  });

  test('must not hardcode results.com.br domain in frontend source', () => {
    const sourceFiles = collectSourceFiles(FRONTEND_SRC_DIR);
    const hardcodedDomainRegex = /(?:https?:\/\/)?(?:www\.)?results\.com\.br\b/gi;
    const violations = findViolations(sourceFiles, hardcodedDomainRegex, {
      allowlistFiles: DOMAIN_ALLOWLIST_FILES,
      allowlistLineMarker: DOMAIN_ALLOWLIST_LINE_MARKER,
    });

    expect(violations).toEqual([]);
  });
});
