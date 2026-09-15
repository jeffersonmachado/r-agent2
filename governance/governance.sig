{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "66718c3f5c8f0b2be82fd4354adc2fe8f466389de95e7fdc414c6dc55d31d11c",
  "chainRoot": "66718c3f5c8f0b2be82fd4354adc2fe8f466389de95e7fdc414c6dc55d31d11c",
  "gitCommit": "df89e6b500fb16312e70f244dfa0271f34e1e729",
  "timestamp": "2026-09-15T22:12:45.163Z",
  "seal": "26801fea5a4e52467be27c917bc70acff73f21b7d1c3b036cfbd191ad44e192e",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
