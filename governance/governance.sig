{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "23988f182b04db04b910b37a2f6c28d6680a0519fe1d2131410634348fed70d9",
  "chainRoot": "23988f182b04db04b910b37a2f6c28d6680a0519fe1d2131410634348fed70d9",
  "gitCommit": "32fa2114a43ff995ea0f5b02bc7e0df0333e2ede",
  "timestamp": "2026-09-07T21:31:31.555Z",
  "seal": "ffff15b0fe884b6f50a603f31a04cba49048437c67bfd2b9a728f8ce51d8caa5",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
