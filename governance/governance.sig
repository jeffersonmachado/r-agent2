{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "3fd3f41366bf35b1150ec42e98822218e29086056f0efb73b21695718520a378",
  "chainRoot": "3fd3f41366bf35b1150ec42e98822218e29086056f0efb73b21695718520a378",
  "gitCommit": "044962f1e6d2e22e54ccc83f8a0a713a98043cda",
  "timestamp": "2026-09-13T17:14:37.263Z",
  "seal": "0fa4aa17040877f355e8852f6aa2e6e2c65fb6c18a73ae3e41e9b522f1340d3c",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
