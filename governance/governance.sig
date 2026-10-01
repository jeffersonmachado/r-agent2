{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "71e06f7bcd1e83eca9f1b417609abc550f233defb4e6e5509d036c083479164b",
  "chainRoot": "71e06f7bcd1e83eca9f1b417609abc550f233defb4e6e5509d036c083479164b",
  "gitCommit": "b9f376af03bd285217474df258bb1052d8c7b429",
  "timestamp": "2026-10-01T09:34:30.091Z",
  "seal": "edd9b8df3b2d947448a6742361b449a025d6bc641eb7a3047db11b6d0a71138f",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
