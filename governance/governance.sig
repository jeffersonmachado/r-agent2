{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "fe58ae4fb010d5bb74a5cbc52973e835ba2970867d854d2c88c80370f015e58d",
  "chainRoot": "fe58ae4fb010d5bb74a5cbc52973e835ba2970867d854d2c88c80370f015e58d",
  "gitCommit": "3c2d1fee4f68a6901f81458246a26bbc3640fa1c",
  "timestamp": "2026-09-03T12:54:36.986Z",
  "seal": "5f1be10f7799870d6b47c08b271e3d88507b28b6a7d6ee5a5aedac42eb094112",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
