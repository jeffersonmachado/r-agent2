/**
 * Testes para endpoints de Tickets
 */

const http = require('http');

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

/**
 * Faz uma requisição HTTP
 */
function httpRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, body: parsed, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, body: data, headers: res.headers });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

/**
 * Testa endpoints de tickets
 */
async function testTicketsEndpoints() {
  console.log('\n🎫 Testando endpoints de Tickets...\n');

  let token = null;
  let ticketId = null;

  try {
    // 1. Login
    console.log('1. Fazendo login...');
    const loginUrl = new URL('/auth/login', API_BASE_URL);
    const loginResponse = await httpRequest({
      hostname: loginUrl.hostname,
      port: loginUrl.port || 3000,
      path: loginUrl.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    }, {
      username: 'systemadmin',
      password: 'Admin123!'
    });

    if (loginResponse.status !== 200 || !loginResponse.body.token) {
      console.log('   ❌ Erro no login');
      return { success: false, error: 'Login falhou' };
    }

    token = loginResponse.body.token;
    console.log('   ✅ Login realizado\n');

    // 2. GET /tickets
    console.log('2. Testando GET /tickets...');
    const ticketsUrl = new URL('/tickets', API_BASE_URL);
    const ticketsResponse = await httpRequest({
      hostname: ticketsUrl.hostname,
      port: ticketsUrl.port || 3000,
      path: ticketsUrl.pathname,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (ticketsResponse.status === 200) {
      if (Array.isArray(ticketsResponse.body)) {
        console.log(`   ✅ Lista de tickets obtida (${ticketsResponse.body.length} tickets)`);
        if (ticketsResponse.body.length > 0) {
          ticketId = ticketsResponse.body[0].id;
        }
      } else {
        console.log('   ✅ Resposta obtida (formato não array)');
      }
    } else {
      console.log('   ⚠️  Erro ao obter tickets:', ticketsResponse.status);
    }

    // 3. GET /tickets com filtros
    console.log('3. Testando GET /tickets?status=open...');
    const ticketsFilteredUrl = new URL('/tickets?status=open&limit=10', API_BASE_URL);
    const ticketsFilteredResponse = await httpRequest({
      hostname: ticketsFilteredUrl.hostname,
      port: ticketsFilteredUrl.port || 3000,
      path: ticketsFilteredUrl.pathname + ticketsFilteredUrl.search,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (ticketsFilteredResponse.status === 200) {
      console.log('   ✅ Tickets filtrados obtidos');
    } else {
      console.log('   ⚠️  Erro ao obter tickets filtrados:', ticketsFilteredResponse.status);
    }

    // 4. GET /tickets/:id
    if (ticketId) {
      console.log(`4. Testando GET /tickets/${ticketId}...`);
      const ticketUrl = new URL(`/tickets/${ticketId}`, API_BASE_URL);
      const ticketResponse = await httpRequest({
        hostname: ticketUrl.hostname,
        port: ticketUrl.port || 3000,
        path: ticketUrl.pathname,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (ticketResponse.status === 200 && ticketResponse.body.id) {
        console.log('   ✅ Ticket específico obtido');
      } else {
        console.log('   ⚠️  Erro ao obter ticket:', ticketResponse.status);
      }

      // 5. GET /tickets/:id/messages
      console.log(`5. Testando GET /tickets/${ticketId}/messages...`);
      const messagesUrl = new URL(`/tickets/${ticketId}/messages`, API_BASE_URL);
      const messagesResponse = await httpRequest({
        hostname: messagesUrl.hostname,
        port: messagesUrl.port || 3000,
        path: messagesUrl.pathname,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (messagesResponse.status === 200) {
        console.log('   ✅ Mensagens do ticket obtidas');
      } else {
        console.log('   ⚠️  Erro ao obter mensagens:', messagesResponse.status);
      }
    }

    // 6. GET /queues/:queue/tickets
    console.log('6. Testando GET /queues/suporte/tickets...');
    const queueTicketsUrl = new URL('/queues/suporte/tickets', API_BASE_URL);
    const queueTicketsResponse = await httpRequest({
      hostname: queueTicketsUrl.hostname,
      port: queueTicketsUrl.port || 3000,
      path: queueTicketsUrl.pathname,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (queueTicketsResponse.status === 200) {
      console.log('   ✅ Tickets da fila obtidos');
    } else {
      console.log('   ⚠️  Erro ao obter tickets da fila:', queueTicketsResponse.status);
    }

    console.log('\n✅ Testes de tickets concluídos!\n');
    return { success: true };

  } catch (error) {
    console.error('❌ Erro nos testes de tickets:', error.message);
    return { success: false, error: error.message };
  }
}

// Executa se for chamado diretamente
if (require.main === module) {
  testTicketsEndpoints()
    .then((result) => {
      process.exit(result.success ? 0 : 1);
    })
    .catch((error) => {
      console.error('❌ Erro ao executar testes:', error);
      process.exit(1);
    });
}

module.exports = { testTicketsEndpoints };
