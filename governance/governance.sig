{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "c3b9c27415502ace0928324dcc266535b019a386bf80bd7dc29f1dfb481adc30",
  "chainRoot": "c3b9c27415502ace0928324dcc266535b019a386bf80bd7dc29f1dfb481adc30",
  "gitCommit": "5a916e6a4d5ac8da81a457454f33ad7f9cc1dcf3",
  "timestamp": "2026-09-17T18:15:47.329Z",
  "seal": "6b26976ad987ba1d071d6a7cb62e6cdecbd1791e32fcbb36d5d0b0d5eb8f5ed6",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
