{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "d7d86b6bc6e5e94a2a58bb2e117ba7e27ff55a77d99c787eda6f5431f7135727",
  "chainRoot": "d7d86b6bc6e5e94a2a58bb2e117ba7e27ff55a77d99c787eda6f5431f7135727",
  "gitCommit": "d9f476043742ee99c368f03da327fd8dc26f2104",
  "timestamp": "2026-09-06T06:37:53.952Z",
  "seal": "a41b3db4b663cf931d3e667c02f6efd7b5c36956db308de8baf3ad2c687ae7cf",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
