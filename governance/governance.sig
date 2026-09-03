{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "f5c89439d9aa932b5f04c175984410196ddfe85dd766f5559b6c68c2f1e0820d",
  "chainRoot": "f5c89439d9aa932b5f04c175984410196ddfe85dd766f5559b6c68c2f1e0820d",
  "gitCommit": "aa34c79f4f38cc025aae87df10576653716966cb",
  "timestamp": "2026-09-03T15:51:14.917Z",
  "seal": "76bf86b22f38b595ac20ce8a73cfbb641ef09a833ea48f54b35e248906d8b966",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
