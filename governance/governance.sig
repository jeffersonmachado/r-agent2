{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "37ab6c36e94c656aeccca21de6014db63b13d5fff85a01f5379fbcad34a45e63",
  "chainRoot": "37ab6c36e94c656aeccca21de6014db63b13d5fff85a01f5379fbcad34a45e63",
  "gitCommit": "bfda55c3f2d9c1b1457d8641247cc67cc39d96a0",
  "timestamp": "2026-09-07T21:01:36.169Z",
  "seal": "d2dd02088fba9e46ad0fc46ef5baa0a37b84a6e00714770da7a46299e297d3bc",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
