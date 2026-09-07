{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "aff10ad27c5ff62c5620e5ed65d0055a2e10ba707c3dcc2afabd9d68cc2a29f8",
  "chainRoot": "aff10ad27c5ff62c5620e5ed65d0055a2e10ba707c3dcc2afabd9d68cc2a29f8",
  "gitCommit": "7e00475916447d247bf68cf2e42f6ee9fbe8b837",
  "timestamp": "2026-09-07T22:01:27.758Z",
  "seal": "d0940661e76f56e1913e7d5801b55681d24bb6dbf4b3c6d8a392b17994d13c6b",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
