FROM python:3.11-slim

WORKDIR /app

# Instala dependências do sistema
RUN apt-get update && apt-get install -y \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copia requirements
COPY requirements.txt .

# Instala dependências Python
RUN pip install --no-cache-dir -r requirements.txt

# Copia código
COPY . .

# Cria diretório para dados
RUN mkdir -p /app/data

# Expõe porta
EXPOSE 8000

# Comando para iniciar
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

