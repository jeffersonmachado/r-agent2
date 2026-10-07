{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "8a5ff14900e77d8fd8385b05095a922087a218f418b7fb4ea76dc77074717cd7",
  "chainRoot": "8a5ff14900e77d8fd8385b05095a922087a218f418b7fb4ea76dc77074717cd7",
  "gitCommit": "b6a58e7bc24e33f9f3c374d11a600097a962c199",
  "timestamp": "2026-10-07T10:51:07.086Z",
  "seal": "98fedcad4b12fa772aec4ffbbb009008e9e6f8f59f8ec2179e59f71d8aaf883c",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
