{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "9394a4791a7755f329e5c03779eb33281aefcec734265eecbf45cc80016eedad",
  "chainRoot": "9394a4791a7755f329e5c03779eb33281aefcec734265eecbf45cc80016eedad",
  "gitCommit": "7a1cf0e5ddc82789e70d871bda37101961f26263",
  "timestamp": "2026-09-26T14:54:38.622Z",
  "seal": "8d1775cf7fa02d3944a112b5055b987133e835002d0226d3358fa9c880904047",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
