{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "825e200727ece979bc1485a51561289e7d21179ec979cf979d5987ca569bacb0",
  "chainRoot": "825e200727ece979bc1485a51561289e7d21179ec979cf979d5987ca569bacb0",
  "gitCommit": "bbc233725471e2b70ed96d6d4387fc62f439e905",
  "timestamp": "2026-09-14T16:10:23.903Z",
  "seal": "2de6af87b76008cebe409cd74a27ba6dd8f2660fd177f762d20c51c0852a1145",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
