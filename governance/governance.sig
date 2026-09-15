{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "c34b9fcf2fe5a384bb120040a4f73638bd283d9a7493c65bc7d6e4a94d83fed8",
  "chainRoot": "c34b9fcf2fe5a384bb120040a4f73638bd283d9a7493c65bc7d6e4a94d83fed8",
  "gitCommit": "28a1602797de71731ccd405f4d63561682b5ba51",
  "timestamp": "2026-09-15T03:15:31.181Z",
  "seal": "18fdb0a8395a1f9dbec3f083484bf1cb224f1b005b9607d500b873ec54e7ed80",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
