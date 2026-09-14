{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "afd27e238930dd12ff4ee751dd17685a99d6d817e98ec77bd58becf962abee21",
  "chainRoot": "afd27e238930dd12ff4ee751dd17685a99d6d817e98ec77bd58becf962abee21",
  "gitCommit": "e28d26577a57a9387960faa85c2bea42e598a3fd",
  "timestamp": "2026-09-14T15:55:20.232Z",
  "seal": "ae4c4b4f82f2179088c9f42b7aa2c387a4d35986cac70313141880568c1c2274",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
