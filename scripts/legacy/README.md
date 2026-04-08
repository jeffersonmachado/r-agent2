# Scripts Fora Do Fluxo Principal

Esta pasta agrupa scripts que não fazem parte do fluxo principal do projeto.

Regra:
- qualquer script fora da trilha system:bootstrap/system:validate/system:release/system:deploy
  deve ser tratado como script de suporte e não como caminho canônico.

Antes de promover um script para o fluxo principal:
1. tornar idempotente
2. remover dependências implícitas locais
3. integrar ao comando system correspondente
4. atualizar docs/official-path.md
