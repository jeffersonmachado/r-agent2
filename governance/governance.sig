{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "49b065b28dad73367ee8c3b18d1e11e1fac603165cd69b9f132db2ab2797eef2",
  "chainRoot": "49b065b28dad73367ee8c3b18d1e11e1fac603165cd69b9f132db2ab2797eef2",
  "gitCommit": "6304bf51f10a1b15eb3082ade332e29d0c712280",
  "timestamp": "2026-09-03T18:21:12.587Z",
  "seal": "b643e881c31b34c11bac3dd622c583e46ece88708bfb10d9d9754da327e335c3",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
