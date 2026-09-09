{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "66cde85bc01484e12e08f10c7dce848836849845fe0a6319eaa65e189d06cd85",
  "chainRoot": "66cde85bc01484e12e08f10c7dce848836849845fe0a6319eaa65e189d06cd85",
  "gitCommit": "04ce05645d2fea7dd180d4c06f1bb0c3a8e7eb7c",
  "timestamp": "2026-09-09T03:52:23.933Z",
  "seal": "a59f0d00a6219165db1a036de5e89da30f8dc369b43ddeb78525ee3382d74f88",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
