{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "5c8ff5cc95b92bd70859cd39e39724c2f3a2f72c8587be0a568d132ad4450fc1",
  "chainRoot": "5c8ff5cc95b92bd70859cd39e39724c2f3a2f72c8587be0a568d132ad4450fc1",
  "gitCommit": "c4168033bb08bf6cce89a964916a0a2a888b00ab",
  "timestamp": "2026-09-13T20:37:09.120Z",
  "seal": "75b2e2f5b2a6120f08d239926d3670a28140fa784117d10bfc8ff1deef06f7a3",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
