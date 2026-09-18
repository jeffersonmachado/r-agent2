{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "0f13926615494a5c9f529fab7a6e8ab25ec567759f7b688fb836028e4720204b",
  "chainRoot": "0f13926615494a5c9f529fab7a6e8ab25ec567759f7b688fb836028e4720204b",
  "gitCommit": "3e6740952872f193f05e6e8bf26247263b41de6a",
  "timestamp": "2026-09-18T11:17:35.165Z",
  "seal": "2ab590aa53b20d3d2df48c35bbbbb82653750ad56d7cc0e4ba648a9e11b9b268",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
