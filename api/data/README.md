# Diretório de Dados

Este diretório contém arquivos de persistência de dados da aplicação.

## Arquivos

- `flows.json`: Armazena todos os fluxos salvos no sistema. Este arquivo é criado automaticamente quando o primeiro fluxo é salvo.

## Nota

O arquivo `flows.json` está no `.gitignore` para evitar commitar dados de desenvolvimento. Em produção, você pode querer usar um banco de dados real ou um sistema de arquivos compartilhado.
