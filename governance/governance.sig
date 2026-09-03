{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "8b45fe9225b75dc5124a6475da5e4329e8083748ccb80a3d9a6e4960bc8d0911",
  "chainRoot": "8b45fe9225b75dc5124a6475da5e4329e8083748ccb80a3d9a6e4960bc8d0911",
  "gitCommit": "5953eefcfc32038e8447e0b3b10395728e8191cd",
  "timestamp": "2026-09-03T15:06:53.785Z",
  "seal": "7825a8a4b5f4e6cf1459beacea65aa6b33414414628e822739578988155d1069",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
