# Sistema de Resolução de Dependências RPA

## Visão Geral

O sistema de resolução de dependências RPA garante que **nenhuma gravação RPA seja criada ou executada sem que TODAS as dependências necessárias estejam previamente satisfeitas**, de forma automática, determinística e auditável.

## Arquitetura

### Componentes Principais

1. **`engine/rpaDependencyResolver.js`** - Módulo central de resolução de dependências
2. **`engine/flowToRpaConverter.js`** - Conversor de fluxo para gravação RPA
3. **`api/services/rpaFlowPipelineService.js`** - Serviço que orquestra o pipeline completo
4. **`frontend/src/components/RpaDependencyResolver.jsx`** - Componente UI para exibição e confirmação

### Pipeline Obrigatório

O pipeline segue esta sequência fixa:

1. **Fluxo** (IA ou humano)
2. **Análise de dependências** - Identifica todas as dependências necessárias
3. **Execução de seeds RPA faltantes** (se necessário e autorizado)
4. **Validação do estado final do sistema**
5. **Conversão Fluxo → Gravação RPA de teste**
6. **Preview dos passos**
7. **Confirmação do usuário**
8. **Salvamento da gravação**

## Tipos de Dependências Cobertas

### 1. Cadastros Estruturais

- **Departamentos**: Verifica se departamentos referenciados existem
- **Filas**: Verifica se filas usadas em handoffs existem
- **Agentes**: Verifica se agentes referenciados existem
- **Usuários**: Verifica usuários de teste necessários
- **Papéis/Permissões**: Valida permissões necessárias

### 2. Dependências de Fluxo

- **Fluxos referenciados**: Verifica se fluxos chamados existem
- **Versões**: Valida versões de fluxos
- **Nós obrigatórios**: Garante que fluxo tem start e end

### 3. Dependências de RAG

- **Bases de conhecimento**: Verifica se bases RAG configuradas existem
- **Documentos**: Verifica se há documentos mínimos nas bases
- **Índices vetoriais**: Valida se índices estão disponíveis
- **Serviço RAG**: Verifica se serviço RAG está disponível

### 4. Dependências de Configuração

- **Integrações**: Verifica se integrações necessárias estão habilitadas
- **Flags de feature**: Valida flags de funcionalidades
- **Modelos de IA**: Verifica se modelos configurados estão disponíveis

### 5. Dependências de Teste

- **Usuário de teste**: Verifica se há usuário de teste válido
- **Ambiente autenticado**: Valida ambiente de teste
- **Permissões**: Verifica permissões suficientes para execução

## Mapeamento Dependência → Ação RPA

Quando uma dependência não existe, o sistema mapeia para um seed RPA específico:

| Dependência | Seed RPA |
|------------|----------|
| Departamento faltante | `Seed Plataforma - Criar Departamento` |
| Fila faltante | `Seed Plataforma - Criar Fila` |
| Agente faltante | `Seed Plataforma - Criar Agente` |
| Base RAG faltante | `Seed RAG - Criar Base` |
| Documento RAG faltante | `Seed RAG - Inserir Documento` |
| Usuário de teste faltante | `Seed Plataforma - Criar Usuário de Teste` |

**Importante**: Nenhuma dependência é criada "por código direto". Tudo é feito via RPA seed, mantendo o mesmo comportamento de usuário real.

## Uso da API

### 1. Resolver Dependências

```bash
POST /api/flows/:flowId/resolve-dependencies
```

Retorna análise completa de dependências:

```json
{
  "allSatisfied": false,
  "dependencies": [
    {
      "type": "queue",
      "identifier": "suporte",
      "exists": true,
      "existingData": {...},
      "rpaSeedName": null,
      "metadata": {...}
    },
    {
      "type": "rag_base",
      "identifier": "atendimento",
      "exists": false,
      "rpaSeedName": "Seed RAG - Criar Base",
      "metadata": {...}
    }
  ],
  "missingDependencies": [...],
  "requiredSeeds": ["Seed RAG - Criar Base"],
  "snapshot": {...}
}
```

### 2. Preview RPA

```bash
POST /api/flows/:flowId/preview-rpa
```

Retorna preview da gravação RPA sem executar:

```json
{
  "dependencyResolution": {...},
  "recordingPreview": {
    "id": "rpa-...",
    "name": "Teste RPA - Nome do Fluxo",
    "stepsCount": 15,
    "steps": [...],
    "metadata": {...}
  }
}
```

### 3. Gerar Gravação RPA

