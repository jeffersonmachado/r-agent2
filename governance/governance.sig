{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "de84b267fc2eb7a60e6969bbf84f47dc00b4b72b014bdadab7a0fadbb365463e",
  "chainRoot": "de84b267fc2eb7a60e6969bbf84f47dc00b4b72b014bdadab7a0fadbb365463e",
  "gitCommit": "eae4c0d98fe874509ba27c3e7760e649056168e7",
  "timestamp": "2026-09-06T18:13:06.376Z",
  "seal": "203b6ecb6d5cd0ecd344e740a896a7e6a44bdb2339dc5d5930c4dc0122fde7b3",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
