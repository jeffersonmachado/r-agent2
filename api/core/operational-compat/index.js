'use strict';

const modelCompat = require('./modelCompat');
const playbookCompat = require('./playbookCompat');

module.exports = {
  ...modelCompat,
  ...playbookCompat,
};
