# Análise de Documentos e Aprendizado Adaptativo

## Visão Geral

O sistema de **Análise de Documentos** e **Aprendizado Adaptativo** trabalha em conjunto para melhorar continuamente a acurácia do RAG (Retrieval-Augmented Generation). O processo analisa documentos indexados, gera perguntas de teste, valida essas perguntas com IA, testa-as no sistema RAG e, com base nos resultados, atualiza automaticamente sinônimos, padrões de perguntas e configurações.

## Prevenção de Duplicatas

O sistema implementa múltiplas camadas de proteção contra resultados duplicados:

1. **Chave Única por Resultado**: Cada resultado é identificado por `documentId + question normalizada`
2. **Verificação em Tempo Real**: Antes de adicionar um resultado, verifica se já existe um idêntico
3. **Remoção Final**: Passa por todos os resultados finais removendo qualquer duplicata restante
4. **Logs Detalhados**: Registra quando duplicatas são detectadas e removidas

**Logs de Debug:**
- `⚠️ [ANÁLISE] Resultado duplicado detectado e ignorado` - Quando uma duplicata é detectada
- `➕ [ANÁLISE] Adicionando resultado único` - Quando um resultado único é adicionado
- `📊 [ANÁLISE] Resumo final da análise` - Inclui contagem de duplicatas removidas

## Fluxo Completo do Processo

### 1. Inicialização da Análise

```
Usuário clica em "Analisar Documentos"
    ↓
Sistema filtra documentos indexados e ativos
    ↓
Limita a 10 documentos para análise
    ↓
Calcula estimativa de perguntas
```

**Logs de Debug:**
- `🔍 [ANÁLISE] Iniciando análise de documentos` - Início do processo
- `📋 [ANÁLISE] Documentos disponíveis` - Total de documentos na lista
- `✅ [ANÁLISE] Documentos filtrados` - Documentos indexados e ativos
- `📊 [ANÁLISE] Documentos selecionados para análise` - Documentos que serão analisados
- `🔄 [ANÁLISE] Iniciando loop de análise de documentos` - Início do loop principal
- `📄 [ANÁLISE] Processando documento` - Detalhes do documento atual

### 2. Geração e Validação de Perguntas

Para cada documento:

```
Extrai título e conteúdo (primeiros 500 caracteres)
    ↓
Gera perguntas automaticamente baseadas no conteúdo
    ↓
Valida perguntas usando IA (filtra perguntas inválidas)
    ↓
Limita a 3 perguntas válidas por documento
```

**Geração de Perguntas:**
- O sistema usa heurísticas para gerar perguntas baseadas em:
  - Título do documento
  - Conteúdo (primeiros 500 caracteres)
  - Palavras-chave identificadas
  - Estrutura do texto

**Validação com IA:**
- Usa o endpoint `/api/ai/generate` com prompt especializado
- Filtra perguntas que:
  - Não fazem sentido semântico
  - São muito genéricas
  - Não podem ser respondidas com base no conteúdo
  - Têm estrutura incorreta

**Logs de Debug:**
- `📝 [ANÁLISE] Gerando perguntas para documento` - Início da geração
- `📝 [ANÁLISE] Perguntas geradas (antes da validação)` - Lista completa de perguntas geradas
- `🤖 [ANÁLISE] Validando perguntas com IA` - Início da validação
- `✅ [ANÁLISE] Perguntas validadas pela IA` - Perguntas aprovadas pela IA
- `⚠️ [ANÁLISE] Nenhuma pergunta válida gerada para documento` - Quando documento é pulado

### 3. Teste das Perguntas no RAG

Para cada pergunta validada:

```
Tenta buscar no RAG com minScore 0.3 (mais permissivo)
    ↓
Se não encontrou resultados, tenta com minScore 0.45 (padrão)
    ↓
Verifica se o documento atual está nos resultados
    ↓
Registra resultado (sucesso/falha, confiança, fontes)
```

**Estratégia de Teste:**
- **Primeira tentativa (minScore 0.3):** Mais permissiva, captura mais resultados
- **Segunda tentativa (minScore 0.45):** Padrão otimizado, mais rigorosa
- **Métricas coletadas:**
  - Sucesso/falha
  - Número de fontes encontradas
  - Confiança da resposta
  - Se o documento atual foi encontrado
  - Resposta gerada (primeiros 200 caracteres)

