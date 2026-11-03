{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "a913ad59586996236a5b5bc65a5d3694c0645b19f8930bd21c544e5b2e77c967",
  "chainRoot": "a913ad59586996236a5b5bc65a5d3694c0645b19f8930bd21c544e5b2e77c967",
  "gitCommit": "d3c3d1451e096fef28bb9125b78e6fe30edf94a0",
  "timestamp": "2026-11-03T10:08:29.766Z",
  "seal": "98037b542062ae998caf5dc9883ac515ee76b424bf0f3af7f34aca38889a2d49",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
