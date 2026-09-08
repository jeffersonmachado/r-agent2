{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "514fa60501cc7a0192d8840ea2ca432606d0a0dd73a1c3c7240d6477e0e68999",
  "chainRoot": "514fa60501cc7a0192d8840ea2ca432606d0a0dd73a1c3c7240d6477e0e68999",
  "gitCommit": "bcac616678ae7b6cd5cb0f516582902aa75a5294",
  "timestamp": "2026-09-08T12:03:43.791Z",
  "seal": "e262ba4f798105919bb7c1caa32fd960f3d10980df172196cbc2d8d4d5a77635",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
