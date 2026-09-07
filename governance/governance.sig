{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "7259a42535943e28d85d036c7f6e45279b4e61cbde1246f4402aa7b6c2a4f5f3",
  "chainRoot": "7259a42535943e28d85d036c7f6e45279b4e61cbde1246f4402aa7b6c2a4f5f3",
  "gitCommit": "dae71f5a7071ff36d2574219b70b69d323016097",
  "timestamp": "2026-09-07T00:04:36.090Z",
  "seal": "9186b3ffd11a57486d290ffef73f22669bc7833476fd2dde3acd07ee3a8ee0fa",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
