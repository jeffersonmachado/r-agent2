{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "0e572b1fb787cf3b25135d707c41257355c6885b56d610db8d4ab9537656d583",
  "chainRoot": "0e572b1fb787cf3b25135d707c41257355c6885b56d610db8d4ab9537656d583",
  "gitCommit": "91ef9db006680397e83c71fa47a8be5616cc7a9d",
  "timestamp": "2026-09-07T17:50:35.003Z",
  "seal": "a420ac6bf28bf1a89818836b1e5a604a6af186a853ba50370bba4127f1f1a157",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
