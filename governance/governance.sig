{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "990508ea84be48c150eae2aa8d9910a68c10b6cab8dc752e78168f492b55a891",
  "chainRoot": "990508ea84be48c150eae2aa8d9910a68c10b6cab8dc752e78168f492b55a891",
  "gitCommit": "dc6b7fdec16a8f6f3835a38718c0b7b283b9cb93",
  "timestamp": "2026-09-24T00:22:22.779Z",
  "seal": "aebdb3d60133e56cf180a2b701807e11b6295d3787a0365463daa8df169054d6",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
