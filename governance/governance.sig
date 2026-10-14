{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "628fbddffc47b739c2857d43607b66230103f2116028a03cc70eefcd831dba79",
  "chainRoot": "628fbddffc47b739c2857d43607b66230103f2116028a03cc70eefcd831dba79",
  "gitCommit": "6213c94de221ab568a1d202bc2851f47b438c768",
  "timestamp": "2026-10-14T06:04:23.952Z",
  "seal": "877d9a9b252022b0fd600fa78e4a35a4e4077a6cbc072f70277c97110c0abe87",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
