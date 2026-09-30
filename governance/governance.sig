{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "c70273d4e96ec78f2106d8d13fa322a65a90701725d4b6c70f4306ea164f906a",
  "chainRoot": "c70273d4e96ec78f2106d8d13fa322a65a90701725d4b6c70f4306ea164f906a",
  "gitCommit": "1da66052562d5f9e09c2907e9359d1ea9945361d",
  "timestamp": "2026-09-30T04:23:39.819Z",
  "seal": "0872c1940fd3b6280abf42ced7f22783606292d3d4cf471e7c6c110410d65da8",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
