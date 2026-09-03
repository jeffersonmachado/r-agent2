{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "2be73d5ee2ed40850a335522a0ff4be85deaf240592a5a4d7f870b9551024efa",
  "chainRoot": "2be73d5ee2ed40850a335522a0ff4be85deaf240592a5a4d7f870b9551024efa",
  "gitCommit": "d4e61d9079435d15063b168a810dee2db861b8e0",
  "timestamp": "2026-09-03T20:07:27.444Z",
  "seal": "4f45ebc0f668495faffd1f9c3b81e8e25d340f7700da0a66389b4815448564c6",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
