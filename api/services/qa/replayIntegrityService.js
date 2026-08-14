'use strict';

// Boundary de compatibilidade. A implementação vive em `lib/` para poder ser
// usada também pelo runtime RPA sem inverter a dependência core -> api.
module.exports = require('../../../lib/replayIntegrity');
