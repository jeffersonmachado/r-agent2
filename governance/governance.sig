{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "44528b473bed3723dd4b9f1373c1cf35d17719e6d03bdfb1a3e2fec3593c25bc",
  "chainRoot": "44528b473bed3723dd4b9f1373c1cf35d17719e6d03bdfb1a3e2fec3593c25bc",
  "gitCommit": "6fad56a3bc39c833675ec73770d6451078a0cc79",
  "timestamp": "2026-09-07T04:31:09.055Z",
  "seal": "d67f9d719ef29949bc4d3fe1974c3087e93f6a2bed991c968bd0cdff2d8dcdf3",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
