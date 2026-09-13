{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "ae2c6158c5512572546c69cbe2afacdded33c34b2250496ffaad61953fec7fcf",
  "chainRoot": "ae2c6158c5512572546c69cbe2afacdded33c34b2250496ffaad61953fec7fcf",
  "gitCommit": "df15ef3375a493743d095ae206ea734e1e39f37f",
  "timestamp": "2026-09-13T21:05:42.030Z",
  "seal": "fba7da1d8ec8bc220c63e3164b5db51df99086bd4601bdeb861ea1c88f2fcd24",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
