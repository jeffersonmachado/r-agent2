#!/usr/bin/env node
/**
 * Script para limpeza de tickets antigos do sistema de filas.
 * 
 * Uso:
 *   node scripts/cleanup-tickets.js [--max-age-days=7] [--dry-run]
 * 
 * Configuração:
 *   Carrega de api/data/config.json (seção scripts)
 *   Pode ser sobrescrito por variáveis de ambiente (compatibilidade)
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

// Carrega configuração do JSON
let config = {};
try {
  const configPath = path.join(__dirname, '..', 'api', 'data', 'config.json');
  if (fs.existsSync(configPath)) {
    const configData = fs.readFileSync(configPath, 'utf8');
    config = JSON.parse(configData);
  }
} catch (err) {
  console.warn('Não foi possível carregar config.json, usando valores padrão:', err.message);
}

const API_URL = process.env.API_URL || config.scripts?.apiUrl || 'http://localhost:3000';
const MAX_AGE_DAYS = parseInt(process.env.MAX_AGE_DAYS || config.scripts?.maxAgeDays || '7', 10);
const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === 'true' || config.scripts?.dryRun === true;

/**
 * Faz requisição HTTP GET
 */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Erro ao parsear JSON: ${e.message}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    }).on('error', reject);
  });
}

/**
 * Calcula estatísticas dos tickets
 */
function calculateStats(tickets) {
  const now = Date.now();
  const maxAge = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  
  const stats = {
    total: tickets.length,
    byStatus: {
      waiting: 0,
      in_progress: 0,
      closed: 0,
    },
    byQueue: {},
    oldClosed: [],
    oldestTicket: null,
    newestTicket: null,
  };
  
  let oldestDate = Infinity;
  let newestDate = 0;
  
  tickets.forEach((ticket) => {
    // Contagem por status
    stats.byStatus[ticket.status] = (stats.byStatus[ticket.status] || 0) + 1;
    
    // Contagem por fila
    stats.byQueue[ticket.queue] = (stats.byQueue[ticket.queue] || 0) + 1;
    
    // Tickets fechados antigos
    if (ticket.status === 'closed') {
      const ticketAge = now - new Date(ticket.updatedAt).getTime();
      const ticketAgeDays = Math.floor(ticketAge / (24 * 60 * 60 * 1000));
      
      if (ticketAge > maxAge) {
        stats.oldClosed.push({
          id: ticket.id,
          queue: ticket.queue,
          ageDays: ticketAgeDays,
          closedAt: ticket.updatedAt,
        });
      }
    }
    
    // Encontrar ticket mais antigo e mais novo
    const createdAt = new Date(ticket.createdAt).getTime();
    if (createdAt < oldestDate) {
      oldestDate = createdAt;
      stats.oldestTicket = ticket;
    }
    if (createdAt > newestDate) {
      newestDate = createdAt;
      stats.newestTicket = ticket;
    }
  });
  
  // Ordenar tickets antigos por idade (mais antigos primeiro)
  stats.oldClosed.sort((a, b) => b.ageDays - a.ageDays);
  
  return stats;
}

/**
 * Função principal
 */
async function main() {
  console.log('🔍 Analisando tickets do sistema...\n');
  console.log(`API URL: ${API_URL}`);
  console.log(`Idade máxima para tickets fechados: ${MAX_AGE_DAYS} dias`);
  console.log(`Modo: ${DRY_RUN ? 'DRY RUN (simulação)' : 'EXECUÇÃO REAL'}\n`);
  
  try {
    // Buscar todos os tickets (com suporte à nova estrutura paginada)
    const response = await httpGet(`${API_URL}/tickets?limit=10000`);
    
    // Suporta tanto a estrutura antiga (array) quanto a nova (objeto com tickets)
    let tickets;
    if (Array.isArray(response)) {
      tickets = response; // Estrutura antiga
    } else if (response && Array.isArray(response.tickets)) {
      tickets = response.tickets; // Estrutura nova paginada
    } else {
      throw new Error('Resposta da API não é um array ou objeto com tickets');
    }
    
    // Calcular estatísticas
    const stats = calculateStats(tickets);
    
    // Exibir estatísticas
    console.log('📊 Estatísticas:');
    console.log(`   Total de tickets: ${stats.total}`);
    console.log(`   - Aguardando: ${stats.byStatus.waiting}`);
    console.log(`   - Em atendimento: ${stats.byStatus.in_progress}`);
    console.log(`   - Fechados: ${stats.byStatus.closed}`);
    console.log(`   - Fechados antigos (>${MAX_AGE_DAYS} dias): ${stats.oldClosed.length}`);
    console.log('');
    
    // Filas
    console.log('📋 Tickets por fila:');
    Object.entries(stats.byQueue)
      .sort((a, b) => b[1] - a[1])
      .forEach(([queue, count]) => {
        console.log(`   ${queue}: ${count}`);
      });
    console.log('');
    
    // Tickets antigos
    if (stats.oldClosed.length > 0) {
      console.log(`🗑️  Tickets fechados antigos (${stats.oldClosed.length}):`);
      stats.oldClosed.slice(0, 10).forEach((ticket) => {
        console.log(`   - ${ticket.id} (${ticket.queue}): ${ticket.ageDays} dias`);
      });
      if (stats.oldClosed.length > 10) {
        console.log(`   ... e mais ${stats.oldClosed.length - 10} tickets`);
      }
      console.log('');
      
      if (DRY_RUN) {
        console.log('⚠️  MODO DRY RUN: Nenhum ticket foi removido.');
        console.log('   Execute sem --dry-run para remover tickets antigos.');
        console.log('');
        console.log('   Nota: O sistema atual não possui endpoint DELETE.');
        console.log('   Para remover tickets, é necessário reiniciar o servidor');
        console.log('   ou implementar limpeza automática no código.');
      } else {
        console.log('⚠️  ATENÇÃO: O sistema atual não possui endpoint para deletar tickets.');
        console.log('   Para limpar tickets antigos, você precisa:');
        console.log('   1. Implementar limpeza automática no queueService.js');
        console.log('   2. Ou reiniciar o servidor (perderá TODOS os tickets)');
        console.log('   3. Ou migrar para banco de dados com DELETE');
      }
    } else {
      console.log('✅ Nenhum ticket antigo encontrado para limpeza.');
    }
    
    // Informações adicionais
    if (stats.oldestTicket) {
      const oldestAge = Math.floor(
        (Date.now() - new Date(stats.oldestTicket.createdAt).getTime()) /
        (24 * 60 * 60 * 1000)
      );
      console.log(`\n📅 Ticket mais antigo: ${oldestAge} dias (${stats.oldestTicket.id})`);
    }
    
    if (stats.newestTicket) {
      const newestAge = Math.floor(
        (Date.now() - new Date(stats.newestTicket.createdAt).getTime()) /
        (24 * 60 * 60 * 1000)
      );
      console.log(`📅 Ticket mais recente: ${newestAge} dias (${stats.newestTicket.id})`);
    }
    
    console.log('\n✅ Análise concluída.');
    
  } catch (error) {
    console.error('\n❌ Erro:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error('   Verifique se o servidor está rodando em', API_URL);
    }
    process.exit(1);
  }
}

// Executar
main();

