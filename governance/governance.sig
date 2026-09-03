{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "bfde529e380dd208b594308232fd52da63fd98d64f2c8aa8b643059182f4947c",
  "chainRoot": "bfde529e380dd208b594308232fd52da63fd98d64f2c8aa8b643059182f4947c",
  "gitCommit": "469d7ef5a766fd6895f2af120d4d45c4c1457c09",
  "timestamp": "2026-09-03T15:32:00.802Z",
  "seal": "469e765927c84159904cd86d6997d59f95268998ec101e8fc34e82ca4a42801f",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
