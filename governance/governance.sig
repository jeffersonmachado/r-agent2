{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "cf44b244cd897d725b2acdb92cb49ce89b30d8c1a0035987d5ffcc0ab520afb7",
  "chainRoot": "cf44b244cd897d725b2acdb92cb49ce89b30d8c1a0035987d5ffcc0ab520afb7",
  "gitCommit": "84fc41e6ef091704cfc81bcfb024d394de1da510",
  "timestamp": "2026-09-18T14:17:09.084Z",
  "seal": "dfd97dcec7df62239f960a25f2690be8f79d5238a82e7a32c553afe1c94bb5fa",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
