#!/bin/bash
# Script para criar banco de dados PostgreSQL local
# 
# Uso: ./scripts/create-database-local.sh
# 
# Este script cria o banco de dados usando o usuário postgres do sistema
# Pode pedir senha do sudo se necessário

set -e

# Carrega variáveis do .env
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -f "$PROJECT_DIR/.env" ]; then
    export $(grep -v '^#' "$PROJECT_DIR/.env" | grep -v '^$' | xargs)
fi

# Configurações padrão
PGHOST=${PGHOST:-localhost}
PGUSER=${PGUSER:-postgres}
PGDATABASE=${PGDATABASE:-r_agent2}
PGPORT=${PGPORT:-5432}

echo "========================================="
echo "Criando banco de dados PostgreSQL local"
echo "========================================="
echo "Host: $PGHOST"
echo "Port: $PGPORT"
echo "User: $PGUSER"
echo "Database: $PGDATABASE"
echo ""

# Verifica se o banco já existe
DB_EXISTS=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$PGDATABASE'" 2>/dev/null || echo "0")

if [ "$DB_EXISTS" = "1" ]; then
    echo "⚠️  Banco de dados '$PGDATABASE' já existe!"
    echo ""
    read -p "Deseja continuar mesmo assim? (s/N): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Ss]$ ]]; then
        echo "Operação cancelada."
        exit 0
    fi
fi

# Cria o banco de dados
echo "Criando banco de dados '$PGDATABASE'..."
sudo -u postgres psql -c "CREATE DATABASE \"$PGDATABASE\";" 2>&1 || {
    if [ $? -eq 0 ]; then
        echo "✅ Banco de dados criado com sucesso!"
    else
        echo "❌ Erro ao criar banco de dados"
        echo ""
        echo "💡 Dicas:"
        echo "   1. Verifique se o PostgreSQL está rodando: sudo systemctl status postgresql"
        echo "   2. Tente criar manualmente: sudo -u postgres psql -c \"CREATE DATABASE $PGDATABASE;\""
        exit 1
    fi
}

echo ""
echo "✅ Banco de dados '$PGDATABASE' criado com sucesso!"
echo ""
echo "Próximos passos:"
echo "  1. Execute as migrations: node api/db/migrate.js"
echo "  2. Execute o seed: node api/db/seed.js"
echo "  3. Inicie o servidor: npm start"
