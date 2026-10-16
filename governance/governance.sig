{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "0d60d6630c4cf53b9dc09d8e09679cff048edee8042194575606080f918b1f24",
  "chainRoot": "0d60d6630c4cf53b9dc09d8e09679cff048edee8042194575606080f918b1f24",
  "gitCommit": "4f7b3aab6f672471a0b474d678c098083ad717ce",
  "timestamp": "2026-10-16T05:55:40.805Z",
  "seal": "de99850514e55060944f5310420ac49a1c93705a218321239a164983a3a7bba1",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
