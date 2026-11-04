{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "38e14a6d5ee9919d99bf5db9f5e436d73a7443b13943dbbfa5aad51ae7121f77",
  "chainRoot": "38e14a6d5ee9919d99bf5db9f5e436d73a7443b13943dbbfa5aad51ae7121f77",
  "gitCommit": "9cb71a1a419061ca61259105dba81c377502d32c",
  "timestamp": "2026-11-04T16:56:44.520Z",
  "seal": "c424050db1e88736e11dbd29f90c2fd0cff483912fca0c25a5bb7d948804f7ce",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
