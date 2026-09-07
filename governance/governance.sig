{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "6c0dd54c942316f8394c703b76c833c10a1045e33e79f22da201841394e5577b",
  "chainRoot": "6c0dd54c942316f8394c703b76c833c10a1045e33e79f22da201841394e5577b",
  "gitCommit": "bdbb43287c8726d076478398338faf3a4fb859c4",
  "timestamp": "2026-09-07T12:18:20.515Z",
  "seal": "f5e08d1cfab45c2457d1652a9a3b841964ace9c966e26c6f852d473e91bf7301",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
