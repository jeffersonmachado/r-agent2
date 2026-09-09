{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "0249a49cf6a933da232ca9088b36da15ee654849fab0d6a26987dab529912f3b",
  "chainRoot": "0249a49cf6a933da232ca9088b36da15ee654849fab0d6a26987dab529912f3b",
  "gitCommit": "9ea2603f4ed8abd43caeba492ca379e23907fd00",
  "timestamp": "2026-09-09T13:00:09.710Z",
  "seal": "3d1707edcb10fbd53c232ff8b9debf894eb320e4878e12201210d7763b20cb4d",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
