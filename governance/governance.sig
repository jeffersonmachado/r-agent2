{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "d90cce7417cb89e814cdf7fa3e79c8c32f6ec4428d85695d3024ff39df2c3c49",
  "chainRoot": "d90cce7417cb89e814cdf7fa3e79c8c32f6ec4428d85695d3024ff39df2c3c49",
  "gitCommit": "d61c26bee9ebd913ce3060da295c4799b410d1c4",
  "timestamp": "2026-09-18T01:02:28.857Z",
  "seal": "482c77a4f3296e8e113aaa6032ea3b6675cd1c0ba101c0f9ea2a7e7bfd3bccd4",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
