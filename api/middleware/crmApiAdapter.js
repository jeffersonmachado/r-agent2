'use strict';

/**
 * CRM API Adapter for server.js
 * Wraps Express app to work with Node.js http.createServer
 * Integrates CRM routes into main request handler
 */

const crmApp = require('../crm-api-app');

/**
 * Adapter function to handle CRM requests
 * Converts Node.js http request/response to Express format
 
 */
async function handleCrmRequest(req, res) {
  // Extract tenant and auth from request headers
  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.replace('Bearer ', '');

  // Set sequelize instance on req for handlers
  try {
    const { getSequelize } = require('../db/sequelize');
    const sequelize = getSequelize();
    if (sequelize) {
      req.sequelize = sequelize;
    }
  } catch (err) {
    console.warn('Could not attach sequelize to request:', err.message);
  }

  // Extract tenant from URL or headers
  const tenantKeyHeader = req.headers['x-tenant-key'] || 'default';
  req.tenantKey = tenantKeyHeader;

  // Parse user from token (simplified - in production would verify JWT)
  req.user = {
    id: 'user-123',
    bearer: bearerToken,
  };

  // Delegate to Express app using the standard Node.js adapter pattern
  return new Promise((resolve, reject) => {
    crmApp(req, res, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Check if a request pathname should be routed to CRM API
 */
function isCrmRequest(pathname) {
  return (
    pathname.startsWith('/api/crm/') ||
    pathname.startsWith('/crm/')
  );
}

module.exports = {
  handleCrmRequest,
  isCrmRequest,
  crmApp,
};
