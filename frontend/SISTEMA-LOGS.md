# Sistema de Logs e Debug

Este documento explica o sistema de logging implementado no frontend para facilitar o debug e monitoramento.

## Visão Geral

O sistema de logs foi criado para:
- **Debugar problemas** como o fluxo não sendo criado
- **Monitorar operações** da aplicação
- **Rastrear erros** e identificar onde ocorrem
- **Entender o fluxo de dados** entre componentes

## Como Usar

### 1. Visualizar Logs

1. Clique no botão **"📋 Logs"** na barra de ferramentas (canto superior direito)
2. Uma janela modal será aberta mostrando todos os logs
3. Os logs são atualizados automaticamente a cada 500ms

### 2. Filtrar Logs

Na janela de logs, você pode:
- **Filtrar por nível**: DEBUG, INFO, WARN, ERROR
- **Ver todos os logs**: Clique em "Todos"
- **Limpar logs**: Clique em "Limpar"

### 3. Ajustar Nível de Log

Na janela de logs, você pode alterar o nível de log atual:
- **DEBUG (0)**: Mostra todos os logs, incluindo detalhes técnicos
- **INFO (1)**: Mostra informações gerais (padrão em desenvolvimento)
- **WARN (2)**: Mostra apenas avisos e erros
- **ERROR (3)**: Mostra apenas erros

O nível escolhido é salvo no `localStorage` e persiste entre sessões.

## Níveis de Log

### DEBUG (0)
Informações detalhadas para debugging técnico:
- Dados completos de requisições HTTP
- Estados internos de componentes
- Conversões de dados

### INFO (1)
Informações gerais sobre operações:
- Fluxo criado/carregado
- Operações bem-sucedidas
- Estado da aplicação

### WARN (2)
Avisos sobre situações anômalas:
- Validações que falharam
- Dados faltando
- Comportamentos inesperados

### ERROR (3)
Erros que impedem operações:
- Falhas de requisições HTTP
- Exceções não tratadas
- Problemas críticos

## Onde os Logs São Gerados

### API Client (`api/client.js`)
- Todas as requisições HTTP
- Respostas e erros
- Timeouts

### API Flows (`api/flows.js`)
- Criação de fluxos
- Atualização de fluxos
- Validação e simulação

### Editor Store (`state/editorStore.jsx`)
- Carregamento de fluxos
- Salvamento de fluxos
- Validação e simulação

### Flow Editor Page (`pages/FlowEditorPage.jsx`)
- Seleção de templates
- Criação de fluxos a partir de templates
- Erros de criação

### Flow Template Selector (`components/FlowTemplateSelector.jsx`)
- Cliques no botão "Criar Fluxo"
- Seleção de templates
- Criação de fluxos

## Debugando o Problema de Criação de Fluxo

Para debugar por que o fluxo não está sendo criado:

1. **Abra a janela de logs** (botão 📋 Logs)
2. **Configure o nível para DEBUG** (botão DEBUG)
3. **Clique em "Criar Fluxo"** e selecione um template
4. **Observe os logs** na seguinte ordem:
   - `[INFO] Botão Criar Fluxo clicado` - Confirma que o botão foi clicado
   - `[DEBUG] Criando fluxo do template` - Template selecionado
   - `[INFO] Fluxo criado do template` - Fluxo criado localmente
   - `[INFO] Template selecionado` - Callback chamado
   - `[INFO] Salvando fluxo no backend...` - Tentativa de salvar
   - `[INFO] Fluxo criado com sucesso` - Sucesso OU
   - `[ERROR] Erro ao criar fluxo` - Erro (veja detalhes)

5. **Verifique os erros**:
   - Se houver erro HTTP, veja o status code e mensagem
   - Se houver erro de rede, verifique se a API está rodando
   - Se houver erro de validação, veja os detalhes no log

## Exemplo de Uso Programático

```javascript
import logger from './utils/logger';

// Log de debug
logger.debug('Processando dados', { userId: 123, action: 'create' });

// Log de informação
logger.info('Operação concluída', { result: 'success' });

// Log de aviso
logger.warn('Dados incompletos', { missingFields: ['email'] });

// Log de erro
logger.error('Falha na operação', error);

// Alterar nível de log
logger.setLevel(logger.LEVELS.DEBUG);

// Obter histórico
const logs = logger.getHistory();

// Limpar histórico
logger.clearHistory();
```

## Configuração via Variável de Ambiente

Você pode configurar o nível de log padrão via variável de ambiente:

```bash
# .env ou .env.local
VITE_LOG_LEVEL=0  # DEBUG
VITE_LOG_LEVEL=1  # INFO (padrão)
VITE_LOG_LEVEL=2  # WARN
VITE_LOG_LEVEL=3  # ERROR
VITE_LOG_LEVEL=4  # NONE (desabilita logs)
```

## Limitações

- O histórico de logs é limitado a **1000 entradas** (mais antigas são removidas)
- Logs são armazenados apenas em memória (não persistem após recarregar a página)
- Logs não são enviados para servidor (apenas local)

## Próximos Passos

Para melhorar o sistema de logs:
- Adicionar exportação de logs para arquivo
- Enviar logs críticos para servidor
- Adicionar filtros por componente/módulo
- Adicionar busca nos logs

