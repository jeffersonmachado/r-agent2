# 🚀 Deploy Remoto com Progresso

## Script Atualizado

O script `docker-deploy-save-load.sh` foi atualizado para mostrar progresso detalhado em cada etapa:

### Melhorias Implementadas

1. **Contador de Progresso**: Mostra `[X/3]` para cada imagem
2. **Tamanhos Exibidos**: Mostra o tamanho de cada arquivo
3. **Mensagens de Status**: ✅ para sucesso, ❌ para erro, ⚠️ para aviso
4. **Feedback em Tempo Real**: Mostra o que está acontecendo em cada etapa
5. **Timeouts Configurados**: Evita travamentos indefinidos

### Como Usar

```bash
cd /opt/results/ria/r-agent2
export SSHPASS='resu100gabao'
./scripts/docker-deploy-save-load.sh \
  --host 10.10.2.30 \
  --user root \
  --dir /opt/results/ria/r-agent2
```

### O que o Script Faz

1. **Verifica Imagens Locais**: Confirma que todas as imagens existem
2. **Salva Imagens**: Exporta as imagens para arquivos `.tar`
   - Mostra progresso: `[1/3] Salvando r-agent2-api:latest...`
   - Mostra tamanho: `✅ Concluído! Tamanho: 132M`
3. **Copia Arquivos**: Envia `docker-compose.prod.yml` para o servidor
4. **Copia Imagens**: Envia cada arquivo `.tar` para o servidor
   - Mostra: `[1/3] Copiando r-agent2-api_latest.tar (132M)...`
   - Mostra: `✅ r-agent2-api_latest.tar copiado com sucesso`
5. **Carrega Imagens**: Carrega as imagens no Docker do servidor remoto
   - Mostra: `[1/3] Carregando r-agent2-api:latest...`
   - Mostra: `✅ r-agent2-api:latest carregada com sucesso`
6. **Faz Deploy**: Inicia os containers no servidor remoto
   - Mostra status de cada container
   - Testa frontend e API

### Exemplo de Saída

```
=== Deploy usando Docker Save/Load ===

[INFO] Configuração:
  Host: 10.10.2.30
  User: root
  Diretório: /opt/results/ria/r-agent2

=== Verificando Imagens Locais ===

[INFO] ✅ r-agent2-api:latest encontrada
[INFO] ✅ r-agent2-frontend:latest encontrada
[INFO] ✅ r-agent2-rag-service:latest encontrada

=== Salvando Imagens ===

[INFO] [1/3] Salvando r-agent2-api:latest...
[INFO]   Destino: /tmp/r-agent2-deploy-12345/r-agent2-api_latest.tar
[INFO]   Salvando imagem (isso pode demorar)...
[INFO]   ✅ Concluído! Tamanho: 132M

[INFO] [2/3] Salvando r-agent2-frontend:latest...
...

=== Copiando Arquivos para o Servidor ===

[INFO] Criando diretório no servidor...
[INFO]   ✅ Diretório criado
[INFO] Copiando docker-compose.prod.yml...
[INFO]   ✅ docker-compose.prod.yml copiado

=== Copiando Imagens para o Servidor ===

[INFO] [1/3] Copiando r-agent2-api_latest.tar (132M)...
[INFO]   Isso pode demorar alguns minutos...
[INFO]   ✅ r-agent2-api_latest.tar copiado com sucesso

...

=== Carregando Imagens no Servidor ===

[INFO] [1/3] Carregando r-agent2-api:latest...
    Carregando imagem...
    Loaded image: r-agent2-api:latest
    Limpando arquivo temporário...
    Imagem carregada!
[INFO]   ✅ r-agent2-api:latest carregada com sucesso

...

=== Fazendo Deploy no Servidor ===

[INFO] Executando deploy no servidor...
[INFO]   Isso pode levar alguns minutos...
  === Parando Containers Existentes ===
  === Iniciando Containers ===
  === Aguardando Inicialização ===
  === Status dos Containers ===
  === Testando Frontend ===
    Frontend Status: 200
  === Testando API ===
    API Status: 200
  === Deploy Concluído ===

=== Deploy Concluído! ===
```

### Troubleshooting

Se o script travar:

1. **Verifique a conexão SSH**:
   ```bash
   sshpass -p 'resu100gabao' ssh root@10.10.2.30 "echo 'OK'"
   ```

2. **Verifique se o servidor está acessível**:
   ```bash
   ping -c 3 10.10.2.30
   ```

3. **Verifique espaço em disco no servidor**:
   ```bash
   sshpass -p 'resu100gabao' ssh root@10.10.2.30 "df -h"
   ```

4. **Veja os logs do script**:
   ```bash
   ./scripts/docker-deploy-save-load.sh ... 2>&1 | tee deploy.log
   ```

### Notas Importantes

- O script usa `SSHPASS` para autenticação SSH
- As imagens são salvas localmente antes de serem copiadas
- Arquivos temporários são limpos automaticamente
- O script tem timeouts para evitar travamentos indefinidos
- Progresso é mostrado mesmo sem `pv` instalado (usa pontos)
