#!/usr/bin/env node
'use strict';

/**
 * Test CRM Express App Directly
 * Bypasses server.js and tests only the Express app
 */

process.env.NODE_ENV = 'development';

const http = require('http');

console.log('[TEST] Loading sequelize...');
const { connect } = require('./api/db/sequelize');

console.log('[TEST] Connecting to database...');
connect()
  .then(() => {
    console.log('[TEST] ✅ Database connected');
    
    console.log('[TEST] Loading models...');
    const { defineRelationships } = require('./api/db/models/index');
    defineRelationships();
    
    console.log('[TEST] ✅ Models loaded');
    console.log('[TEST] Loading CRM Express app...');
    
    const crmApp = require('./api/crm-api-app');
    
    const server = http.createServer(crmApp);
    
    server.listen(3555, () => {
      console.log('[TEST] ✅ CRM Express server listening on :3555');
      console.log('[TEST] Testing /health endpoint...');
      
      http.get('http://localhost:3555/health', (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          console.log('[TEST] Status:', res.statusCode);
          console.log('[TEST] Response:', data);
          
          if (res.statusCode === 200) {
            console.log('\n✅ CRM EXPRESS APP IS WORKING!\n');
            
            console.log('[TEST] Testing /accounts endpoint...');
            http.get('http://localhost:3555/accounts', (res2) => {
              let data2 = '';
              res2.on('data', chunk => data2 += chunk);
              res2.on('end', () => {
                console.log('[TEST] Status:', res2.statusCode);
                console.log('[TEST] Response:', data2.substring(0, 200));
                
                server.close();
                process.exit(0);
              });
            }).on('error', (err) => {
              console.error('[TEST] ❌ Accounts test error:', err.message);
              server.close();
              process.exit(1);
            });
          } else {
            console.error('\n❌ Health check failed\n');
            server.close();
            process.exit(1);
          }
        });
      }).on('error', (err) => {
        console.error('[TEST] ❌ Health test error:', err.message);
        server.close();
        process.exit(1);
      });
    });
  })
  .catch(err => {
    console.error('[TEST] ❌ Setup error:', err.message);
    process.exit(1);
  });
