{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "f4190fa8c2de2ae25f8648b7034732ff8b63df14c2fed747520ed95284216e2e",
  "chainRoot": "f4190fa8c2de2ae25f8648b7034732ff8b63df14c2fed747520ed95284216e2e",
  "gitCommit": "747484440090bd8ff16fd582911ef60f7157bb5c",
  "timestamp": "2026-09-08T13:05:06.215Z",
  "seal": "016bab6885430783c3f127f540c60bb552d6cba3dd412756038b027b8a80f26c",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
