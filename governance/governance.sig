{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "6a8ede35256ed87121e3d37d6c45bd8fbfe03161b872a1da95c5248ce511a01a",
  "chainRoot": "6a8ede35256ed87121e3d37d6c45bd8fbfe03161b872a1da95c5248ce511a01a",
  "gitCommit": "b6fe3001f4d52468c56b9b4d21bb58591dfd22f3",
  "timestamp": "2026-10-13T20:15:47.975Z",
  "seal": "f85fa811e9b4734b80bc0cee26ce609fec2824b1d60aad96a1b119745f2b5e55",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
