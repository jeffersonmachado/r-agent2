{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "6ec7338605ac15e599d2da4dff0e4f754913d3af726fdc656f487b1769615579",
  "chainRoot": "6ec7338605ac15e599d2da4dff0e4f754913d3af726fdc656f487b1769615579",
  "gitCommit": "1820c100de2adfb89507aa17abdf4e7f42b83c69",
  "timestamp": "2026-09-15T02:59:23.558Z",
  "seal": "43ac56b031ca9f2354fac945114bc83222c56474237eed4a1eb0afc278fa8e19",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
