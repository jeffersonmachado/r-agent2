{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "a524520a0b90d5924dd5464be3edbe69d488858c123118d982ee8618d735fb3f",
  "chainRoot": "a524520a0b90d5924dd5464be3edbe69d488858c123118d982ee8618d735fb3f",
  "gitCommit": "795b79e1be9d51c2da385d4417d41535d06d1e6b",
  "timestamp": "2026-09-26T14:25:38.473Z",
  "seal": "db9d8d931cd1d5c98582ac2b50cac96b320568819944b59796eac3c899003539",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
