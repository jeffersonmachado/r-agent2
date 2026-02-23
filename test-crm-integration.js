#!/usr/bin/env node

const server = require('./api/server.js');
const http = require('http');

const testServer = http.createServer((req, res) => {
  server._internal.requestHandler(req, res).catch(err => {
    res.statusCode = 500;
    res.end(JSON.stringify({error: err.message}));
  });
});

testServer.listen(3099, () => {
  console.log('[TEST] Servidor iniciado na porta 3099, aguardando 5s...');
  
  setTimeout(() => {
    console.log('[TEST] Fazendo requisição para /api/crm/accounts');
    
    const req = http.get('http://localhost:3099/api/crm/accounts', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          
          console.log('\n========================================');
          console.log('         CRM API TEST RESULT');
          console.log('========================================');
          console.log('Status Code:', res.statusCode);
          console.log('Response OK:', parsed.ok);
          
          if (res.statusCode === 200) {
            console.log('\n✅✅✅ SUCCESS! ✅✅✅');
            console.log('CRM API is FULLY OPERATIONAL!');
            console.log('Accounts returned:', (parsed.data || []).length);
          } else {
            console.log('\nError:', parsed.error);
            console.log('Message:', parsed.message);
          }
          console.log('========================================\n');
          
        } catch (e) {
          console.error('Parse error:', e.message);
          console.log('Raw response:', data.substring(0, 500));
        }
        
        testServer.close();
        process.exit(res.statusCode === 200 ? 0 : 1);
      });
    });
    
    req.on('error', err => {
      console.error('[TEST] Request error:', err.message);
      testServer.close();
      process.exit(1);
    });
    
    req.setTimeout(10000, () => {
      console.error('[TEST] Request timeout!');
      req.destroy();
      testServer.close();
      process.exit(1);
    });
    
  }, 5000);
});

// Timeout global
setTimeout(() => {
  console.error('[TEST] Global timeout - test taking too long!');
  process.exit(1);
}, 45000);
