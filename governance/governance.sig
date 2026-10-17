{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "01575f228a367361a69f0adbed573e9fb2245377bba0953068a3d09abe7a9d70",
  "chainRoot": "01575f228a367361a69f0adbed573e9fb2245377bba0953068a3d09abe7a9d70",
  "gitCommit": "d9c469e677eee10fd998fefdf9f5a0d61c6d37a0",
  "timestamp": "2026-10-17T00:02:37.013Z",
  "seal": "67e4f7e88b42c9ecfc8c5efd9e0e2b69f37b3006b18765290cb616ccd5f5b635",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