```bash
POST /api/flows/:flowId/generate-rpa
Body: {
  "autoExecuteSeeds": false,
  "saveRecording": true
}
```

Executa o pipeline completo e retorna resultado:

```json
{
  "success": true,
  "flow": {...},
  "dependencyResolution": {...},
  "executedSeeds": [],
  "recording": {...},
  "snapshot": {...},
  "errors": [],
  "warnings": []
}
```

## Uso no Frontend

### Componente RpaDependencyResolver

```jsx
import { RpaDependencyResolver } from '../components/RpaDependencyResolver';

function FlowPage() {
  const [showResolver, setShowResolver] = useState(false);

  return (
    <>
      <Button onClick={() => setShowResolver(true)}>
        Gerar Gravação RPA
      </Button>

      {showResolver && (
        <RpaDependencyResolver
          flowId={flow.id}
          autoExecuteSeeds={false}
          onConfirm={(result) => {
            console.log('Gravação criada:', result);
            setShowResolver(false);
          }}
          onCancel={() => setShowResolver(false)}
        />
      )}
    </>
  );
}
```

## Integração com Geração por IA

O sistema pode ser integrado no fluxo de geração por IA:

```javascript
// Após gerar fluxo por IA
const generatedFlow = await generateFlowFromDescription(description, options);

// Resolve dependências automaticamente
const resolution = await rpaDependencyResolver.resolveDependencies(generatedFlow, tenantId);

// Se houver dependências faltantes, exibe UI para confirmação
if (!resolution.allSatisfied) {
  // Mostra componente RpaDependencyResolver
  // Usuário confirma execução de seeds
}

// Gera gravação RPA
const pipelineResult = await executeRpaFlowPipeline(generatedFlow, {
  autoExecuteSeeds: userConfirmed,
  saveRecording: true,
});
```

## Metadata da Gravação RPA

Toda gravação RPA gerada inclui metadata completo:

```json
{
  "metadata": {
    "generated": true,
    "generatedAt": "2026-01-02T...",
    "generatedBy": "flow-to-rpa-converter",
    "dependenciasResolvidas": true,
    "seedsExecutados": ["Seed Plataforma - Criar Fila"],
    "snapshot": {
      "timestamp": "2026-01-02T...",
      "departments": {...},
      "queues": {...},
      "agents": {...},
      "rag": {...}
    },
    "path": [...],
    "nodeCount": 10,
    "stepsCount": 15
  }
}
```

## Regras de Segurança

1. **IA nunca executa ações reais** - IA apenas sugere fluxo
2. **Resolver decide dependências** - Sistema determina o que falta
3. **RPA executa seeds e testes** - Apenas RPA executa ações
4. **Nenhuma gravação RPA entra em produção** - Apenas para testes
5. **Tudo reexecutável** - Pode ser executado do zero em outro ambiente

## Objetivo Final Validável

Ao final da implementação, é possível:

✅ Gerar um fluxo por IA  
✅ Sistema detecta TODAS as dependências (cadastros, RAG, configs)  
✅ Criar automaticamente tudo o que faltar via RPA  
✅ Gerar uma gravação RPA de teste do fluxo  
✅ Executar o replay em qualquer ambiente vazio  
✅ Garantir que o fluxo funciona de ponta a ponta  
✅ Usar isso como teste de regressão permanente  

## Exemplo Completo

```javascript
// 1. Gerar fluxo por IA
const flow = await generateFlowFromDescription(
  "Fluxo de atendimento que cria ticket na fila de suporte"
);

// 2. Resolver dependências
const resolution = await rpaDependencyResolver.resolveDependencies(flow, tenantId);

// 3. Executar seeds se necessário
if (!resolution.allSatisfied && autoExecute) {
  await executeRequiredSeeds(resolution.requiredSeeds, tenantId);
}

// 4. Gerar gravação RPA
const result = await executeRpaFlowPipeline(flow, {
  autoExecuteSeeds: true,
  saveRecording: true,
});

// 5. Executar replay
await rpaService.executeRecording(result.recording.id, {
  headless: false,
  slowMo: 500,
});
```

## Resultado

Nenhum fluxo, seja humano ou gerado por IA, entra no sistema sem:

- ✅ Ambiente preparado
- ✅ Dados consistentes
- ✅ RAG funcional
- ✅ Teste executável real

O RPA se torna:

- ✅ Seed oficial do sistema
- ✅ Motor de teste real
- ✅ Garantia de integridade da plataforma

