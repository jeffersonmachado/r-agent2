function ensureAuthenticated(req, res, requireAuth, sendJson) {
  const authResult = requireAuth(req);
  if (!authResult.valid) {
    sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
    return false;
  }
  return true;
}

function getPathSuffix(pathname, prefix) {
  if (!pathname.startsWith(prefix)) {
    return null;
  }
  return pathname.slice(prefix.length);
}

function getExecutionIdFromActionPath(pathname) {
  const parts = pathname.split('/');
  return parts[parts.length - 2] || '';
}

function isSafeJsonFilename(filename) {
  return !!filename
    && !filename.includes('..')
    && !filename.includes('/')
    && filename.endsWith('.json');
}

module.exports = {
  ensureAuthenticated,
  getPathSuffix,
  getExecutionIdFromActionPath,
  isSafeJsonFilename,
};
