{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "8c6cec6fbf1900e0c1ad35657dc874a2a0ff24024fbc70fb1129961481d19221",
  "chainRoot": "8c6cec6fbf1900e0c1ad35657dc874a2a0ff24024fbc70fb1129961481d19221",
  "gitCommit": "09afa9dd0f6a4323b1c4ca4c723b97eee3e7b7b3",
  "timestamp": "2026-09-06T08:33:02.373Z",
  "seal": "ab6424e89aaebaf02e5b7dfa69d216fcb2b20974c560955f51226814215de228",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
