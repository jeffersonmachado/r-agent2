{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "002c9b6f721331a51c113adc14d41593a7ce6c46bf776fa90b7e68f98cb9e1d2",
  "chainRoot": "002c9b6f721331a51c113adc14d41593a7ce6c46bf776fa90b7e68f98cb9e1d2",
  "gitCommit": "d75bea81f6ee09008f44f38dc512beabf7a0f284",
  "timestamp": "2026-09-07T09:15:13.859Z",
  "seal": "056dc9e0ed0cb24fdae1780dd568ea908e2330c927286b79ed16adecad1cf4ab",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
