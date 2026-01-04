# Script de Geração de ZIP

Script bash para gerar arquivos ZIP do projeto r-agent2.

## Uso Básico

```bash
# Gerar ZIP básico (exclui node_modules, coverage, dist)
./scripts/generate-zip.sh

# Ou usando npm
npm run zip
```

## Opções Disponíveis

### Opções de Saída

```bash
# Especificar diretório de saída
./scripts/generate-zip.sh -o /tmp/backups

# Especificar nome do arquivo
./scripts/generate-zip.sh -n meu-projeto.zip
```

### Inclusões Específicas

```bash
# Incluir node_modules
./scripts/generate-zip.sh --include-node-modules

# Incluir coverage
./scripts/generate-zip.sh --include-coverage

# Incluir dist
./scripts/generate-zip.sh --include-dist

# Incluir tudo
npm run zip:all
```

### Inclusões e Exclusões Customizadas

```bash
# Incluir apenas arquivos específicos
./scripts/generate-zip.sh -i "api/**" -i "package.json" -n api-only.zip

# Excluir padrões específicos
./scripts/generate-zip.sh -e "tests/**" -e "**/*.test.js"

# Múltiplas inclusões
./scripts/generate-zip.sh -i "api/**" -i "engine/**" -i "package.json"
```

## Exemplos Práticos

### 1. ZIP Completo para Deploy

```bash
# Incluir tudo exceto node_modules e arquivos temporários
./scripts/generate-zip.sh --include-coverage --include-dist -n deploy.zip
```

### 2. ZIP Apenas da API

```bash
# Gerar ZIP apenas com código da API
npm run zip:api
# ou
./scripts/generate-zip.sh -i "api/**" -i "engine/**" -i "package.json" -i "package-lock.json" -n api-only.zip
```

### 3. ZIP Apenas do Frontend

```bash
# Gerar ZIP apenas com código do frontend
npm run zip:frontend
# ou
./scripts/generate-zip.sh -i "frontend/**" -i "package.json" -i "package-lock.json" -n frontend-only.zip
```

### 4. ZIP para Backup

```bash
# Backup completo incluindo node_modules
./scripts/generate-zip.sh --include-node-modules -o ~/backups -n backup-$(date +%Y%m%d).zip
```

### 5. ZIP Excluindo Testes

```bash
# Gerar ZIP sem arquivos de teste
./scripts/generate-zip.sh -e "tests/**" -e "**/*.test.js" -e "**/*.spec.js" -n production.zip
```

## Padrões Excluídos por Padrão

O script exclui automaticamente:

- `node_modules/` (a menos que `--include-node-modules` seja usado)
- `.git/`
- `coverage/` (a menos que `--include-coverage` seja usado)
- `dist/` (a menos que `--include-dist` seja usado)
- `*.log`
- `.env`
- `*.swp`, `*.swo`, `*~` (arquivos temporários)
- `.DS_Store`, `Thumbs.db` (arquivos do sistema)
- `.vscode/`, `.idea/` (configurações de IDE)

## Scripts NPM Disponíveis

```bash
# ZIP básico
npm run zip

# ZIP completo (inclui tudo)
npm run zip:all

# ZIP apenas da API
npm run zip:api

# ZIP apenas do frontend
npm run zip:frontend
```

## Saída

O script gera o arquivo ZIP no diretório `dist/` por padrão (ou no diretório especificado com `-o`).

O nome padrão do arquivo é: `r-agent2-YYYYMMDD-HHMMSS.zip`

O script também exibe:
- Total de arquivos incluídos
- Tamanho do arquivo ZIP gerado
- Estatísticas (quantidade de arquivos por tipo)

## Requisitos

- Comando `zip` instalado no sistema
  - Ubuntu/Debian: `sudo apt-get install zip`
  - macOS: `brew install zip` (geralmente já vem instalado)
  - Windows: Use Git Bash ou WSL

## Ajuda

Para ver todas as opções disponíveis:

```bash
./scripts/generate-zip.sh --help
```








