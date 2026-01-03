# Testes do Serviço RAG

Este diretório contém os testes automatizados do serviço RAG.

## Estrutura

```
tests/
├── __init__.py
├── conftest.py          # Configuração global do pytest
├── test_health.py       # Testes do endpoint /rag/health
├── test_index.py        # Testes do endpoint /rag/index
└── test_query.py        # Testes do endpoint /rag/query
```

## Executar Testes

### Todos os testes
```bash
cd rag-service
pytest
```

### Com verbose
```bash
pytest -v
```

### Teste específico
```bash
pytest tests/test_query.py
```

### Com cobertura
```bash
pytest --cov=. --cov-report=html
```

O relatório de cobertura será gerado em `htmlcov/index.html`.

### Apenas testes rápidos
```bash
pytest -m "not slow"
```

## Instalar Dependências de Teste

```bash
pip install -r requirements.txt
```

As dependências de teste (pytest, httpx, pytest-cov) já estão incluídas no `requirements.txt`.

## Estrutura dos Testes

### test_health.py
- Testa se o health check retorna status correto
- Verifica estrutura da resposta

### test_index.py
- Testa indexação de documentos
- Validação de campos obrigatórios
- Testa documentos longos (múltiplos chunks)
- Testa permissões

### test_query.py
- Testa consultas RAG
- Validação de queries
- Testa filtros e opções
- Verifica estrutura de respostas
- Testa confidence scores

## Fixtures

O arquivo `conftest.py` configura:
- Ambiente de teste isolado
- Diretório de dados de teste separado
- Cleanup automático após testes

## Notas

- Os testes usam um diretório separado para o vector store (`./data/test_vector_store`)
- Os testes são isolados e não afetam dados de produção
- Alguns testes podem demorar mais (carregamento de modelos)

