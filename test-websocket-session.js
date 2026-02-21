#!/usr/bin/env node

/**
 * Teste simples: verificar se sessão criada via HTTP está acessível via WebSocket.
 * 
 * Use: REDIS_URL=redis://localhost:6379 node test-websocket-session.js
 */

const http = require('http');
const WebSocket = require('ws');

const API_URL = 'http://localhost:3000';
const WS_URL = 'ws://localhost:3000/ws';

// Credenciais de teste
const testCredentials = {
  username: 'admin',
  password: 'admin123',
};

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function httpRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_URL + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            body: res.statusCode === 204 ? null : JSON.parse(data),
            headers: res.headers,
          });
        } catch (err) {
          resolve({
            status: res.statusCode,
            body: data,
            headers: res.headers,
          });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function run() {
  try {
    console.log('=== WebSocket Session Test ===\n');

    // 1. Fazer login
    console.log('1. Fazendo login...');
    const loginRes = await httpRequest('POST', '/auth/login', testCredentials);
    if (loginRes.status !== 200) {
      console.error('❌ Falha no login:', loginRes);
      process.exit(1);
    }
    const token = loginRes.body.token;
    console.log('✅ Login bem-sucedido');
    console.log('   Token:', token.substring(0, 20) + '...');
    console.log('   Agente:', loginRes.body.agent.username);

    // 2. Aguardar um pouco
    console.log('\n2. Aguardando 2 segundos...');
    await delay(2000);

    // 3. Conectar ao WebSocket
    console.log('\n3. Conectando ao WebSocket...');
    return new Promise((resolve) => {
      const ws = new WebSocket(WS_URL);

      ws.on('error', (err) => {
        console.error('❌ Erro WebSocket:', err.message);
        resolve(1);
      });

      ws.on('open', () => {
        console.log('✅ WebSocket conectado');

        // Enviar autenticação
        console.log('\n4. Enviando autenticação via WebSocket...');
        ws.send(JSON.stringify({ type: 'auth', token }));

        const timeout = setTimeout(() => {
          console.error('❌ Timeout esperando resposta de autenticação');
          ws.close();
          resolve(1);
        }, 3000);

        ws.on('message', (msg) => {
          try {
            const data = JSON.parse(msg.toString());
            clearTimeout(timeout);

            if (data.type === 'auth') {
              console.log('✅ Resposta de autenticação recebida:', data);
              if (data.status === 'success') {
                console.log('\n🎉 Sucesso! Sessão está acessível via WebSocket.');
                ws.close();
                resolve(0);
              } else {
                console.error('\n❌ Falha na autenticação WebSocket:', data.message);
                console.log('   Erro:', data.message);
                ws.close();
                resolve(1);
              }
            }
          } catch (err) {
            console.error('Erro ao processar mensagem:', err.message);
          }
        });
      });
    });
  } catch (err) {
    console.error('❌ Erro geral:', err);
    process.exit(1);
  }
}

run().then(code => process.exit(code || 0));
