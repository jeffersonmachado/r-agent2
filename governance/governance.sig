{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "0a45da97d54f5c64a93b45da5d77b4ad5b1827119e17672882cf999a89821c08",
  "chainRoot": "0a45da97d54f5c64a93b45da5d77b4ad5b1827119e17672882cf999a89821c08",
  "gitCommit": "6459bc559ea39d4d0d6d4de9e843a7b072021338",
  "timestamp": "2026-09-07T20:34:29.787Z",
  "seal": "acc229f4b4017dd154f88ad3b69b822c703f2488843e018545b3db5064f5c31c",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
