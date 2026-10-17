{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "751e9402978e37db75899c6964e85d874f008c063203418ae989584a622f6c21",
  "chainRoot": "751e9402978e37db75899c6964e85d874f008c063203418ae989584a622f6c21",
  "gitCommit": "39c48eb5956f6c19b3301f3745a2b5fe8704d99a",
  "timestamp": "2026-10-17T04:42:47.485Z",
  "seal": "da424c2dc15332c568cc26a061d505c6b156441892e7517c989cf9f870c643eb",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
