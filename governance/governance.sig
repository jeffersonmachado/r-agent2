{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "7cc83ce5b52d5954b93e95cfc665816321697bc6b77a04f5eaac86b9be9ef19e",
  "chainRoot": "7cc83ce5b52d5954b93e95cfc665816321697bc6b77a04f5eaac86b9be9ef19e",
  "gitCommit": "285905f6fd8ee0b44501182f2837d58e84102c62",
  "timestamp": "2026-09-09T03:58:31.959Z",
  "seal": "74eb958ebd19aabc724b5d38f589f0fea60fd2052b7953978aa39e1e53087e9e",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
