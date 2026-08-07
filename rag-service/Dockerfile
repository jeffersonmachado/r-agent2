FROM python:3.12-slim AS base

WORKDIR /app

# Instala dependências do sistema
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Copia requirements primeiro (otimização de cache)
COPY requirements.txt .

# Instala dependências Python (apenas produção)
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt && \
    pip cache purge

# Pré-baixa o modelo de embeddings padrão (sentence-transformers/all-MiniLM-L6-v2)
# nos backends torch e ONNX, para o cold start não depender de rede externa
# ao HuggingFace (RAG_EMBEDDING_BACKEND=onnx no compose de produção)
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2'); SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2', backend='onnx', model_kwargs={'file_name': 'onnx/model.onnx'})"

# Copia código da aplicação
COPY . .

# Cria diretório para dados e vector store
RUN mkdir -p /app/data /app/data/vector_store /var/lib/ragent2/rag/vector_store /var/lib/ragent2/rag/adaptive_learning && \
    chmod -R 755 /app/data /var/lib/ragent2 && \
    apt-get purge -y --auto-remove build-essential || true && \
    rm -rf /var/lib/apt/lists/*

# Define variáveis de ambiente padrão
ENV HOST=0.0.0.0
ENV PORT=8000
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app
ENV RAG_DATA_ROOT=/var/lib/ragent2/rag
ENV VECTOR_STORE_PATH=/var/lib/ragent2/rag/vector_store
ENV ADAPTIVE_LEARNING_DATA_PATH=/var/lib/ragent2/rag/adaptive_learning

# Expõe porta
EXPOSE 8000

# Healthcheck
HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD curl -f http://localhost:8000/health || exit 1

# Comando para iniciar
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]

