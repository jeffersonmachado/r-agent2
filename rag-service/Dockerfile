FROM python:3.11-slim AS base

WORKDIR /app

# Instala dependências do sistema
RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copia requirements primeiro (otimização de cache)
COPY requirements.txt .

# Instala dependências Python (apenas produção)
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt && \
    pip cache purge

# Copia código da aplicação
COPY . .

# Cria diretório para dados e vector store
RUN mkdir -p /app/data /app/data/vector_store && \
    chmod -R 755 /app/data

# Define variáveis de ambiente padrão
ENV HOST=0.0.0.0
ENV PORT=8001
ENV PYTHONUNBUFFERED=1

# Expõe porta
EXPOSE 8001

# Healthcheck
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8001/rag/health || exit 1

# Comando para iniciar
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]

