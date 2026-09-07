{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "70bb75166fa97cb0239edc6ac4b63a5d07257a65cd978bade8c6e0658240aad2",
  "chainRoot": "70bb75166fa97cb0239edc6ac4b63a5d07257a65cd978bade8c6e0658240aad2",
  "gitCommit": "4fed000e7d6582001bcc24898a498189417d83b7",
  "timestamp": "2026-09-07T03:01:47.252Z",
  "seal": "04fc3a4a581ae91aafb2bd66dd3fcff4e4b8adc9a9d779ba5f7e2921abb14b1b",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
