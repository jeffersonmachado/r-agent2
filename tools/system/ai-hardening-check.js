#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { runtimeAwarePath, resolveWorkspacePath } = require('./lib/runtime-paths');

const ROOT_DIR = path.join(__dirname, '..', '..');
const REPORT_PATH = runtimeAwarePath(ROOT_DIR, 'qa/ai-hardening-report.json', 'AI_HARDENING_REPORT_PATH');

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const BLUE = '\x1b[34m';

function log(message, color = RESET) {
  // eslint-disable-next-line no-console
  console.log(`${color}${message}${RESET}`);
}

function readText(relPath) {
  const absPath = path.join(ROOT_DIR, relPath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`missing_file:${relPath}`);
  }
  return fs.readFileSync(absPath, 'utf8');
}

function parseJson(relPath) {
  const content = readText(relPath);
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`invalid_json:${relPath}:${error.message || error}`);
  }
}

function isPlaceholder(value) {
  if (typeof value !== 'string') return true;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;
  return normalized.includes('replace_me') || normalized.includes('changeme') || normalized.includes('your_') || normalized.includes('example');
}

function checkFilesExist() {
  const files = [
    'docs/CONFIGURACAO_IA.md',
    'docs/FALLBACK_HARDENING.md',
    'api/services/tenantAIService.js',
    'engine/aiProviderManager.js',
    'api/data/config.example.json',
  ];

  const missing = files.filter((relPath) => !fs.existsSync(path.join(ROOT_DIR, relPath)));
  return {
    id: 'required-files',
    status: missing.length === 0 ? 'pass' : 'fail',
    details: missing.length === 0 ? { files } : { missing },
  };
}

function checkSupportedProviders() {
  const source = readText('api/services/tenantAIService.js');
  const match = source.match(/SUPPORTED_AI_PROVIDERS\s*=\s*new Set\(\[([^\]]+)\]\)/m);

  if (!match) {
    return {
      id: 'supported-providers',
      status: 'fail',
      details: { reason: 'supported_providers_declaration_not_found' },
    };
  }

  const providers = match[1]
    .split(',')
    .map((part) => part.replace(/["'\s]/g, ''))
    .filter(Boolean)
    .sort();

  const expected = ['anthropic', 'openai'];
  const isOk = providers.length === expected.length && providers.every((item, idx) => item === expected[idx]);

  return {
    id: 'supported-providers',
    status: isOk ? 'pass' : 'fail',
    details: {
      expected,
      found: providers,
    },
  };
}

function checkConfigExampleAIBlock() {
  const config = parseJson('api/data/config.example.json');
  const ai = config.ai || {};

  const hasModels = Boolean(ai.openai && ai.openai.model && ai.anthropic && ai.anthropic.model);
  const hasApiKeyInAiBlock = Object.values(ai).some((providerConfig) => {
    if (!providerConfig || typeof providerConfig !== 'object') return false;
    return Object.prototype.hasOwnProperty.call(providerConfig, 'apiKey');
  });

  return {
    id: 'config-example-ai-block',
    status: hasModels && !hasApiKeyInAiBlock ? 'pass' : 'fail',
    details: {
      hasOpenAIModel: Boolean(ai.openai && ai.openai.model),
      hasAnthropicModel: Boolean(ai.anthropic && ai.anthropic.model),
      hasApiKeyInAiBlock,
    },
  };
}

function checkEncryptionKeyWhenRequired() {
  const required = String(process.env.AI_HARDENING_REQUIRE_ENCRYPTION_KEY || '0') === '1';
  if (!required) {
    return {
      id: 'encryption-key-required',
      status: 'pass',
      details: { required: false },
    };
  }

  const value = process.env.ENCRYPTION_KEY;
  const ok = !isPlaceholder(value);

  return {
    id: 'encryption-key-required',
    status: ok ? 'pass' : 'fail',
    details: {
      required: true,
      configured: Boolean(value && value.trim()),
      placeholderLike: isPlaceholder(value),
    },
  };
}

function writeReport(report) {
  const absPath = resolveWorkspacePath(ROOT_DIR, REPORT_PATH);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return absPath;
}

function main() {
  const checks = [
    checkFilesExist(),
    checkSupportedProviders(),
    checkConfigExampleAIBlock(),
    checkEncryptionKeyWhenRequired(),
  ];

  const failed = checks.filter((check) => check.status !== 'pass');
  const report = {
    source: 'system:ai-hardening-check',
    generatedAt: new Date().toISOString(),
    status: failed.length === 0 ? 'GO' : 'NO_GO',
    runtimeRoot: process.env.RUNTIME_ROOT || null,
    checks,
  };

  const reportPath = writeReport(report);

  if (failed.length > 0) {
    log(`[system:ai-hardening-check] NO_GO - veja relatório em ${reportPath}`, RED);
    process.exit(1);
  }

  log(`[system:ai-hardening-check] GO - relatório em ${reportPath}`, GREEN);
}

if (require.main === module) {
  try {
    log('[system:ai-hardening-check] Executando validações de hardening de IA', BLUE);
    main();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[system:ai-hardening-check] FAIL: ${error.message || error}`);
    process.exit(1);
  }
}
