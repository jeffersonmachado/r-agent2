{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "3206dce656420f7ddfc1de359616f32d7ab3fbde19c0863679f6973f4963f3f2",
  "chainRoot": "3206dce656420f7ddfc1de359616f32d7ab3fbde19c0863679f6973f4963f3f2",
  "gitCommit": "fbb94fc93e395b10684cfc91775c1984014f9ccc",
  "timestamp": "2026-10-04T01:37:54.566Z",
  "seal": "6ec207e727088245835104f70f6d705639b89a8bb19ed9936e6c53a536266af0",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
