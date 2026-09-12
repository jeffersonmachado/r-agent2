{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "beaaa822638ddfe9844585b7bd638a11e9f0371c81f089076af52baf13d43395",
  "chainRoot": "beaaa822638ddfe9844585b7bd638a11e9f0371c81f089076af52baf13d43395",
  "gitCommit": "6d0590b10deece230dbec145bbcbeb6e18bc26c4",
  "timestamp": "2026-09-12T04:13:20.428Z",
  "seal": "47eccc96dd23661b43a6fc763b5ae5d97d0481897038dc0e26d3622004bec4a1",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
