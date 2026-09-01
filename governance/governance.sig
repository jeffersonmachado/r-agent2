{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "32950ec609ebfc73890f25de9eaf05c209ac9a41f549d726cc1de6d52f60ac68",
  "chainRoot": "32950ec609ebfc73890f25de9eaf05c209ac9a41f549d726cc1de6d52f60ac68",
  "gitCommit": "597110083c486c4a914786da7f8cdfc644dc019d",
  "timestamp": "2026-09-01T23:31:57.770Z",
  "seal": "f7d0d9bcc3ef10c491b0e7fb6000b2e02f3d05fddaaf24aee67462bc38b06ec1",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
