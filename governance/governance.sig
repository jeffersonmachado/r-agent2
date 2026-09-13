{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "fa5bf91402c4e77272be331a1c539ec3cb65b2ace31bc7216c879335017d8bb0",
  "chainRoot": "fa5bf91402c4e77272be331a1c539ec3cb65b2ace31bc7216c879335017d8bb0",
  "gitCommit": "f64f2657e216678790eb6257f081117b7e7fb591",
  "timestamp": "2026-09-13T22:09:31.858Z",
  "seal": "3c9f265650c116070edab1e8646655327f56c23ebf067d73bcb8c78deebb87e3",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
