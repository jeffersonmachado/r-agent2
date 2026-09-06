{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "63a1a81cae12a68bbccba200b14c52a809183e102204dc1b9fb22dab9c4c31e5",
  "chainRoot": "63a1a81cae12a68bbccba200b14c52a809183e102204dc1b9fb22dab9c4c31e5",
  "gitCommit": "3c2a550e0c8dc7f866b37a21906f202c1606b83a",
  "timestamp": "2026-09-06T15:29:06.660Z",
  "seal": "33d0a2605cc904ea9f667802616cdc424a7d91ed63445c3e7fbdac329855175d",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
