{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "214130629b22c305050d59f36be0f2e357de289c45631b388c84019249da0816",
  "chainRoot": "214130629b22c305050d59f36be0f2e357de289c45631b388c84019249da0816",
  "gitCommit": "0222279c7daf41f38b952e90072b6c55f71eeae8",
  "timestamp": "2026-09-09T09:15:40.950Z",
  "seal": "19447d3caa5bd5e5f84996e0f9f7b12b65651f05e82b085c25a16f36dee01931",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
