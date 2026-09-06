{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "7e2a09b91a466b23a260890c9780dc2e5b7a3a2370c42569db6b3b7848722777",
  "chainRoot": "7e2a09b91a466b23a260890c9780dc2e5b7a3a2370c42569db6b3b7848722777",
  "gitCommit": "80f0bbff793982367dd4985fc038c6a55284a3a1",
  "timestamp": "2026-09-06T17:11:24.927Z",
  "seal": "cb22b87a3204f10923d4dbc05929df231f66cc9f70566de66d68fabae24cc1e5",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
