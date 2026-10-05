{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "fc79b97cb1be77557749f89e9be5b2568d715cab4334553280170c5f136d1fe0",
  "chainRoot": "fc79b97cb1be77557749f89e9be5b2568d715cab4334553280170c5f136d1fe0",
  "gitCommit": "ed7fc3209604ddb75028f214ece5d8138ea209f2",
  "timestamp": "2026-10-05T22:25:24.824Z",
  "seal": "314bdc219ec4353480ed6614f5867e8244c829f226f5e69f7f229f2cd52b339e",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
