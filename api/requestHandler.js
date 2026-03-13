// ============================================================
// REQUEST HANDLER - Main Route Dispatcher  
// ============================================================
const requestHandler = async function(req, res) {
  // Parse request
  const method = req.method?.toUpperCase() || 'GET';
  const urlObj = req.url ? new URL(req.url, `http://${req.headers.host || 'localhost'}`) : null;
  const pathname = urlObj ? urlObj.pathname : '/';
  
  // Build dependencies for all handlers
  const deps = {
    // Core utilities
    sendJson, badRequest, parseJsonBody, sendApiError, setCorsHeaders,
    hasJsonContentType, buildApiError, notFound,
    // Auth & Permissions
    requireAuth, requirePermission, requireTenant, isSuperAdmin,
    // Logging
    logger, logAction,
    // Common services (references to imported services at top of file)
    validateInput, ValidationError, schemas,
    path, fs,
  };
  
  // TODO: Call all 52 handlers in sequence
  // For now, provide a placeholder to get the file parsing without errors
  
  // Finally, return 404 if nothing matched
  notFound(res);
};

// ============================================================
// PARSE JSON BODY HELPER
// ============================================================
const parseJsonBody = async function(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        resolve(parsed);
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
};

// ============================================================
// SIMPLE RESPONSE HELPERS
// ============================================================
const sendJson = (res, statusCode, data) => {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
};

const badRequest = (res, message) => {
  sendJson(res, 400, { error: 'bad_request', message });
};

const notFound = (res) => {
  sendJson(res, 404, { error: 'not_found', message: 'Endpoint não encontrado' });
};

module.exports = { requestHandler, parseJsonBody, sendJson, badRequest, notFound };
