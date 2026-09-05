{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "e601217d792a6a39b609c64a295832c5b91bc831cd68be9498510e8296ea78d2",
  "chainRoot": "e601217d792a6a39b609c64a295832c5b91bc831cd68be9498510e8296ea78d2",
  "gitCommit": "e4b2c83fd1799d2799b03794e180cd56c4fa134f",
  "timestamp": "2026-09-05T19:39:45.585Z",
  "seal": "d9c679e0839a74d2f5fd04aacf2267b4b7fbc3f6c056b62891af2c9479b287d2",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
