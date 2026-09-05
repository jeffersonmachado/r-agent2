{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "d2dd065f72b242baa3d4ed8208744cb55861195a1459ac309059dfd90e129398",
  "chainRoot": "d2dd065f72b242baa3d4ed8208744cb55861195a1459ac309059dfd90e129398",
  "gitCommit": "48d9f6767d6981a970ca1d938332636d6772041d",
  "timestamp": "2026-09-04T19:09:48.992Z",
  "seal": "a25b848066c6ccf62537a88b95777f10f02b65eabe9c0f314663a6883e3ef1ea",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
