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
# ao HuggingFace (RAG_EMBEDDING_BACKEND=onnx no compose de produção).
#
# RETRY (medido no CI de 2026-10-24, run 40108935675): o HuggingFace respondeu
# `429 Client Error: Too Many Requests` para o IP do runner e o build da imagem morreu —
# um build de imagem não pode depender de uma janela de rate limit de terceiro. As
# tentativas são finitas e o passo FALHA FECHADO (`exit 1`) se todas esgotarem: retry não
# é tolerância a ausência do modelo.
RUN ok=0; \
    for tentativa in 1 2 3 4 5; do \
      if python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2'); SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2', backend='onnx', model_kwargs={'file_name': 'onnx/model.onnx'})"; then \
        ok=1; break; \
      fi; \
      espera=$((tentativa * 10)); \
      echo "[rag] download do modelo falhou (tentativa ${tentativa}/5) — aguardando ${espera}s"; \
      sleep "${espera}"; \
    done; \
    if [ "${ok}" != "1" ]; then echo "[rag] ERRO: modelo não pôde ser baixado após 5 tentativas"; exit 1; fi

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

