{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "fe445ec6e0489677243fbb11284d78fe1b0af88b067dfd7619c80950c7b02e18",
  "chainRoot": "fe445ec6e0489677243fbb11284d78fe1b0af88b067dfd7619c80950c7b02e18",
  "gitCommit": "e262a9acfa9aaefb0ae9aa0a34d65e18c18d1223",
  "timestamp": "2026-09-07T17:56:04.958Z",
  "seal": "0b5dee2209cd6fca04b8f8f35d485673b69c7edf5f63cdecc0adeb445c573082",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
