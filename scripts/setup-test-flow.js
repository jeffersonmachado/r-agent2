#!/usr/bin/env node
/**
 * Script para criar um fluxo de teste simples para os testes do WhatsApp
 */

const http = require('http');
const config = require('../api/utils/config');
const fs = require('fs');
const path = require('path');

const PORT = config.get('api.port', 3000);

console.log('🔧 Configurando Fluxo de Teste\n');

// Cria um fluxo mínimo válido (sem fallback para evitar problemas de validação)
const flowData = {
  tenantId: 'tenant-demo',
  id: 'teste-whatsapp',
  name: 'Teste WhatsApp',
  version: 1,
  nodes: [
    {
      id: 'start',
      type: 'start',
      config: {},
      next: 'mensagem'
    },
    {
      id: 'mensagem',
      type: 'message',
      config: {
        text: 'Olá! Esta é uma mensagem de teste do r-agent2.'
      },
      next: 'end'
    },
    {
      id: 'end',
      type: 'end',
      config: {},
      next: null
    }
  ],
  metadata: {}
};

// Verifica se o fluxo já existe
http.get(`http://localhost:${PORT}/flows/${flowData.id}`, (res) => {
  if (res.statusCode === 200) {
    console.log(`✅ Fluxo "${flowData.id}" já existe`);
    // Atualiza o fluxo
    updateFlow();
  } else {
    // Cria o fluxo
    createFlow();
  }
}).on('error', (err) => {
  console.error('❌ Erro ao verificar fluxo:', err.message);
  process.exit(1);
});

function createFlow() {
  console.log(`📝 Criando fluxo "${flowData.id}"...\n`);

  const payload = JSON.stringify(flowData);
  const options = {
    hostname: 'localhost',
    port: PORT,
    path: '/flows',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  const req = http.request(options, (res) => {
    let data = '';

    res.on('data', (chunk) => {
      data += chunk;
    });

    res.on('end', () => {
      if (res.statusCode === 201 || res.statusCode === 200) {
        console.log('✅ Fluxo criado com sucesso!');
        updateConfig();
      } else {
        console.log('❌ Erro ao criar fluxo');
        console.log(`   Status: ${res.statusCode}`);
        console.log(`   Resposta: ${data}`);
        process.exit(1);
      }
    });
  });

  req.on('error', (err) => {
    console.error('❌ Erro ao conectar:', err.message);
    process.exit(1);
  });

  req.write(payload);
  req.end();
}

function updateFlow() {
  console.log(`📝 Atualizando fluxo "${flowData.id}"...\n`);

  const payload = JSON.stringify(flowData);
  const options = {
    hostname: 'localhost',
    port: PORT,
    path: `/flows/${flowData.id}`,
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  const req = http.request(options, (res) => {
    let data = '';

    res.on('data', (chunk) => {
      data += chunk;
    });

    res.on('end', () => {
      if (res.statusCode === 200) {
        console.log('✅ Fluxo atualizado com sucesso!');
        updateConfig();
      } else {
        console.log('❌ Erro ao atualizar fluxo');
        console.log(`   Status: ${res.statusCode}`);
        console.log(`   Resposta: ${data}`);
        process.exit(1);
      }
    });
  });

  req.on('error', (err) => {
    console.error('❌ Erro ao conectar:', err.message);
    process.exit(1);
  });

  req.write(payload);
  req.end();
}

function updateConfig() {
  console.log('⚙️  Atualizando config.json...\n');

  const configPath = path.join(__dirname, '../api/data/config.json');
  let configData;

  try {
    const configContent = fs.readFileSync(configPath, 'utf8');
    configData = JSON.parse(configContent);
  } catch (error) {
    console.error('❌ Erro ao ler config.json:', error.message);
    process.exit(1);
  }

  // Atualiza defaultFlowId
  if (!configData.flows) {
    configData.flows = {};
  }
  configData.flows.defaultFlowId = flowData.id;

  try {
    fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf8');
    console.log(`✅ Config atualizado! defaultFlowId = "${flowData.id}"`);
    console.log('\n✅ Setup concluído!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Erro ao salvar config.json:', error.message);
    console.log('\n⚠️  Configure manualmente em api/data/config.json:');
    console.log(`   "flows": { "defaultFlowId": "${flowData.id}" }`);
    process.exit(1);
  }
}
