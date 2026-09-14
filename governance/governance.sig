{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "0ef9ce7ab08858bdbdf2df103ab3c326e24284cc07e8b935ed59171f7a2c8f49",
  "chainRoot": "0ef9ce7ab08858bdbdf2df103ab3c326e24284cc07e8b935ed59171f7a2c8f49",
  "gitCommit": "24d781caaea8fa405a6b53473051f073bd3901d9",
  "timestamp": "2026-09-14T21:40:38.882Z",
  "seal": "eeb9dda483f51ceaf32782bf8f5d40047bf5ba4bbb4f0fb9bffbc01d366b279d",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
