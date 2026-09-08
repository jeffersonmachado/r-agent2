{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "92f6fd6aace873b50b98717bb35d2ab195d541d00efd47a72673f3e8d5bc193a",
  "chainRoot": "92f6fd6aace873b50b98717bb35d2ab195d541d00efd47a72673f3e8d5bc193a",
  "gitCommit": "9c44e5e02d504755a6bfbd8af74b4beb2c3c3d3c",
  "timestamp": "2026-09-08T13:56:34.734Z",
  "seal": "2e50ad0144d20ddde40e1eb600fe6e5f4e2d302915e895aa488c1ad9c46dc8c7",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
