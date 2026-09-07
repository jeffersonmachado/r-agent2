{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "957a7c8e75d9decb5a6de36ee7b3339bd7df4e5d34c24048efdf5491f3217726",
  "chainRoot": "957a7c8e75d9decb5a6de36ee7b3339bd7df4e5d34c24048efdf5491f3217726",
  "gitCommit": "97fe1a56613b5ec4ce09a314ad408304d92288eb",
  "timestamp": "2026-09-07T15:48:17.405Z",
  "seal": "d859e8e8e6da54964a3b9f1ba279fed004f39b1737328d187535f0b4523f0dec",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
