FROM python:3.11-slim AS base

WORKDIR /app

# Instala dependências do sistema
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Copia requirements primeiro (otimização de cache)
COPY rag-service/requirements.txt .

# Instala dependências Python (apenas produção)
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt && \
    pip cache purge

# Copia código da aplicação
COPY rag-service/ .

# Cria diretório para dados e vector store
RUN mkdir -p /app/data /app/data/vector_store && \
    chmod -R 755 /app/data && \
    apt-get purge -y --auto-remove build-essential || true && \
    rm -rf /var/lib/apt/lists/*

# Define variáveis de ambiente padrão
ENV HOST=0.0.0.0
ENV PORT=8000
ENV PYTHONUNBUFFERED=1

# Expõe porta
EXPOSE 8000

# Healthcheck
HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD curl -f http://localhost:8000/health || exit 1

# Comando para iniciar
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]