**Logs de Debug:**
- `🔍 [ANÁLISE] Testando pergunta no RAG` - Início do teste
- `🔍 [ANÁLISE] Resultado primeira tentativa (minScore 0.3)` - Resultado da primeira tentativa
- `🔍 [ANÁLISE] Tentando segunda vez com minScore 0.45` - Segunda tentativa necessária
- `🔍 [ANÁLISE] Resultado segunda tentativa (minScore 0.45)` - Resultado da segunda tentativa
- `✅ [ANÁLISE] Resultado final da pergunta` - Resultado consolidado (inclui flag de duplicata)
- `⚠️ [ANÁLISE] Resultado duplicado detectado e ignorado` - Quando duplicata é detectada
- `➕ [ANÁLISE] Adicionando resultado único` - Quando resultado único é adicionado
- `❌ [ANÁLISE] Erro ao processar pergunta` - Quando há erro no processamento

### 4. Atualização do Aprendizado Adaptativo

Após concluir a análise de todos os documentos:

```
Atualiza sinônimos extraídos dos documentos analisados
    ↓
Dispara aprendizado completo (otimiza configurações)
    ↓
Recarrega dados de aprendizado
    ↓
Atualiza modal se estiver aberto
```

**Atualização de Sinônimos:**
- Extrai termos relacionados dos documentos
- Identifica variações de palavras-chave
- Cria mapeamentos de sinônimos por contexto

**Aprendizado Completo:**
- Analisa padrões de perguntas bem-sucedidas vs. falhadas
- Ajusta configurações (minScore, topK, etc.)
- Atualiza regras de validação
- Incrementa contador de ciclos de aprendizado

**Logs de Debug:**
- `🧠 [APRENDIZADO] Iniciando atualização do aprendizado adaptativo` - Início do processo
- `📚 [APRENDIZADO] Atualizando sinônimos dos documentos` - Extração de sinônimos
- `✅ [APRENDIZADO] Sinônimos atualizados` - Sinônimos extraídos com sucesso
- `🔄 [APRENDIZADO] Disparando aprendizado completo` - Otimização de configurações
- `✅ [APRENDIZADO] Aprendizado completo concluído` - Configurações otimizadas
- `📊 [APRENDIZADO] Recarregando dados de aprendizado` - Recarregamento dos dados
- `✅ [APRENDIZADO] Dados de aprendizado recarregados` - Dados atualizados
- `📊 [APRENDIZADO] Carregando dados de aprendizado` - Quando modal é aberto
- `✅ [APRENDIZADO] Dados de aprendizado carregados` - Dados carregados com detalhes completos
- `⚠️ [APRENDIZADO] Tenant ID não disponível` - Quando não há tenant
- `❌ [APRENDIZADO] Erro ao carregar dados de aprendizado` - Erro no carregamento
- `🔄 [APRENDIZADO] Tentando carregar apenas métricas básicas` - Fallback para métricas

## Componentes do Aprendizado Adaptativo

### 1. Sinônimos Dinâmicos

**O que são:**
- Termos relacionados extraídos automaticamente dos documentos
- Variações de palavras-chave identificadas no contexto
- Mapeamentos que ajudam o RAG a encontrar documentos mesmo com termos diferentes

**Como funcionam:**
- Extraídos durante a análise de documentos
- Armazenados por tenant
- Usados na expansão de queries (NLP Service)
- Atualizados a cada ciclo de aprendizado

**Exemplo:**
```
Documento menciona: "Studio"
Sinônimos extraídos: ["estúdio", "plataforma", "ferramenta"]
Query: "Como usar estúdio?" → Encontra documento sobre "Studio"
```

### 2. Padrões de Perguntas

**O que são:**
- Perguntas bem-sucedidas: padrões que funcionaram bem
- Perguntas falhadas: padrões que não retornaram resultados

**Como funcionam:**
- Analisados para identificar estruturas que funcionam melhor
- Usados para melhorar a geração de perguntas futuras
- Ajudam a ajustar prompts e configurações

### 3. Configurações Adaptativas

**Parâmetros ajustados automaticamente:**
- `minScore`: Threshold mínimo de relevância
- `topK`: Número de chunks retornados
- `chunkOverlap`: Sobreposição entre chunks

**Como são ajustados:**
- Baseado na taxa de sucesso das queries
- Ajustados incrementalmente a cada ciclo
- Otimizados para maximizar acurácia

### 4. Regras de Validação

**O que são:**
- Regras configuráveis em `rag_validation_rules.json`
- Filtram perguntas inválidas antes de testá-las
- Adaptam-se automaticamente baseado na acurácia

**Tipos de regras:**
- Comprimento mínimo/máximo
- Conteúdo alfanumérico mínimo
- Padrões OCR (filtra texto extraído de imagens)
- Repetições consecutivas
- Estrutura genérica de perguntas

