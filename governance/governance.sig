{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "7b9d511ffd145e84b8b55f7653412b883714bf41b8272366fc70ac1ca59bc374",
  "chainRoot": "7b9d511ffd145e84b8b55f7653412b883714bf41b8272366fc70ac1ca59bc374",
  "gitCommit": "e0fe23fd96cab7a24f31497e61a5a90b4d9ec29d",
  "timestamp": "2026-09-12T01:40:50.059Z",
  "seal": "668af38ace41de60ffd1d3a4f60bed254a5cf07ed4da36de26e5a3693682b30f",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
