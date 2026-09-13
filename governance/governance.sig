{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "1b1adadd6bae7db399ab0aaa4d9a81bce16d1f58d888419473e2d446c39c2c55",
  "chainRoot": "1b1adadd6bae7db399ab0aaa4d9a81bce16d1f58d888419473e2d446c39c2c55",
  "gitCommit": "dcbfad5c59afed1cfd9093892351a2d0bafbf948",
  "timestamp": "2026-09-13T21:38:58.964Z",
  "seal": "2813931b83841ee0b8e408e3a47e0441fb7d7529bdb77c39242c58fc35fffe0b",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
