{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "f924e066c9b0ecedbff96007f41ac14068e668c24aa45fc493cad9b1c28a0d36",
  "chainRoot": "f924e066c9b0ecedbff96007f41ac14068e668c24aa45fc493cad9b1c28a0d36",
  "gitCommit": "8f8a3e79db3abfab92d77f8720125a7d61b70af6",
  "timestamp": "2026-09-14T03:13:42.990Z",
  "seal": "d672a7adf44558c479b042e38af600a5357536d5b78cdbd1bccbc1e5e171ab9c",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
