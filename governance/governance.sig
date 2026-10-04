{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "179f723defc9764078fc32f2a5c052a08637c8fa6d990a07409c8fb0918c8488",
  "chainRoot": "179f723defc9764078fc32f2a5c052a08637c8fa6d990a07409c8fb0918c8488",
  "gitCommit": "911310a917a5cd2c3e7537b1c4a2f84705847350",
  "timestamp": "2026-10-04T00:46:23.637Z",
  "seal": "728388d7fd53d6586109f8280f14ea9aef89b7c4775b3998faa3871d82918f1a",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
