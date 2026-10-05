{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "87e785fd5d620456b188cf85860aa951991fa289fa5fd22494cdf2093f0411ff",
  "chainRoot": "87e785fd5d620456b188cf85860aa951991fa289fa5fd22494cdf2093f0411ff",
  "gitCommit": "7cd39c6a812437aeb202e728742c2f9768e5f8fb",
  "timestamp": "2026-10-05T22:39:59.103Z",
  "seal": "c96e23d7668331e0c01e77f93fa1b331e227b028b399ee97dd4cbb8525bf85fb",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
