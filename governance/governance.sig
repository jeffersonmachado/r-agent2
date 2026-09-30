{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "fba310d0ad9e38e829360a46ad8ff54593098619d9f5e037d3df375e819c510c",
  "chainRoot": "fba310d0ad9e38e829360a46ad8ff54593098619d9f5e037d3df375e819c510c",
  "gitCommit": "7e16f8f7773ee8baa3ac924617e6d1ec6d9b4b01",
  "timestamp": "2026-09-30T03:17:14.854Z",
  "seal": "5b181644578c85007cc51344de443629bff8dd27d0259e81c42945469657e7ba",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
