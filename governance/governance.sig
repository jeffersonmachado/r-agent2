{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "a16329e37a2c9cdf9bb2ce87d0b0bfc2e86fdefbbdc68cdf9463c94ff6f16eac",
  "chainRoot": "a16329e37a2c9cdf9bb2ce87d0b0bfc2e86fdefbbdc68cdf9463c94ff6f16eac",
  "gitCommit": "90357251c8f4b037871bdabe0f8e2a05db11740f",
  "timestamp": "2026-09-03T15:47:02.125Z",
  "seal": "6d77c9d2758a1f3785b3047d01a76a12045fc8d6279facc78c30b6747cf16da0",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
