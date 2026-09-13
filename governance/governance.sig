{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "3051d7df7a6465cc07abad75100b33d3ac4ec16f65c892b8145232a090df6fc2",
  "chainRoot": "3051d7df7a6465cc07abad75100b33d3ac4ec16f65c892b8145232a090df6fc2",
  "gitCommit": "a0a58153799f36c0ad99fe9b4b038eb7844f1c42",
  "timestamp": "2026-09-13T20:05:18.164Z",
  "seal": "27a6dfeafd6f739e24ce67315cf173121befae4a8b1a033179c68cd0921d680d",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
