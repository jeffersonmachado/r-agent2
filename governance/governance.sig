{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "0faec0c2dd8bae901a5201da3e5b561f9ff66757958a52e89ab62c648c4f7826",
  "chainRoot": "0faec0c2dd8bae901a5201da3e5b561f9ff66757958a52e89ab62c648c4f7826",
  "gitCommit": "0046c833",
  "timestamp": "2026-08-22T12:52:57.692Z",
  "seal": "9f205e83e34012e4a3ed61539bef982ad6c9c02a24b3e1a9a2c40c51a57682f3",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
