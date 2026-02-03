# Espaço em Disco Necessário para RAG Service

## Situação Atual
- **Espaço disponível no disco**: ~1.5 GB
- **Espaço necessário**: **3-5 GB** (recomendado)

## Análise das Dependências

### Pacotes Principais e Tamanhos Estimados

1. **sentence-transformers (2.2.2)** - ~500 MB - 1 GB
   - Inclui dependências: torch, transformers, numpy, scipy
   - Modelos pré-treinados baixados sob demanda (podem ser 500 MB - 2 GB cada)

2. **psycopg2-binary** - ~5-15 MB
   - Driver para Postgres (o vector store fica no Postgres via pgvector)

3. **fastapi + uvicorn** - ~20-30 MB
   - Framework web assíncrono

4. **Outras dependências** (pydantic, numpy, openai, etc.) - ~50-100 MB

5. **Cache do pip** (durante instalação) - ~500 MB - 1 GB
   - Arquivos temporários durante download e compilação

6. **Ambiente virtual (venv)** - ~100-200 MB (já existe: 131 MB)

## Espaço Total Necessário

### Mínimo Recomendado: **3 GB**
- Instalação básica das bibliotecas
- Sem modelos pré-treinados grandes

### Recomendado: **5 GB**
- Instalação completa
- Cache do pip
- Modelos pré-treinados (baixados sob demanda)
- Espaço para operação normal

### Ideal: **10 GB**
- Instalação completa
- Múltiplos modelos pré-treinados
- Cache e arquivos temporários
- Espaço para crescimento futuro

## Como Liberar Espaço

### Opções para Liberar Espaço:

1. **Limpar cache do pip**:
   ```bash
   pip cache purge
   # ou
   rm -rf ~/.cache/pip
   ```

2. **Limpar pacotes não utilizados**:
   ```bash
   apt autoremove
   apt autoclean
   ```

3. **Limpar logs antigos**:
   ```bash
   journalctl --vacuum-time=7d
   ```

4. **Remover arquivos temporários**:
   ```bash
   rm -rf /tmp/*
   ```

5. **Verificar arquivos grandes**:
   ```bash
   du -h / | sort -rh | head -20
   ```

## Instalação com Espaço Limitado

Se você tiver apenas 2-3 GB disponíveis, pode tentar:

1. **Instalar sem cache**:
   ```bash
   pip install --no-cache-dir -r requirements.txt
   ```

2. **Instalar apenas dependências essenciais primeiro**:
   ```bash
   pip install fastapi uvicorn pydantic
   pip install sentence-transformers --no-cache-dir
   ```

3. **Usar modelo menor do sentence-transformers**:
   - Modelos menores ocupam menos espaço
   - Configure para usar modelos leves quando possível

## Verificação de Espaço

```bash
# Ver espaço disponível
df -h

# Ver tamanho do venv
du -sh rag-service/venv

# Ver cache do pip
du -sh ~/.cache/pip
```

## Conclusão

**Você precisa de pelo menos 3 GB de espaço livre** para instalar todas as dependências do RAG Service com segurança. Com apenas 1.5 GB disponível, a instalação provavelmente falhará ao tentar instalar `sentence-transformers` e suas dependências.

**Recomendação**: Libere pelo menos 3-5 GB antes de tentar instalar as dependências.

