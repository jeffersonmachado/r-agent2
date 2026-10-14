{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "83da763d109ae0b0c758e2d39c320a9fcba08d96adf962bb6df1eeb689e32b52",
  "chainRoot": "83da763d109ae0b0c758e2d39c320a9fcba08d96adf962bb6df1eeb689e32b52",
  "gitCommit": "662b4e926f5682891422084ab580effcbb2d41f4",
  "timestamp": "2026-10-14T05:46:01.392Z",
  "seal": "f613b4d2281fbbbf9905606f10c671906bc9e9364e3aefa70d78f30a7ad0d95e",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
