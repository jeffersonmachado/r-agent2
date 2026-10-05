{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "7959ccbb9778b810bf69c8b82f6a5ea97fc90dbde7a4666722077424a39ea0ca",
  "chainRoot": "7959ccbb9778b810bf69c8b82f6a5ea97fc90dbde7a4666722077424a39ea0ca",
  "gitCommit": "16d58b12e8423641f7eb23da825499734509bf74",
  "timestamp": "2026-10-05T04:57:44.706Z",
  "seal": "2d61ae8999132c9fb8612106b1a947a743160837a6c8573a32c826b0a47cbbff",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
