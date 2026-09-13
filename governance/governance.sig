{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "996a3e25e910c2f05d4097c2436eedaaa78c2ac138f57f05d363a9f6794fbc6c",
  "chainRoot": "996a3e25e910c2f05d4097c2436eedaaa78c2ac138f57f05d363a9f6794fbc6c",
  "gitCommit": "c05ad6804f008cb895997dc338bc7c2a3b9b3a95",
  "timestamp": "2026-09-13T17:48:08.491Z",
  "seal": "2092d76744870e1d4daf6d791ed10458135895bccd017add89d2e993c195abfa",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
