{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "a64915b2badd5cb422480b79a53319ae7efd328ea5152561e2125676818c7ef4",
  "chainRoot": "a64915b2badd5cb422480b79a53319ae7efd328ea5152561e2125676818c7ef4",
  "gitCommit": "91a25ec7061a8f8b74639de582631b7954de91da",
  "timestamp": "2026-09-11T17:00:24.646Z",
  "seal": "6fcdb1971333cc04a068d8a1866100937e5edb28a9f7a00a759896cf7c974aaa",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
