{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "55350feda23cff0ff1537ce398ba094cee2f3a727c44a92101482203677f1796",
  "chainRoot": "55350feda23cff0ff1537ce398ba094cee2f3a727c44a92101482203677f1796",
  "gitCommit": "097b0e4c4e85d4921f1ec59c5ab0798a7d9097bc",
  "timestamp": "2026-10-16T06:17:14.860Z",
  "seal": "2dd23b457fc1fe0eae2c7f69b97c24402afcd48a2f485bc71493cf217344dc87",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
