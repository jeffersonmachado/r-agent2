{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "52e85f48f80371616656976910e00962a445905633f33be8972ef7f00c638910",
  "chainRoot": "52e85f48f80371616656976910e00962a445905633f33be8972ef7f00c638910",
  "gitCommit": "7adb0e0e37dafcc324adeebe1f6b89128f28d6dd",
  "timestamp": "2026-09-08T13:38:39.635Z",
  "seal": "b40f3747ddd8b3151126628108459561b104bad8c1bc5a7fd538c27a092dc5ca",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
