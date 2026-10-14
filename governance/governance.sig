{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "b01bc6f14800a7db0246fade64dc77c8fb87549bdebb777f9bd4797dd8b5fc8d",
  "chainRoot": "b01bc6f14800a7db0246fade64dc77c8fb87549bdebb777f9bd4797dd8b5fc8d",
  "gitCommit": "1acf79acc9d39671f4b947acd7712eff6ef3970b",
  "timestamp": "2026-10-14T00:37:10.948Z",
  "seal": "2a88764168725a919679801e11aa591fdb135a85b4c0cfb4e915e88a045d1827",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
