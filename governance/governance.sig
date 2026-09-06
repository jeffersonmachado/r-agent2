{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "f408868be312d0c3bbd2f70898c8c89db627ca62d89103c8d4757ecd62e58875",
  "chainRoot": "f408868be312d0c3bbd2f70898c8c89db627ca62d89103c8d4757ecd62e58875",
  "gitCommit": "96e4cfc78ac131066fdb8282c9e4ca5b6138706b",
  "timestamp": "2026-09-06T18:56:31.694Z",
  "seal": "a452d54b2d84a4098bfe01902ef12c7ee1bf3957d27c1f8eb13bbfa24978299b",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
