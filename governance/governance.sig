{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "f2dd993b37ac2c653cae9c2acfc3e5161838915b8902902259cc988ef00bc0fb",
  "chainRoot": "f2dd993b37ac2c653cae9c2acfc3e5161838915b8902902259cc988ef00bc0fb",
  "gitCommit": "ff9c6677171a20f4fa5fa466658b32bd853a8bfa",
  "timestamp": "2026-09-07T21:06:09.017Z",
  "seal": "18a4e5565bae9b6ba4b1ddbc2fca10b3d2c51b55f4c0901cdfabc21a3576b7ea",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
