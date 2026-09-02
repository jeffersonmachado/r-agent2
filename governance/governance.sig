{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "e3ffa84521b9403bfb53c92c39aef917595edca75b0ab5d870f263851fede290",
  "chainRoot": "e3ffa84521b9403bfb53c92c39aef917595edca75b0ab5d870f263851fede290",
  "gitCommit": "591ea47ee16409269c2c2bd1829889fb2657c743",
  "timestamp": "2026-09-02T12:40:12.510Z",
  "seal": "d82e3139feddac02e5b454f7f3d2a17494d74ee49427f5d030f8e70c445e70c4",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
