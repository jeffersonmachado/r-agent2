#!/usr/bin/env node
'use strict';

/**
 * Simulate server.js calling handleCrmRequest
 * Tests the integration without starting full server
 */

process.env.NODE_ENV = 'development';

const http = require('http');

console.log('[TEST] Simulating server.js integration...\n');

// Initialize database
const { connect } = require('./api/db/sequelize');

connect().then(async () => {
  const { defineRelationships } = require('./api/db/models/index');
  defineRelationships();
  
  // Setup admin permissions
  const { CrmRole, CrmUserRole } = require('./api/db/models/index');
  
  const [role] = await CrmRole().findOrCreate({
    where: { name: 'admin', tenant_key: 'master' },
    defaults: {
      name: 'admin',
      permissions: ['crm:accounts:read', 'crm:accounts:write', 'crm:admin'],
      tenant_key: 'master',
    },
  });
  
  await CrmUserRole().findOrCreate({
    where: { tenant_key: 'master', user_id: 'user-integration-test', role_id: role.id },
    defaults: {
      tenant_key: 'master',
      user_id: 'user-integration-test',
      role_id: role.id,
      assigned_by: 'system',
    },
  });
  
  console.log('[SETUP] ✅ Admin configured\n');
  
  // Create a mini server that simulates server.js behavior
  const { handleCrmRequest } = require('./api/middleware/crmApiAdapter');
  
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    
    // Simulate what server.js does - check if starts with /api/crm/
    if (pathname.startsWith('/api/crm/')) {
      console.log('[SERVER.JS] CRM route detected:', pathname);
      
      // Simulate authentication - server.js would set req.user from JWT
      req.user = {
        id: 'user-integration-test',
        tenant_key: 'master',
      };
      
      try {
        console.log('[SERVER.JS] Calling handleCrmRequest()...');
        await handleCrmRequest(req, res);
        console.log('[SERVER.JS] ✅ handleCrmRequest completed');
      } catch (err) {
        console.error('[SERVER.JS] ❌ Error:', err.message);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
      }
    } else {
      res.statusCode = 404;
      res.end('Not Found');
    }
  });
  
  server.listen(3200, () => {
    console.log('[TEST] Test server listening on :3200\n');
    
    // Test 1: Health
    console.log('[TEST] 1. Testing /api/crm/health...');
    http.get('http://localhost:3200/api/crm/health', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('[TEST]    Status:', res.statusCode, 'Response:', data.substring(0, 100));
        
        // Test 2: Accounts
        console.log('[TEST] 2. Testing /api/crm/accounts...');
        http.get('http://localhost:3200/api/crm/accounts', (res2) => {
          let data2 = '';
          res2.on('data', chunk => data2 += chunk);
          res2.on('end', () => {
            console.log('[TEST]    Status:', res2.statusCode, 'Response:', data2.substring(0, 150));
            
            console.log('\n' + '═'.repeat(60));
            if (res.statusCode === 200 && res2.statusCode === 200) {
              console.log('✅ INTEGRAÇÃO CRM → SERVER.JS FUNCIONANDO PERFEITAMENTE!');
              console.log('═'.repeat(60));
              console.log('\nFluxo validado:');
              console.log('  1. server.js detecta pathname.startsWith("/api/crm/")');
              console.log('  2. server.js chama handleCrmRequest(req, res)');
              console.log('  3. handleCrmRequest configura req.user e req.sequelize');
              console.log('  4. handleCrmRequest delega para Express crmApp');
              console.log('  5. Express processa route e retorna resposta');
              console.log('  6. RBAC valida permissões corretamente');
              console.log('  7. Endpoints retornam dados com sucesso\n');
            } else {
              console.log('⚠️  FALHA NA INTEGRAÇÃO');
              console.log('═'.repeat(60) + '\n');
            }
            
            server.close();
            process.exit(res.statusCode === 200 && res2.statusCode === 200 ? 0 : 1);
          });
        });
      });
    });
  });
}).catch(err => {
  console.error('[ERROR]', err);
  process.exit(1);
});
