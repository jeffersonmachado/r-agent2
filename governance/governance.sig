{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "82ca2ed9f9f16de61bbfa3957756b11190aec3fd7111f71d2d76274859120c97",
  "chainRoot": "82ca2ed9f9f16de61bbfa3957756b11190aec3fd7111f71d2d76274859120c97",
  "gitCommit": "ac094240e5049e596a1634e6e5cbe8d0be2ac8c6",
  "timestamp": "2026-09-18T15:09:53.689Z",
  "seal": "11f4bd61b25c725cbb7bd8cab160b77b0de01ba6bf2e5fd8d482ebb5161b13b6",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
