{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "70292d9ae15203b392207a8fc3d11c40cc71c3c8e5c89f5b76a92c518bf0537d",
  "chainRoot": "70292d9ae15203b392207a8fc3d11c40cc71c3c8e5c89f5b76a92c518bf0537d",
  "gitCommit": "2ae79a098d3554c2178658aae2eacbcf7ccf50a2",
  "timestamp": "2026-09-15T02:55:26.523Z",
  "seal": "1de2eafbcc334a919abe04ada326f0db90e41c9b2647357a2d3a1196908984cd",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
