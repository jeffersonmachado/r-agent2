{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "80a3866b65bf3dcdcba49cbc3a9aa32eeccba417fc7d93392e4178cedad91abc",
  "chainRoot": "80a3866b65bf3dcdcba49cbc3a9aa32eeccba417fc7d93392e4178cedad91abc",
  "gitCommit": "c5af0d5a9fcb53c1511ac8af39a9da7560e1a2b4",
  "timestamp": "2026-09-06T10:34:41.658Z",
  "seal": "dbb2f2ff56b5b530aa43273ef90f83b2e8c3f6a563bb45d3975beceb82e1a348",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
