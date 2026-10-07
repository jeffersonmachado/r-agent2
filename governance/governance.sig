{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "c67d22b8c75c5b83cd31f85f8dfc18c73b4968bc270552d8497a515e755d9fb3",
  "chainRoot": "c67d22b8c75c5b83cd31f85f8dfc18c73b4968bc270552d8497a515e755d9fb3",
  "gitCommit": "2176aefe67af668def43c31c9d875617194e409c",
  "timestamp": "2026-10-07T06:34:08.743Z",
  "seal": "2b9b52df3229c985cdcbc5fd283d9ce849714504d8b14e5549217f57d42e1fa3",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
