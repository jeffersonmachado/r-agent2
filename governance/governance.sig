{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "b19a2d37f7a32c813894ddf008031f48d703c473d505bbfef7ff8a290109e970",
  "chainRoot": "b19a2d37f7a32c813894ddf008031f48d703c473d505bbfef7ff8a290109e970",
  "gitCommit": "e38070bde238ec64f16e5d37d1ddbd9d968f0f54",
  "timestamp": "2026-10-13T20:29:04.385Z",
  "seal": "b965776d859193e956b36a841ef401bace5fd9c143bfd8b3c3dd8cd8650b11a4",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
