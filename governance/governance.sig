{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "ed924c9ae72c41869dfd945d6e365613f68e5e7a087ecbcf67d5647e260dac6a",
  "chainRoot": "ed924c9ae72c41869dfd945d6e365613f68e5e7a087ecbcf67d5647e260dac6a",
  "gitCommit": "25ded7bbe8e96a0dfcadf4735d4127318c59f478",
  "timestamp": "2026-09-11T09:28:40.622Z",
  "seal": "9b43533e1defa96d884aa7168862ee952ca9b3de55ca22a5ccd95bdf7ea386c9",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
