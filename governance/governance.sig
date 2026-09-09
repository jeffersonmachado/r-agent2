{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "66cdfb6d5971e50eb4a25b558f8eacb3e1c013242c3d77be47180f797cbac2b5",
  "chainRoot": "66cdfb6d5971e50eb4a25b558f8eacb3e1c013242c3d77be47180f797cbac2b5",
  "gitCommit": "4bcb9c90098199a6982783f950af856f6ebc1ef3",
  "timestamp": "2026-09-09T12:55:16.254Z",
  "seal": "2871026124f7015cb3d2757a14561b2d4ba40278c5b6160d86e166381d3f4c58",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
