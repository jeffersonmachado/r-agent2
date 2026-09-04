{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "0f5a15e445db154c96efb5fcdc22c71435c71ac09df6f48f4486586ba383da60",
  "chainRoot": "0f5a15e445db154c96efb5fcdc22c71435c71ac09df6f48f4486586ba383da60",
  "gitCommit": "1cc3b4843cf5f63d261c71a1d36b31109ec1cbcd",
  "timestamp": "2026-09-04T01:30:15.141Z",
  "seal": "7821f59518a91147b52b94c4325f6b264ecb15f70261595d8696483c7b6ca1bb",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
