// Dev Management Routes - Gerenciamento de Contratos, Prompts, Nodes e Documentos

async function handleDevManagementRoutes({
  req, res, method, pathname,
  deps: {
    requireAuth, sendJson, badRequest, hasJsonContentType, parseJsonBody, isSuperAdmin, logAction, logger,
    path, fs,
  }
}) {
  // GET /dev/files - Lista arquivos disponíveis (contratos, prompts)
  // Apenas super-admin pode acessar
  if (method === 'GET' && pathname === '/dev/files') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    // Verifica se é super-admin
    const isSuperAdminUser = isSuperAdmin(req.agent);
    if (!isSuperAdminUser) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas super-admins podem acessar arquivos de desenvolvimento' });
      return true;
    }

    try {
      const projectRoot = path.join(__dirname, '..');
      const contractsDir = path.join(projectRoot, 'contracts');
      const promptsDir = path.join(projectRoot, 'prompts');
      const nodesDir = path.join(projectRoot, 'api/data/rag/chatbot');
      
      const files = {
        contracts: [],
        prompts: [],
        nodes: [],
        documents: {}, // Documentos organizados por categoria
      };

      // Lista contratos
      if (fs.existsSync(contractsDir)) {
        const listFiles = (dir, basePath = '') => {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.join(basePath, entry.name).replace(/\\/g, '/');
            
            if (entry.isDirectory()) {
              listFiles(fullPath, relativePath);
            } else if (entry.isFile() && (entry.name.endsWith('.json') || entry.name.endsWith('.md'))) {
              files.contracts.push({
                path: relativePath,
                name: entry.name,
                type: entry.name.endsWith('.json') ? 'json' : 'markdown',
                size: fs.statSync(fullPath).size,
              });
            }
          }
        };
        listFiles(contractsDir);
      }

      // Lista prompts
      if (fs.existsSync(promptsDir)) {
        const entries = fs.readdirSync(promptsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && entry.name.endsWith('.md')) {
            const fullPath = path.join(promptsDir, entry.name);
            files.prompts.push({
              path: entry.name,
              name: entry.name,
              type: 'markdown',
              size: fs.statSync(fullPath).size,
            });
          }
        }
      }

      // Lista arquivos de nós (nodes, schema, rules, errors)
      if (fs.existsSync(nodesDir)) {
        const listNodeFiles = (dir, basePath = '') => {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.join(basePath, entry.name).replace(/\\/g, '/');
            
            if (entry.isDirectory()) {
              // Inclui subdiretórios: nodes/, schema/, rules/, known_errors/
              if (entry.name === 'nodes' || entry.name === 'schema' || entry.name === 'rules' || entry.name === 'known_errors') {
                listNodeFiles(fullPath, relativePath);
              }
            } else if (entry.isFile() && entry.name.endsWith('.json')) {
              files.nodes.push({
                path: relativePath,
                name: entry.name,
                type: 'json',
                size: fs.statSync(fullPath).size,
              });
            }
          }
        };
        listNodeFiles(nodesDir);
      }

      // Lista documentos organizados do diretório "dev Documentos"
      const documentsDir = path.join(projectRoot, 'dev Documentos');
      if (fs.existsSync(documentsDir)) {
        const categories = fs.readdirSync(documentsDir, { withFileTypes: true })
          .filter(entry => entry.isDirectory() && entry.name.match(/^\d{2}_/))
          .map(entry => entry.name)
          .sort();
        
        for (const category of categories) {
          const categoryDir = path.join(documentsDir, category);
          const categoryFiles = [];
          
          const listCategoryFiles = (dir, basePath = '') => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
              const fullPath = path.join(dir, entry.name);
              const relativePath = basePath ? path.join(basePath, entry.name).replace(/\\/g, '/') : entry.name;
              
              if (entry.isDirectory()) {
                listCategoryFiles(fullPath, relativePath);
              } else if (entry.isFile() && entry.name.endsWith('.md')) {
                const stats = fs.statSync(fullPath);
                categoryFiles.push({
                  path: relativePath,
                  name: entry.name,
                  type: 'markdown',
                  size: stats.size,
                  modified: stats.mtime.toISOString(),
                });
              }
            }
          };
          
          listCategoryFiles(categoryDir);
          if (categoryFiles.length > 0) {
            files.documents[category] = categoryFiles;
          }
        }
      }

      sendJson(res, 200, files);
    } catch (err) {
      logger.error('[Dev] Erro ao listar arquivos:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message || 'Erro ao listar arquivos' });
    }
    return true;
  }

  // GET /dev/files/:type/:path - Lê conteúdo de um arquivo
  // Apenas super-admin pode acessar
  if (method === 'GET' && pathname.startsWith('/dev/files/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    // Verifica se é super-admin
    const isSuperAdminUser = isSuperAdmin(req.agent);
    if (!isSuperAdminUser) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas super-admins podem ler arquivos de desenvolvimento' });
      return true;
    }

    try {
      const parts = pathname.split('/').filter(p => p);
      // parts: ['dev', 'files', 'type', 'path...']
      if (parts.length < 4) {
        badRequest(res, 'Caminho inválido. Use /dev/files/:type/:path');
        return true;
      }

      const type = parts[2]; // 'contracts', 'prompts', 'nodes' ou 'documents'
      const filePath = parts.slice(3).join('/'); // resto do caminho

      if (type !== 'contracts' && type !== 'prompts' && type !== 'nodes' && type !== 'documents') {
        badRequest(res, 'Tipo inválido. Use "contracts", "prompts", "nodes" ou "documents"');
        return true;
      }

      const projectRoot = path.join(__dirname, '..');
      let baseDir;
      if (type === 'contracts') {
        baseDir = path.join(projectRoot, 'contracts');
      } else if (type === 'prompts') {
        baseDir = path.join(projectRoot, 'prompts');
      } else if (type === 'nodes') {
        baseDir = path.join(projectRoot, 'api/data/rag/chatbot');
      } else if (type === 'documents') {
        // Para documents, o caminho é: categoria/arquivo.md
        const categoryPath = parts[3]; // categoria (ex: 01_Analises)
        const fileName = parts.slice(4).join('/'); // nome do arquivo
        baseDir = path.join(projectRoot, 'dev Documentos', categoryPath);
        filePath = fileName; // Atualiza filePath para o nome do arquivo
      }
      
      const fullPath = path.join(baseDir, filePath);
      
      // Validação de segurança: garante que o caminho está dentro do diretório base
      const normalizedPath = path.normalize(fullPath);
      const normalizedBase = path.normalize(baseDir);
      if (!normalizedPath.startsWith(normalizedBase)) {
        badRequest(res, 'Caminho inválido: tentativa de acesso fora do diretório permitido');
        return true;
      }

      if (!fs.existsSync(normalizedPath)) {
        sendJson(res, 404, { error: 'not_found', message: 'Arquivo não encontrado' });
        return true;
      }

      const content = fs.readFileSync(normalizedPath, 'utf8');
      const stats = fs.statSync(normalizedPath);
      
      sendJson(res, 200, {
        path: filePath,
        type: type,
        content: content,
        size: stats.size,
        modified: stats.mtime.toISOString(),
      });
    } catch (err) {
      logger.error('[Dev] Erro ao ler arquivo:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message || 'Erro ao ler arquivo' });
    }
    return true;
  }

  // PUT /dev/files/:type/:path - Salva conteúdo de um arquivo
  // Apenas super-admin pode acessar
  if (method === 'PUT' && pathname.startsWith('/dev/files/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    // Verifica se é super-admin
    const isSuperAdminUser = isSuperAdmin(req.agent);
    if (!isSuperAdminUser) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas super-admins podem editar arquivos de desenvolvimento' });
      return true;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const parts = pathname.split('/').filter(p => p);
      if (parts.length < 4) {
        badRequest(res, 'Caminho inválido. Use /dev/files/:type/:path');
        return true;
      }

      const type = parts[2];
      const filePath = parts.slice(3).join('/');

      if (type !== 'contracts' && type !== 'prompts' && type !== 'nodes' && type !== 'documents') {
        badRequest(res, 'Tipo inválido. Use "contracts", "prompts", "nodes" ou "documents"');
        return true;
      }

      const body = await parseJsonBody(req);
      if (!body.content || typeof body.content !== 'string') {
        badRequest(res, 'Campo "content" (string) é obrigatório');
        return true;
      }

      const projectRoot = path.join(__dirname, '..');
      let baseDir;
      let filePathToUse = filePath;
      
      if (type === 'contracts') {
        baseDir = path.join(projectRoot, 'contracts');
      } else if (type === 'prompts') {
        baseDir = path.join(projectRoot, 'prompts');
      } else if (type === 'nodes') {
        baseDir = path.join(projectRoot, 'api/data/rag/chatbot');
      } else if (type === 'documents') {
        // Para documents, o caminho é: categoria/arquivo.md
        const categoryPath = parts[3]; // categoria (ex: 01_Analises)
        const fileName = parts.slice(4).join('/'); // nome do arquivo
        baseDir = path.join(projectRoot, 'dev Documentos', categoryPath);
        filePathToUse = fileName; // Atualiza filePath para o nome do arquivo
      }
      
      const fullPath = path.join(baseDir, filePathToUse);
      
      // Validação de segurança
      const normalizedPath = path.normalize(fullPath);
      const normalizedBase = path.normalize(baseDir);
      if (!normalizedPath.startsWith(normalizedBase)) {
        badRequest(res, 'Caminho inválido: tentativa de acesso fora do diretório permitido');
        return true;
      }

      // Cria diretório se não existir
      const dir = path.dirname(normalizedPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Valida JSON se for arquivo JSON
      if (normalizedPath.endsWith('.json')) {
        try {
          JSON.parse(body.content);
        } catch (jsonErr) {
          badRequest(res, `JSON inválido: ${jsonErr.message}`);
          return true;
        }
      }

      // Salva arquivo
      fs.writeFileSync(normalizedPath, body.content, 'utf8');
      
      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'update',
        resource: 'dev_file',
        resourceId: `${type}/${filePath}`,
        details: { type, path: filePath },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      const stats = fs.statSync(normalizedPath);
      sendJson(res, 200, {
        success: true,
        path: filePath,
        type: type,
        size: stats.size,
        modified: stats.mtime.toISOString(),
      });
    } catch (err) {
      logger.error('[Dev] Erro ao salvar arquivo:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message || 'Erro ao salvar arquivo' });
    }
    return true;
  }

  return false;
}

module.exports = { handleDevManagementRoutes };
