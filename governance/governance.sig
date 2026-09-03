{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "38b912dc4945976be37f7b551f47810c30587bdecbe54857875b83e81d22c977",
  "chainRoot": "38b912dc4945976be37f7b551f47810c30587bdecbe54857875b83e81d22c977",
  "gitCommit": "ee249a035666582e76b31ae8ffd9cdedd422ad3b",
  "timestamp": "2026-09-03T21:03:50.633Z",
  "seal": "b726eb0ef766d7322f2e49ff97103a0936be738cba8ca50a106094bcd87eedee",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
