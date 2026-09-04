{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "cbad5e3fcffc2df2ff8bed10532c30190bdf5e9216e59e20f347deb0e4003de0",
  "chainRoot": "cbad5e3fcffc2df2ff8bed10532c30190bdf5e9216e59e20f347deb0e4003de0",
  "gitCommit": "c4d3767b1e69dfbb212cff8eb557798f3c4d5baa",
  "timestamp": "2026-09-04T12:27:47.588Z",
  "seal": "33b3d181831279e341652491ba48914f3ac04e26de6fbdd8f435238956956461",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
