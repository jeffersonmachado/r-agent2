{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "c7e1b5e2db21fc9e3baf856d77ccb19d5242e539a3790f6f6be4fa95663b9992",
  "chainRoot": "c7e1b5e2db21fc9e3baf856d77ccb19d5242e539a3790f6f6be4fa95663b9992",
  "gitCommit": "913649a082a266347b5becf43b0da0840bec1d62",
  "timestamp": "2026-09-18T14:08:26.223Z",
  "seal": "4c06b268b2b01c6561ae57c94463b3c20d2f84fdd8d34ad1b891ef49d107b97f",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
