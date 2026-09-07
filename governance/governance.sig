{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "da09d25b269ef84f39478ddae6e9dfd91ef4a6de65cad662384187ae51ae6013",
  "chainRoot": "da09d25b269ef84f39478ddae6e9dfd91ef4a6de65cad662384187ae51ae6013",
  "gitCommit": "4fffb704066e7ce16f59e87c006dbf6d43bf78b5",
  "timestamp": "2026-09-07T21:56:18.502Z",
  "seal": "b27cd6219ffc0119c0d7c5a5e5d9ffe2f9bb6162086c8474f63ba5ac0d99ff1b",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
