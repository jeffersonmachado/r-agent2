{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "6aeb21145060952a90f5a7996bb71e0dd250ecaa715b9bb76ec0e85e3e144ea1",
  "chainRoot": "6aeb21145060952a90f5a7996bb71e0dd250ecaa715b9bb76ec0e85e3e144ea1",
  "gitCommit": "c80a45b95b9ac6889b2ec054de761c9fad217f59",
  "timestamp": "2026-09-01T12:02:36.388Z",
  "seal": "9d654ed8cddfc4f409a30baed12192cced8690a504ebb732aecda071d0c22d85",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
