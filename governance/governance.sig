{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "19bda01deb66601d88b5bf509f276c087c4041b5a9e8e34c264e019eff8c1aa5",
  "chainRoot": "19bda01deb66601d88b5bf509f276c087c4041b5a9e8e34c264e019eff8c1aa5",
  "gitCommit": "8353ec6dfd79e719b127fb33f5923500e584bbfc",
  "timestamp": "2026-09-12T09:41:15.781Z",
  "seal": "bfa1f430a20858d0d9a4defffa65de7e9606c5151e45b69e6642cb5860df6793",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
