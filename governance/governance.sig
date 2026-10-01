{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "423a6090b36a3094c8308f135fadd215aadf92f31377ccba712ecece9dc6906a",
  "chainRoot": "423a6090b36a3094c8308f135fadd215aadf92f31377ccba712ecece9dc6906a",
  "gitCommit": "68dc1ae70ed0b012f9ce4b91d1890a2bc67f3940",
  "timestamp": "2026-10-01T15:49:17.585Z",
  "seal": "6d28efa38df1e8eafa5d7c2d031c49364167b61425ee19dd82b6e069a048a82b",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
