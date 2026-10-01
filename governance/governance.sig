{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "3167359160856562a75bb5c0d2df328b0ee35f93c965dc5297b1967b347782fb",
  "chainRoot": "3167359160856562a75bb5c0d2df328b0ee35f93c965dc5297b1967b347782fb",
  "gitCommit": "692f9a79b8a4d0540f00ae3e28d8c84474035ea3",
  "timestamp": "2026-10-01T18:42:32.044Z",
  "seal": "d82397d67a2a6a0ce1a95be9273f2f7e961d48a92c8c6ad96aafacc7e275acce",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
