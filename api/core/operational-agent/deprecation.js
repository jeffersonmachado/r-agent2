'use strict';

const SHIM_WARNING_CODE = 'OperationalAgentShimDeprecated';
const SHIM_STRICT_ERROR_CODE = 'OperationalAgentShimBlocked';
const SHIM_STRICT_ENV = 'OPERATIONAL_AGENT_SHIM_STRICT';
const warnedShims = new Set();

function isStrictShimModeEnabled() {
  const value = String(process.env[SHIM_STRICT_ENV] || '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'on' || value === 'strict';
}

function warnLegacyShimImport(shimName, canonicalImportPath) {
  const key = String(shimName || '').trim();
  if (!key) return;

  if (isStrictShimModeEnabled()) {
    const error = new Error(
      `${key} in api/core/operational-agent is disabled in strict mode. Import from ${canonicalImportPath} instead.`,
    );
    error.code = SHIM_STRICT_ERROR_CODE;
    error.shimName = key;
    error.canonicalImportPath = canonicalImportPath;
    throw error;
  }

  if (warnedShims.has(key)) return;
  warnedShims.add(key);

  if (typeof process.emitWarning === 'function') {
    process.emitWarning(
      `${key} in api/core/operational-agent is deprecated. Import from ${canonicalImportPath} instead.`,
      {
        code: SHIM_WARNING_CODE,
        type: 'DeprecationWarning',
      },
    );
  }
}

module.exports = {
  SHIM_STRICT_ENV,
  SHIM_STRICT_ERROR_CODE,
  SHIM_WARNING_CODE,
  warnLegacyShimImport,
};
