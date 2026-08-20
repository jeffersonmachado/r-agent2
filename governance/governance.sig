{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "d9b550e82ea151237f9341e818db9b7e51e60eb67bb7764c68cbbaa8529e1198",
  "chainRoot": "d9b550e82ea151237f9341e818db9b7e51e60eb67bb7764c68cbbaa8529e1198",
  "gitCommit": "916d133e",
  "timestamp": "2026-08-20T19:09:24.985Z",
  "seal": "dc468fd707d7411273f08c6a362a472ca1d6738c5198634753eaf390c2429940",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
