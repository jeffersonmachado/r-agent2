# Documentação de Testes - Sistema de Geração e Testes RPA

## 📋 Índice

1. [Visão Geral](#visão-geral)
2. [Quando Criar Testes RPA](#quando-criar-testes-rpa)
3. [Diferença entre RAG e Scraping](#diferença-entre-rag-e-scraping)
4. [Política de Falha](#política-de-falha)
5. [Papel do RPA no QA](#papel-do-rpa-no-qa)
6. [Geração de Fluxos por IA](#geração-de-fluxos-por-ia)
7. [Geração de Testes RPA por IA](#geração-de-testes-rpa-por-ia)
8. [Execução de Testes](#execução-de-testes)
9. [Integração com Pipeline](#integração-com-pipeline)

---

## Visão Geral

O sistema possui um **sistema completo de geração de fluxos e testes RPA por IA**, com controle explícito de fontes de conhecimento e integração obrigatória com QA.

### Componentes Principais

- **Contratos Formais**: `contracts/generation.interface.json` e `contracts/qa/qa.contract.json`
- **Validação de Contratos**: Backend valida payloads antes de executar
- **Controle Explícito**: IA nunca decide usar RAG ou scraping - tudo vem do formulário
- **Testes RPA**: Mecanismo obrigatório de teste (não funcionalidade do produto)

---

## Quando Criar Testes RPA

### Obrigatório para:

1. **Fluxos de Chatbot**
   - Todo fluxo funcional deve possuir ao menos um teste RPA
   - Fluxos gerados por IA DEVEM gerar teste RPA quando a opção estiver marcada

2. **Componentes Frontend**
   - Interfaces críticas devem ter testes RPA
   - Fluxos de usuário principais

### Opcional para:

- Fluxos de teste/protótipo
- Fluxos descontinuados
- Componentes internos não expostos

---

## Diferença entre RAG e Scraping

### RAG (Retrieval-Augmented Generation)

**O que é:**
- Conhecimento interno do sistema
- Base de dados indexada com embeddings
- Consulta via serviço Python FastAPI

**Fontes disponíveis:**
- `flows`: Fluxos existentes no sistema
- `qa`: Base de conhecimento de QA
- `docs`: Documentação do projeto

**Quando usar:**
- Quando você quer que a IA use conhecimento já existente no sistema
- Para manter consistência com padrões estabelecidos
- Para reutilizar soluções já validadas

**Como usar:**
1. Marque checkbox "Usar conhecimento interno (RAG)"
2. Selecione as fontes desejadas (flows, qa, docs)
3. A IA consultará essas fontes antes de gerar o fluxo

### Scraping (Raspagem de Sites)

**O que é:**
- Coleta de conteúdo de URLs externas
- Extração de texto e metadados
- Processamento controlado e auditado

**Quando usar:**
- Quando você precisa de conhecimento externo
- Para referenciar documentação externa
- Para incorporar padrões de outros sistemas

**Como usar:**
1. Marque checkbox "Usar fontes externas (Raspagem de sites)"
2. Adicione URLs a serem raspadas
3. ⚠️ **Requer aprovação/auditoria** - será registrado no log

**Restrições:**
- Raspagem requer aprovação explícita
- Todas as URLs raspadas são auditadas
- Conteúdo raspado não é indexado automaticamente durante geração

---

## Política de Falha

### Regras de Bloqueio

1. **Falha em Teste RPA**
   - Por padrão, **bloqueia pipeline** (conforme `qa.contract.json`)
   - Pode ser configurado para não bloquear (política explícita)

2. **Validação de Contrato**
   - Payloads que não seguem `generation.interface.json` são rejeitados
   - Backend retorna erro 400 com detalhes

3. **Validação de Fluxo**
   - Fluxos gerados são validados pela engine
   - Avisos não bloqueiam, mas são registrados

### Exit Codes

- `0`: Todos os testes passaram
- `1`: Um ou mais testes falharam
- `2`: Erro na execução do script

---

## Papel do RPA no QA

### RPA é Exclusivamente um Mecanismo de Teste

**IMPORTANTE:**
- RPA **NÃO é funcionalidade do produto final**
- RPA é usado apenas para **validar fluxos e interfaces**
- Testes RPA são executados em **ambiente controlado**

### Integração com QA

1. **Tipos de Teste Obrigatórios** (conforme `qa.contract.json`):
   - `unit`: Testes unitários
   - `integration`: Testes de integração
   - `e2e`: Testes end-to-end
   - `rpa`: Testes RPA

2. **Componentes Obrigatórios**:
   - `frontend`: Interfaces frontend
   - `chatbot-flows`: Fluxos de chatbot

3. **Execução no Pipeline**:
   ```bash
   npm run test:rpa
   ```

---

## Geração de Fluxos por IA

### Formulário de Geração

O formulário (`FlowAndRpaTestGeneratorDialog`) permite:

1. **Dados do Fluxo**:
   - Nome do fluxo
   - Descrição funcional

2. **Fonte de Conhecimento da IA**:
   - Checkbox: Usar conhecimento interno (RAG)
     - Seleção de fontes: Fluxos, QA, Documentação
   - Checkbox: Usar fontes externas (Raspagem de sites)
     - Campo para múltiplas URLs

3. **Geração de Teste RPA**:
   - Checkbox: Gerar teste RPA automaticamente
   - Seleção de modo: Inferido pela IA, Gravação assistida, Híbrido

### Pipeline de Geração

1. **Validação de Contrato**
   - Backend valida payload contra `generation.interface.json`
   - Rejeita se não seguir o contrato

2. **Resolução de Contexto**
   - Se `useRag = true`: Carrega base interna via `ragService`
   - Se `useWebScraping = true`: Executa coleta controlada via `webScrapingService`

3. **Execução da IA**
   - IA recebe descrição + contexto resolvido
   - **Escopo restrito ao contrato** - não pode acessar nada fora do declarado

4. **Geração**
   - FlowDefinition
   - Arquivo de teste RPA (JSON) - se solicitado

5. **Salvamento**
   - Teste RPA salvo em `/tests/rpa/flows`
   - Metadata de geração registrada (fonte, data, modo)

### Regra Fundamental

> **A IA NUNCA decide:**
> - Usar RAG
> - Fazer raspagem
> - Gerar RPA
>
> **Tudo isso é explicitamente declarado pelo usuário no formulário** e validado por contrato.

---

## Geração de Testes RPA por IA

### Modos de Geração

1. **Inferido pela IA** (`infer`)
   - IA analisa o fluxo e infere um caminho válido
   - Gera passos e asserts automaticamente

2. **Gravação assistida** (`record`)
   - Usuário grava ações manualmente
   - IA complementa com asserts e validações

3. **Híbrido** (`hybrid`)
   - Combina inferência e gravação
   - IA sugere passos, usuário valida

### Estrutura de Teste RPA

```json
{
  "id": "test-id",
  "flowId": "flow-id",
  "steps": [
    {
      "type": "navigate",
      "url": "http://localhost:5173",
      "description": "Navegar para página inicial"
    },
    {
      "type": "click",
      "selector": "button.start-chat",
      "description": "Iniciar chat"
    }
  ],
  "asserts": [
    {
      "type": "element_exists",
      "selector": ".chat-container",
      "description": "Chat deve estar visível"
    }
  ],
  "metadata": {
    "generatedAt": "2025-01-01T00:00:00.000Z",
    "rpaMode": "infer",
    "pathTaken": []
  }
}
```

---

## Execução de Testes

### Executar Todos os Testes

```bash
npm run test:rpa
```

### Executar Teste Específico

```bash
node tests/rpa/rpaTestRunner.js tests/rpa/flows/test-name.json
```

### Relatórios

Relatórios são gerados em `/tests/rpa/reports/`:
- `rpa-report-{timestamp}.json`: Relatório com timestamp
- `rpa-report-latest.json`: Último relatório gerado

### Estrutura de Relatório

```json
{
  "timestamp": "2025-01-01T00:00:00.000Z",
  "summary": {
    "total": 5,
    "passed": 4,
    "failed": 1,
    "success": false
  },
  "tests": [
    {
      "name": "test-name",
      "success": true,
      "error": null
    }
  ]
}
```

---

## Integração com Pipeline

### CI/CD

Adicione ao seu pipeline (ex: `.github/workflows/ci.yml`):

```yaml
- name: Run RPA Tests
  run: npm run test:rpa
```

### Regra de Bloqueio

- **Falha em RPA → bloqueia pipeline** (salvo política explícita)
- Exit code ≠ 0 em caso de falha
- Relatórios disponíveis como artefatos

### Política Explícita

Para não bloquear pipeline em falha de RPA, configure em `qa.contract.json`:

```json
{
  "qa": {
    "rpa": {
      "execution": {
        "blockingOnFailure": false
      }
    }
  }
}
```

---

## Estrutura de Pastas

```
/tests
  /unit
  /integration
  /e2e
  /rpa
    /flows          # Testes RPA gerados
    /recordings     # Gravações de ações
    /replays        # Replays de execução
    /reports        # Relatórios de execução
```

**Regra**: Nenhuma feature RPA é considerada existente se essa estrutura não existir.

---

## Contratos e Validação

### Contratos Formais

1. **`contracts/generation.interface.json`**
   - Interface pública de geração
   - Define inputs e outputs
   - Restrições e regras

2. **`contracts/qa/qa.contract.json`**
   - Tipos de teste obrigatórios
   - Configurações de RPA
   - Políticas de execução

### Validação

- Backend valida payloads contra contratos
- Rejeita requisições inválidas
- Retorna erros claros

---

## Troubleshooting

### Erro: "Validação de contrato falhou"

**Causa**: Payload não segue `generation.interface.json`

**Solução**: Verifique se todos os campos obrigatórios estão presentes e com tipos corretos.

### Erro: "Nenhum teste RPA encontrado"

**Causa**: Diretório `/tests/rpa/flows` está vazio

**Solução**: Gere testes RPA usando o formulário de geração.

### Erro: "RAG service timeout"

**Causa**: Serviço RAG não está disponível ou demorou muito

**Solução**: Verifique se o serviço Python RAG está rodando e acessível.

### Erro: "URL inválida" no scraping

**Causa**: URL não segue formato HTTP/HTTPS válido

**Solução**: Verifique se a URL começa com `http://` ou `https://`.

---

## Referências

- `PROJECT_RULES.md`: Regras do projeto, incluindo seção de Testes RPA
- `contracts/generation.interface.json`: Contrato de geração
- `contracts/qa/qa.contract.json`: Contrato de QA
- `api/utils/contractValidator.js`: Validador de contratos
- `tools/rpa/run-all.js`: Script de execução de testes

---

**Última atualização**: 2025-01-01

