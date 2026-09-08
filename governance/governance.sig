{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "5442a4875d5f38745062048633ecc8c1bdef07fc706f1c21b50ccd5a4c5a87b6",
  "chainRoot": "5442a4875d5f38745062048633ecc8c1bdef07fc706f1c21b50ccd5a4c5a87b6",
  "gitCommit": "fde8ad4813c245f670ac3ba4a081aed437492b2b",
  "timestamp": "2026-09-08T22:42:45.261Z",
  "seal": "1cc0550a88ca2ab52c94d4662eb12a0f8f1c82d7b1b91c9dec985c47ba1717da",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
