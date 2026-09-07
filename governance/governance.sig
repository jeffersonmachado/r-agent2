{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "60257ce1a83d1cbf72eea1da018d0a6f65529d656c5aadf86ded31c9492aef58",
  "chainRoot": "60257ce1a83d1cbf72eea1da018d0a6f65529d656c5aadf86ded31c9492aef58",
  "gitCommit": "c96a0fa541a0691132b678ccfa286beb56a960b2",
  "timestamp": "2026-09-07T03:32:04.056Z",
  "seal": "4db5c73516708629dfe0e684051e851998d3cdd5327c6251b9dff2929b3d09f4",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
