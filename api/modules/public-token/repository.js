'use strict';

function createPublicTokenRepository(publicAccessTokenService) {
  return {
    listPublicTokens(params) {
      return publicAccessTokenService.listPublicTokens(params);
    },
    getPublicTokenStats(params) {
      return publicAccessTokenService.getPublicTokenStats(params);
    },
    createPublicToken(params) {
      return publicAccessTokenService.createPublicToken(params);
    },
    revokePublicToken(params) {
      return publicAccessTokenService.revokePublicToken(params);
    },
    rotatePublicToken(params) {
      return publicAccessTokenService.rotatePublicToken(params);
    },
    resolvePublicToken(params) {
      return publicAccessTokenService.resolvePublicToken(params);
    },
  };
}

module.exports = {
  createPublicTokenRepository,
};
