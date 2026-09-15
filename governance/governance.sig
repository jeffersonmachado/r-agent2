{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "d11e32878c8444770d250e5683fe828a165dce9b01c37b22a76476180510c063",
  "chainRoot": "d11e32878c8444770d250e5683fe828a165dce9b01c37b22a76476180510c063",
  "gitCommit": "7e9281b49abdcb8dc24dfafd13a1480b2cce2205",
  "timestamp": "2026-09-15T18:59:17.530Z",
  "seal": "f8cbcc1d2433ed69a6d828ea94c1203780d57f555d6e36d195cb5b2209944e9a",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
