{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "c6ba5ac2f2859a5e0b3d6d6e1f1826ff404adc4260801457d4bef07d85c1fe6c",
  "chainRoot": "c6ba5ac2f2859a5e0b3d6d6e1f1826ff404adc4260801457d4bef07d85c1fe6c",
  "gitCommit": "e7c78d5e3b5564a8f21d0f12c5d113ceb9da411b",
  "timestamp": "2026-09-05T19:35:51.480Z",
  "seal": "1914ec5c5bace8018b09c7628689acc80b5ee00b2f28a3c6ba1d7176157aa91c",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
