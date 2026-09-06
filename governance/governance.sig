{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "90a255661b6b58eb054b733cc51d4592ac968015b72e3f6e3a2abce014aa23de",
  "chainRoot": "90a255661b6b58eb054b733cc51d4592ac968015b72e3f6e3a2abce014aa23de",
  "gitCommit": "1bab00cb86273825ab029c3a9823a6c58c2e1366",
  "timestamp": "2026-09-06T08:55:20.739Z",
  "seal": "06e4a55830ea3d76d65c8aa6e5256100aac5a2e761c352205a3dac84ee722a26",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
