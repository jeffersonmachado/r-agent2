{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "a2e54f2de054a3b6b360af9f8cfb959eee022ccc2997c029ae5a9564c8a9caec",
  "chainRoot": "a2e54f2de054a3b6b360af9f8cfb959eee022ccc2997c029ae5a9564c8a9caec",
  "gitCommit": "ea203571b98830e17be923c02461c4b6bf13442b",
  "timestamp": "2026-09-14T18:19:53.855Z",
  "seal": "132f30fa26aa9bad301099d1f8ee97b21df182f4c5182e6405cb1fca3dd8c0d9",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
