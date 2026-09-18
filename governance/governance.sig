{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "adb9aa0ba18ebf76c7d00bc255c47b2bfafc4b22684f41b8fddf9b160ce0e303",
  "chainRoot": "adb9aa0ba18ebf76c7d00bc255c47b2bfafc4b22684f41b8fddf9b160ce0e303",
  "gitCommit": "2c6b00b76603c2143ed0ec81359c10a4b62243fe",
  "timestamp": "2026-09-18T16:22:16.024Z",
  "seal": "a66750a6269ba37e110c202b0f174c1d70bf3b9789408b281b220db51f79a9dd",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
