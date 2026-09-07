{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "2682d535087b472d972bdb80f127e208631a64170eca4bb15720005da0f07e05",
  "chainRoot": "2682d535087b472d972bdb80f127e208631a64170eca4bb15720005da0f07e05",
  "gitCommit": "162fe357090f80f475835538e2428f9f063d2463",
  "timestamp": "2026-09-07T12:22:10.578Z",
  "seal": "2a963b42f84bb8baf6f095fecd9e1db8c374212355384211131726d3713aacb4",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
