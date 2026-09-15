{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "3f6bf7d664c38873f8ca18287449272ff6a1956ea150987d928562a5e1300846",
  "chainRoot": "3f6bf7d664c38873f8ca18287449272ff6a1956ea150987d928562a5e1300846",
  "gitCommit": "52c5c4d554c0043984a3a90ec7036cbd40393652",
  "timestamp": "2026-09-15T11:26:49.521Z",
  "seal": "1337066c797f088d9c60256c5678419c6a049e61dee15373aef5025c4217eea9",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
