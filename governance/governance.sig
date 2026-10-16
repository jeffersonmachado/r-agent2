{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "105771e71e6fca88ceb78510acaa4bf27ef0f0994049258cc0f444cd624010cd",
  "chainRoot": "105771e71e6fca88ceb78510acaa4bf27ef0f0994049258cc0f444cd624010cd",
  "gitCommit": "e0ddb6beba36001598ba3dd61fdbb41d46f3f49c",
  "timestamp": "2026-10-16T16:18:32.258Z",
  "seal": "4aafc1b1b3ce0f33fe865f5b872fd14db2b4306f3cdc1132c84f2243095a88dd",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
