{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "08cac6be870f031e499c91aa9e33f3e648bc54c76fec23332e86950000cf047d",
  "chainRoot": "08cac6be870f031e499c91aa9e33f3e648bc54c76fec23332e86950000cf047d",
  "gitCommit": "792995b6405459e58059249f12225ced035d1e75",
  "timestamp": "2026-09-06T10:30:39.893Z",
  "seal": "94a15a12a8620b80c8bd87780ae1c459f4fa58e2f7aae37164d6a62a9d6b2630",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
