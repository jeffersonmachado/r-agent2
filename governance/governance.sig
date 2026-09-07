{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "cf8292ce664c6488b97d66e28f54dfbe0b142295c288a5a9e652975f86fece52",
  "chainRoot": "cf8292ce664c6488b97d66e28f54dfbe0b142295c288a5a9e652975f86fece52",
  "gitCommit": "a917d5cd2f67168320d224595b82e1afc71d2f25",
  "timestamp": "2026-09-07T18:32:30.977Z",
  "seal": "5c4e680b1e44c2ee99654e812f6d9240567667cc1931e3c28831b155158f2f75",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
