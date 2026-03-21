const ensureAuthenticated = (req, res, requireAuth, sendJson) => {
  const authResult = requireAuth(req);
  if (!authResult.valid) {
    sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
    return false;
  }

  return true;
};

const getPathSuffix = (pathname, prefix) => decodeURIComponent(pathname.slice(prefix.length));

const getExecutionIdFromActionPath = (pathname) => {
  const parts = pathname.split('/').filter(Boolean);
  const executionIndex = parts.indexOf('execution');
  if (executionIndex === -1 || executionIndex + 1 >= parts.length) {
    return '';
  }
  return decodeURIComponent(parts[executionIndex + 1]);
};

const isSafeJsonFilename = (filename) => {
  if (!filename || typeof filename !== 'string') return false;
  if (!filename.endsWith('.json')) return false;
  if (filename.includes('/') || filename.includes('\\')) return false;
  if (filename.includes('..')) return false;
  return true;
};

module.exports = {
  ensureAuthenticated,
  getPathSuffix,
  getExecutionIdFromActionPath,
  isSafeJsonFilename,
};
