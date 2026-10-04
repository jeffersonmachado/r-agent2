{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "9ac124205ed2fbd0ebcbb3b4a6a5f1f728a26f587d11e6942e1b9353494c8e84",
  "chainRoot": "9ac124205ed2fbd0ebcbb3b4a6a5f1f728a26f587d11e6942e1b9353494c8e84",
  "gitCommit": "5add308a192abfacc75d549f482cf2fdb17e16a0",
  "timestamp": "2026-10-04T17:06:32.916Z",
  "seal": "01310797a97b2701600f5d8162d05ba155220f00fa0b26f5e45f1bc1a64127c9",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
