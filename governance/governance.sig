{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "a36038c95c3c5527aa21c632c9fe5794f593458dfbb2c58dbfc32a4a20d7303c",
  "chainRoot": "a36038c95c3c5527aa21c632c9fe5794f593458dfbb2c58dbfc32a4a20d7303c",
  "gitCommit": "2642e4a14f98ab28f85dd7fb71c7c47ba4a10c23",
  "timestamp": "2026-09-07T11:40:46.621Z",
  "seal": "29d7119151b00ab0205468d7b056e3bbdf1f3452d8d02b6212231a5f343098a6",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
