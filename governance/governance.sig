{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "ecfe6ac357ffd3cd5b0952e6596af2883e1568982e3cd47e467c75e9a7097a49",
  "chainRoot": "ecfe6ac357ffd3cd5b0952e6596af2883e1568982e3cd47e467c75e9a7097a49",
  "gitCommit": "39747fa42801ae77368bf8173e3254dad554fde6",
  "timestamp": "2026-09-01T17:06:45.465Z",
  "seal": "182ae80d194930407d371773999b84f116f1b9dc95be3f463523184a2b133ee1",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
