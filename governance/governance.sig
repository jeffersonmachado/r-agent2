{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "daed2c0a6e900597e42c02e6786d474e06c74688fdf522631bcb6c4a51965bba",
  "chainRoot": "daed2c0a6e900597e42c02e6786d474e06c74688fdf522631bcb6c4a51965bba",
  "gitCommit": "bc36209369874bc9c53ae4e29d14e6b980c28905",
  "timestamp": "2026-09-04T12:44:38.190Z",
  "seal": "add3b717161ef363666ad6caa2ad016f08442e6fcc204e7c04078bd889ab96d1",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
