{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "8691d3f68bdd5d4af3c18d3b2026d0abdd2d7479999cca74b71f452a65acf0c5",
  "chainRoot": "8691d3f68bdd5d4af3c18d3b2026d0abdd2d7479999cca74b71f452a65acf0c5",
  "gitCommit": "431454fe6b8f45c29699018df40bc0a1c6c17a68",
  "timestamp": "2026-09-04T01:24:15.520Z",
  "seal": "d39ed6f21759a03af303fcdf65bb328f2fd8ecee353e4638c553b40fa235e4ec",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
