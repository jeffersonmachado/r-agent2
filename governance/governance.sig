{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "09ac21476d22a16763a7bc751c12ae2fce20aafadf4306b2a0e3996c92991ddc",
  "chainRoot": "09ac21476d22a16763a7bc751c12ae2fce20aafadf4306b2a0e3996c92991ddc",
  "gitCommit": "60b10423f5b62df29b88bb0968990c38a8d441b8",
  "timestamp": "2026-09-08T22:54:10.464Z",
  "seal": "90939f0bf731c4d740405d88047d9c77e680fbcae5ed317bafb375b0f62a5bd2",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
