{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "a6abebd962d67a11e1a8fc8c785748bc9252d43f4890f1deb6edb30d1764025d",
  "chainRoot": "a6abebd962d67a11e1a8fc8c785748bc9252d43f4890f1deb6edb30d1764025d",
  "gitCommit": "01b9e5334bf4d4879467d945f6c0ef6fe6378e88",
  "timestamp": "2026-09-07T21:51:04.364Z",
  "seal": "968df97001a74049bc14c3af01f78e14676f136b706493a027e6d9ff3f0d80ba",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
