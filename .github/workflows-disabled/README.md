GitHub Actions desativado localmente neste reposititorio.

Motivo:
- Operacao migrada para gate local no servidor.

Como reativar:
1. Mover os arquivos de .github/workflows-disabled/ para .github/workflows/
2. Fazer commit/push da mudanca

Exemplo:
- mv .github/workflows-disabled/*.yml .github/workflows/
- mv .github/workflows-disabled/*.yaml .github/workflows/
