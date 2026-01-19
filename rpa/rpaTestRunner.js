// Runtime wrapper: re-export RPA runner from legacy location.
// TODO: mover implementação completa de `tests/rpa/*` para `rpa/*` (runtime), mantendo `tests/` apenas para testes.
module.exports = require('../tests/rpa/rpaTestRunner');

