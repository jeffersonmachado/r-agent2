{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "33ae5329c2d113b2a38bc7de20ce4b6cd8e0c71461ce4875613a51e5c9b5b541",
  "chainRoot": "33ae5329c2d113b2a38bc7de20ce4b6cd8e0c71461ce4875613a51e5c9b5b541",
  "gitCommit": "c7452036bdf44cb46dd22d8d1850e6fd979fdef1",
  "timestamp": "2026-10-11T11:29:32.556Z",
  "seal": "a307657981b4468d98eb31633d17c75e4c3c97d8366cf9b0a77341f3395cc682",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
