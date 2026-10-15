{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "683eabd07598ae6e2ca2eb0d1a60652052d4abaa153fcc73f5f69ae4e997a931",
  "chainRoot": "683eabd07598ae6e2ca2eb0d1a60652052d4abaa153fcc73f5f69ae4e997a931",
  "gitCommit": "759cc626921a09f174e6a2c05f71698433b26597",
  "timestamp": "2026-10-15T18:48:15.105Z",
  "seal": "ba5f04122665417c00dcede68f81b90e44d3147101d4f16aed1051a413869665",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
