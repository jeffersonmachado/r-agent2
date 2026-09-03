{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "ab2df0f4f2ba17f655e7f1fdbd73dae2acca31117ea3132c38c49e9c488d0320",
  "chainRoot": "ab2df0f4f2ba17f655e7f1fdbd73dae2acca31117ea3132c38c49e9c488d0320",
  "gitCommit": "516c5beb165d6aa22e9cdb13b0f77b09211ae798",
  "timestamp": "2026-09-03T20:30:28.766Z",
  "seal": "7de18be57f0488bb2d53875d68ecc82b5a5e5752f6aec0d52bd58e2fc71a05b8",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
