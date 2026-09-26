{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "9ac5435521470ac60522610d8fcdffa9fc7e9e21b240001b621a3757959c892e",
  "chainRoot": "9ac5435521470ac60522610d8fcdffa9fc7e9e21b240001b621a3757959c892e",
  "gitCommit": "614714368781b434dddedc213c53b38a304bfe75",
  "timestamp": "2026-09-26T10:51:32.396Z",
  "seal": "c4bb446d69749fcbe85640ccd006385a135739827a97b1e01922db3237ee8a6b",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
