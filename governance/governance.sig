{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "b0d6585a4d25acaae7fdaa29318fc1bcfc3a11cc99126888706cd4b0106d46ba",
  "chainRoot": "b0d6585a4d25acaae7fdaa29318fc1bcfc3a11cc99126888706cd4b0106d46ba",
  "gitCommit": "d40f65482106fdc998c0f2a77c007e746a00729d",
  "timestamp": "2026-09-06T23:36:35.275Z",
  "seal": "82f6d7322f15a730803c7109c98ea42c19c669f7133cc072bc99e9ed4e67d514",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
