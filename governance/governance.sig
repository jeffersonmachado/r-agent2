{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "60aedd92bb7526d55f6e6b9d6d121d478a18553ddab42c9f64c514ea6642a8a9",
  "chainRoot": "60aedd92bb7526d55f6e6b9d6d121d478a18553ddab42c9f64c514ea6642a8a9",
  "gitCommit": "0217eeb0733f379bfc8cd54afc8dd3d447d76c10",
  "timestamp": "2026-09-18T16:11:25.173Z",
  "seal": "3a2c0d32c47494ae08f769567273f5c56ca6618f44aacdb3a592ec845d2684f0",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
