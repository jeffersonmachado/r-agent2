{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "bf7f2c017565c7ad5b7c9f3bb4756a3bd0c970d528430db82262754aa7e974d5",
  "chainRoot": "bf7f2c017565c7ad5b7c9f3bb4756a3bd0c970d528430db82262754aa7e974d5",
  "gitCommit": "f20560de89dc92858d33029cf6e50e5af0df4ce9",
  "timestamp": "2026-09-06T21:55:34.994Z",
  "seal": "05ab635feddb1997081d7a0d5581579bcb2a1a8b678502990a6cec69abcb83b1",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
