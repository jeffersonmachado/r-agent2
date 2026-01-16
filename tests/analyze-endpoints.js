/**
 * Script para analisar todos os endpoints da API e verificar quais têm testes
 */

const fs = require('fs');
const path = require('path');

const SERVER_FILE = path.join(__dirname, '../api/server.js');
const TESTS_DIR = path.join(__dirname, '.');

/**
 * Extrai todos os endpoints do server.js usando uma abordagem mais simples
 */
function extractEndpoints() {
  const content = fs.readFileSync(SERVER_FILE, 'utf8');
  const endpoints = [];
  const lines = content.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Padrão 1: // GET /endpoint
    const commentMatch = line.match(/\/\/\s*(GET|POST|PUT|DELETE|PATCH)\s+(\/[^\s]+)/);
    if (commentMatch) {
      endpoints.push({
        method: commentMatch[1].toUpperCase(),
        path: commentMatch[2],
        line: i + 1
      });
      continue;
    }
    
    // Padrão 2: if (method === 'GET' && pathname === '/endpoint')
    const ifMatch = line.match(/if\s*\(method\s*===\s*['"](GET|POST|PUT|DELETE|PATCH)['"]/);
    if (ifMatch) {
      // Procura pelo pathname na mesma linha ou nas próximas
      let pathLine = line;
      if (!pathLine.includes('pathname')) {
        // Procura nas próximas 3 linhas
        for (let j = 1; j <= 3 && i + j < lines.length; j++) {
          pathLine += ' ' + lines[i + j];
        }
      }
      
      // Extrai pathname
      const pathMatches = [
        pathLine.match(/pathname\s*===\s*['"]([^'"]+)['"]/),
        pathLine.match(/pathname\s*\.startsWith\(['"]([^'"]+)['"]/),
        pathLine.match(/pathname\s*\.endsWith\(['"]([^'"]+)['"]/),
        pathLine.match(/pathname\s*\.includes\(['"]([^'"]+)['"]/),
      ];
      
      for (const match of pathMatches) {
        if (match) {
          let endpoint = match[1];
          // Normaliza :id para {id}
          if (endpoint.includes(':id')) {
            endpoint = endpoint.replace(/:id/g, '{id}');
          }
          endpoints.push({
            method: ifMatch[1].toUpperCase(),
            path: endpoint,
            line: i + 1
          });
          break;
        }
      }
    }
  }
  
  // Remove duplicatas
  const unique = new Map();
  endpoints.forEach(ep => {
    const key = `${ep.method} ${ep.path}`;
    if (!unique.has(key)) {
      unique.set(key, ep);
    }
  });
  
  return Array.from(unique.values()).sort((a, b) => {
    if (a.method !== b.method) return a.method.localeCompare(b.method);
    return a.path.localeCompare(b.path);
  });
}

/**
 * Extrai endpoints mencionados nos testes
 */
function extractTestEndpoints() {
  const testFiles = [];
  
  function scanDir(dir) {
    const files = fs.readdirSync(dir);
    files.forEach(file => {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      
      if (stat.isDirectory() && !file.startsWith('.') && file !== 'node_modules') {
        scanDir(filePath);
      } else if (file.endsWith('.test.js') || file.endsWith('.test.ts')) {
        testFiles.push(filePath);
      }
    });
  }
  
  scanDir(TESTS_DIR);
  
  const endpoints = new Set();
  
  testFiles.forEach(file => {
    try {
      const content = fs.readFileSync(file, 'utf8');
      
      // Procura por padrões comuns de endpoints em testes
      const patterns = [
        /['"`](\/(?:auth|tenants|flows|config|agents|tickets|queues|departments|sessions|webhooks|rag|rpa|super-admin|onboarding|audit|system|admin|bulk-campaigns|quick-replies|templates|analytics|export|conversations|replay|segmentation|whatsapp|instagram|messenger|audio|web-scraping|qa|dev|contracts|api)[^'"`\s]*)/g,
        /pathname\s*[=:]\s*['"`](\/[^'"`]+)['"`]/g,
        /url\s*[=:]\s*['"`](\/[^'"`]+)['"`]/g,
        /fetchJson\(['"`](\/[^'"`]+)['"`]/g,
        /httpRequest\([^)]*path:\s*['"`](\/[^'"`]+)['"`]/g,
        /path:\s*['"`](\/[^'"`]+)['"`]/g,
      ];
      
      patterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          const endpoint = match[1];
          if (endpoint && endpoint.startsWith('/') && !endpoint.includes('${') && !endpoint.includes('${')) {
            // Normaliza
            let normalized = endpoint.replace(/:id/g, '{id}');
            endpoints.add(normalized);
          }
        }
      });
    } catch (error) {
      // Ignora erros de leitura
    }
  });
  
  return Array.from(endpoints).sort();
}

/**
 * Verifica se um endpoint tem teste
 */
function hasTest(endpoint, testEndpoints) {
  const epPath = endpoint.path.replace('{id}', '');
  
  return testEndpoints.some(testEp => {
    // Match exato
    if (testEp === endpoint.path) return true;
    // Match parcial (para rotas com :id)
    if (testEp.includes(epPath) || epPath.includes(testEp)) return true;
    // Match sem parâmetros
    if (testEp.replace('{id}', '') === epPath.replace('{id}', '')) return true;
    return false;
  });
}

/**
 * Analisa cobertura de testes
 */
function analyzeCoverage() {
  console.log('🔍 Analisando endpoints da API...\n');
  
  const endpoints = extractEndpoints();
  const testEndpoints = extractTestEndpoints();
  
  console.log(`📊 Total de endpoints encontrados: ${endpoints.length}`);
  console.log(`🧪 Endpoints mencionados em testes: ${testEndpoints.length}\n`);
  
  // Agrupa por método
  const byMethod = {};
  endpoints.forEach(ep => {
    if (!byMethod[ep.method]) {
      byMethod[ep.method] = [];
    }
    byMethod[ep.method].push(ep);
  });
  
  console.log('📋 Endpoints por método HTTP:\n');
  Object.keys(byMethod).sort().forEach(method => {
    console.log(`  ${method}: ${byMethod[method].length} endpoints`);
  });
  
  console.log('\n📝 Análise de cobertura:\n');
  
  const tested = [];
  const untested = [];
  
  endpoints.forEach(ep => {
    if (hasTest(ep, testEndpoints)) {
      tested.push(ep);
    } else {
      untested.push(ep);
    }
  });
  
  console.log(`✅ Endpoints com testes: ${tested.length}`);
  console.log(`❌ Endpoints sem testes: ${untested.length}`);
  console.log(`📈 Cobertura: ${((tested.length / endpoints.length) * 100).toFixed(1)}%\n`);
  
  if (untested.length > 0) {
    console.log('⚠️  Endpoints sem testes (primeiros 50):\n');
    untested.slice(0, 50).forEach(ep => {
      console.log(`  ${ep.method.padEnd(6)} ${ep.path}`);
    });
    if (untested.length > 50) {
      console.log(`  ... e mais ${untested.length - 50} endpoints`);
    }
  }
  
  // Agrupa endpoints sem testes por categoria
  const untestedByCategory = {};
  untested.forEach(ep => {
    const category = ep.path.split('/')[1] || 'other';
    if (!untestedByCategory[category]) {
      untestedByCategory[category] = [];
    }
    untestedByCategory[category].push(ep);
  });
  
  console.log('\n📊 Endpoints sem testes por categoria:\n');
  Object.keys(untestedByCategory).sort().forEach(category => {
    console.log(`  ${category}: ${untestedByCategory[category].length} endpoints`);
  });
  
  return {
    total: endpoints.length,
    tested: tested.length,
    untested: untested.length,
    coverage: (tested.length / endpoints.length) * 100,
    endpoints,
    untestedEndpoints: untested,
    untestedByCategory
  };
}

// Executa se for chamado diretamente
if (require.main === module) {
  try {
    const result = analyzeCoverage();
    
    // Salva relatório em JSON
    const reportFile = path.join(__dirname, 'endpoints-coverage-report.json');
    fs.writeFileSync(reportFile, JSON.stringify(result, null, 2));
    console.log(`\n📄 Relatório completo salvo em: ${reportFile}`);
    
    process.exit(result.untested > 0 ? 1 : 0);
  } catch (error) {
    console.error('❌ Erro ao analisar endpoints:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

module.exports = { analyzeCoverage, extractEndpoints, extractTestEndpoints };
