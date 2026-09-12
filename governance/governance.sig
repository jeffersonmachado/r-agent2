{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "63b26606f567a3d5c2b556a0a2ecf5ed06d5337f571a5e18397a1be72a806b14",
  "chainRoot": "63b26606f567a3d5c2b556a0a2ecf5ed06d5337f571a5e18397a1be72a806b14",
  "gitCommit": "ffb5eb9619bf02d270c9bfef85f5477a87f1db69",
  "timestamp": "2026-09-12T11:34:00.693Z",
  "seal": "fdf11c6ee6ef0b35b0576427399d1a8dc83b40904ea9d6bfa47a56b4e38c83c8",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
