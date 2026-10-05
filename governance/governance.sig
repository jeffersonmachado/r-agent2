{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "d0fc05a055d8e8907ce15969bb4992af4d5f6a7c04e64974be9fe140ae1d9061",
  "chainRoot": "d0fc05a055d8e8907ce15969bb4992af4d5f6a7c04e64974be9fe140ae1d9061",
  "gitCommit": "7ed247ecb6d16104189f98e92ada59610c16ea1e",
  "timestamp": "2026-10-05T04:12:22.011Z",
  "seal": "7a465d8c37d1f16657169455695ca1ab25c8c67e0c008862dac87f299e456e37",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
