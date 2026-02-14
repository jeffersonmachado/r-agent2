# Serviço RAG (Retrieval-Augmented Generation)

Serviço Python FastAPI para RAG, integrado ao sistema de chatbot.

## Estrutura

```
rag-service/
├── main.py                 # FastAPI app
├── requirements.txt
├── Dockerfile
├── config/
│   └── settings.py         # Configurações
├── models/
│   ├── document.py
│   └── query.py
├── services/
│   ├── embedding_service.py
│   ├── vector_store.py
│   ├── chunking_service.py
│   └── llm_service.py
├── api/
│   └── routes/
│       ├── query.py
│       ├── index.py
│       └── health.py
└── utils/
    └── logger.py
```

## Endpoints

### GET /rag/health
Health check do serviço.

### POST /rag/query
Consulta RAG com busca vetorial e geração de resposta.

### POST /rag/index
Indexa um documento (chunking + embeddings + índice).

## Configuração

Copie `.env.example` para `.env` e ajuste as configurações.

## Execução

### Desenvolvimento
```bash
pip install -r requirements.txt
uvicorn main:app --reload
```

### Docker
```bash
docker build -t rag-service .
docker run -p 8000:8000 rag-service
```

## Dependências

- FastAPI: Framework web
- sentence-transformers: Embeddings
- PostgreSQL + pgvector: Busca vetorial
- openai: LLM (opcional)