**Adaptação automática:**
- Pesos das regras ajustados baseado na acurácia
- Parâmetros ajustados incrementalmente
- Histórico de acurácia mantido por ciclo

## Ciclos de Aprendizado

### Estrutura de um Ciclo

1. **Análise de Documentos**
   - Gera e testa perguntas
   - Coleta métricas de sucesso/falha

2. **Atualização de Dados**
   - Atualiza sinônimos
   - Registra padrões de perguntas
   - Ajusta configurações

3. **Adaptação de Regras**
   - Analisa acurácia atual
   - Ajusta pesos das regras
   - Atualiza parâmetros

4. **Validação**
   - Verifica se acurácia alvo foi atingida
   - Verifica se limite de ciclos foi atingido
   - Continua ou finaliza adaptação

### Métricas Rastreadas

- **Taxa de Sucesso:** `successfulQueries / totalQueries`
- **Confiança Média:** Média das confianças das respostas
- **Ciclos Realizados:** Número de ciclos de aprendizado
- **Acurácia Atual:** Taxa de sucesso atual
- **Acurácia Alvo:** Meta de acurácia (padrão: 85%)

## Interface do Usuário

### Modal de Análise de Documentos

**Mostra:**
- Progresso em tempo real
- Documento atual sendo analisado
- Pergunta atual sendo testada
- Estatísticas (perguntas testadas, sucessos, falhas)
- Resultados detalhados por documento

### Modal de Aprendizado Adaptativo

**Mostra:**
- Estatísticas gerais (total de queries, taxa de sucesso, confiança média)
- Sinônimos aprendidos (editáveis)
- Padrões de perguntas (bem-sucedidas e falhadas)
- Configurações atuais (minScore, topK, etc.)
- Ciclos de aprendizado realizados
- Histórico de acurácia

**Ações disponíveis:**
- Atualizar sinônimos manualmente
- Resetar dados de aprendizado
- Limpar queries inválidas
- Ver detalhes de cada ciclo

## Logs de Debug

Todos os logs de debug seguem o padrão com emojis para fácil identificação:

### Análise de Documentos
- `🔍 [ANÁLISE]` - Processo de análise de documentos (início, testes)
- `📋 [ANÁLISE]` - Listagem e filtragem de documentos
- `📝 [ANÁLISE]` - Geração e validação de perguntas
- `🤖 [ANÁLISE]` - Validação com IA
- `✅ [ANÁLISE]` - Resultados e conclusões bem-sucedidas
- `⚠️ [ANÁLISE]` - Avisos (documentos sem perguntas, duplicatas)
- `❌ [ANÁLISE]` - Erros no processamento
- `➕ [ANÁLISE]` - Adição de resultados únicos
- `📄 [ANÁLISE]` - Processamento de documento individual
- `🔄 [ANÁLISE]` - Início de loops e iterações
- `📊 [ANÁLISE]` - Estatísticas e resumos

### Aprendizado Adaptativo
- `🧠 [APRENDIZADO]` - Processo de aprendizado adaptativo
- `📚 [APRENDIZADO]` - Atualização de sinônimos
- `🔄 [APRENDIZADO]` - Processamento de aprendizado
- `📊 [APRENDIZADO]` - Carregamento de dados
- `✅ [APRENDIZADO]` - Operações bem-sucedidas
- `⚠️ [APRENDIZADO]` - Avisos (tenant não disponível)
- `❌ [APRENDIZADO]` - Erros no processamento

### Como Usar os Logs

1. **Abra o Console do Navegador** (F12 → Console)
2. **Filtre por `[ANÁLISE]` ou `[APRENDIZADO]`** para ver apenas logs relevantes
3. **Use os emojis** para identificar rapidamente o tipo de log
4. **Verifique duplicatas** procurando por `⚠️ [ANÁLISE] Resultado duplicado`
5. **Acompanhe o progresso** através dos logs de progresso em tempo real

## Benefícios do Sistema

1. **Melhoria Contínua:** Sistema aprende com cada análise
2. **Adaptação Automática:** Ajusta-se sem intervenção manual
3. **Otimização por Tenant:** Cada tenant tem seu próprio aprendizado
4. **Transparência:** Logs detalhados permitem acompanhar o processo
5. **Flexibilidade:** Configurações podem ser ajustadas manualmente se necessário

## Próximos Passos

Para melhorar ainda mais o sistema:
1. Adicionar mais métricas de qualidade
2. Implementar aprendizado por domínio (chatbot, RPA, etc.)
3. Adicionar visualizações de tendências de acurácia
4. Implementar alertas quando acurácia cai abaixo de threshold
5. Adicionar exportação de relatórios de aprendizado

