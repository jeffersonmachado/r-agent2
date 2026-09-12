{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "1b4f218ac1f64bb5c0a3e6259b9447cc82d97dcd4fc3bb7bc44cea7bdf91e999",
  "chainRoot": "1b4f218ac1f64bb5c0a3e6259b9447cc82d97dcd4fc3bb7bc44cea7bdf91e999",
  "gitCommit": "a9b01564d634081c08a0cfe0ff4f7afa221d676f",
  "timestamp": "2026-09-12T17:01:56.007Z",
  "seal": "c5c5211bb6a9a77962d24c4521f7bc0a7cf67d867ca1b4e13177ae64c95bfaa5",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
