{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "3515ec71ab826b5855bc054b75eb5df7eadc9df3f156c10652acf130a4ab7825",
  "chainRoot": "3515ec71ab826b5855bc054b75eb5df7eadc9df3f156c10652acf130a4ab7825",
  "gitCommit": "49728e174d4fc92dbeba9aef8b3fb31f9596f4df",
  "timestamp": "2026-09-13T20:43:58.967Z",
  "seal": "97029bcaf591447c576f2123c1d81693e8c9c8005fc3c9c98d504b64dfa71486",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
