{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "a7df5d47726c15a96f3e34a8b0dd06fb3ee1d506edbfb650ec58b0fbadd1dcd5",
  "chainRoot": "a7df5d47726c15a96f3e34a8b0dd06fb3ee1d506edbfb650ec58b0fbadd1dcd5",
  "gitCommit": "f8deb745",
  "timestamp": "2026-08-23T18:00:13.534Z",
  "seal": "f90ff59eccf95d2d952e7504b82e4d5cf81045d6218f84e93ca96ce2052eac47",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
