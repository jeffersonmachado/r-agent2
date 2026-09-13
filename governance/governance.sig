{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "662b36ef89346bfe17630352b63eca44817d53a7e1b4e4c0130092c06e2ad414",
  "chainRoot": "662b36ef89346bfe17630352b63eca44817d53a7e1b4e4c0130092c06e2ad414",
  "gitCommit": "b3def0c7fadc221c83cfdbe1503f92d272a5bf04",
  "timestamp": "2026-09-13T20:11:57.959Z",
  "seal": "fde85d3c0ae549ba4458718e4c2d929d5ff36c0e0e663b0ad530cc582dac97ff",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
