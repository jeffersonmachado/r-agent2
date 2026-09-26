{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "7771a5b22bbaba55ca95960bb06125b2bc8c4c72ffe2d87bb1fedebbfbf6df01",
  "chainRoot": "7771a5b22bbaba55ca95960bb06125b2bc8c4c72ffe2d87bb1fedebbfbf6df01",
  "gitCommit": "61d0aeac16053ec383b890d647119b75ab9b8a49",
  "timestamp": "2026-09-26T14:41:13.140Z",
  "seal": "c92fe4cb8491dd88d49b47b395e51239d6d4c5d520cdf01eeccb3dea374dbfa7",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
