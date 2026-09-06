{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "2006abdfef4b519023430327122834d5ce8b5bb746c0842c33c975fbda8e2342",
  "chainRoot": "2006abdfef4b519023430327122834d5ce8b5bb746c0842c33c975fbda8e2342",
  "gitCommit": "3cd4331ab323e07ee362334556e42c3fa8755f23",
  "timestamp": "2026-09-06T20:29:23.590Z",
  "seal": "77108287083f5d62e18310655eb0668996efa8216d8fdf3702c9b0d428ef6782",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
