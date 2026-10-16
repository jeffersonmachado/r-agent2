{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "35bb6b1226199ae0f3d8801bc1c847f4245f689d108f5b605aafedb83470ca0b",
  "chainRoot": "35bb6b1226199ae0f3d8801bc1c847f4245f689d108f5b605aafedb83470ca0b",
  "gitCommit": "5efce7924932822c23888de97efc6243981da75e",
  "timestamp": "2026-10-16T15:27:36.202Z",
  "seal": "c3a9f72d9d6335f5c88d0087a08f72c8332762624bce2643154cb4f1f43b571c",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
