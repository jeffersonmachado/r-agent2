{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "968cab0a4bdefa860e3e1d34c797f0ec578691f7ce4a6ca878acc64224d06d1b",
  "chainRoot": "968cab0a4bdefa860e3e1d34c797f0ec578691f7ce4a6ca878acc64224d06d1b",
  "gitCommit": "30bcaf5f629ee6c10c7973009d0b30f095bdeddc",
  "timestamp": "2026-09-12T15:44:38.366Z",
  "seal": "1831128b741dc9ea0f2fabe6298b01beb8200d621c8e1c82e0d2d0db8ef25524",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
