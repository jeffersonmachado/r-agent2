const path = require('path');
const fs = require('fs');

async function handleConfigContractsRoutes({ req, res, method, pathname, deps }) {
  const { sendJson, logger, setCorsHeaders } = deps;

  if (method !== 'GET') {
    return false;
  }

  if (pathname !== '/contracts/rag/question-generation.rules.json' && pathname !== '/api/data/rag_question_generation_rules.json') {
    return false;
  }

  try {
    const contractsDir = path.join(__dirname, '..', '..', '..', 'contracts');
    const rulesFile = path.join(contractsDir, 'rag', 'question-generation.rules.json');

    if (!fs.existsSync(rulesFile)) {
      sendJson(res, 404, { error: 'not_found', message: 'Arquivo de regras não encontrado' });
      return true;
    }

    const rulesContent = fs.readFileSync(rulesFile, 'utf8');
    const rulesData = JSON.parse(rulesContent);

    setCorsHeaders(res);
    sendJson(res, 200, rulesData);
  } catch (err) {
    logger.error('Erro ao servir regras de geração de perguntas:', err);
    sendJson(res, 500, {
      error: 'Erro ao ler regras',
      message: err.message || 'Erro desconhecido',
    });
  }

  return true;
}

module.exports = { handleConfigContractsRoutes };
