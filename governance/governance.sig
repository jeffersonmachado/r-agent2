{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "061c2593225bb90adb7ab88247de6a231ebb4b911af8a1801f7b23613a952d17",
  "chainRoot": "061c2593225bb90adb7ab88247de6a231ebb4b911af8a1801f7b23613a952d17",
  "gitCommit": "b9e900c51d069ebea1ba63dcb6ab136c08adc086",
  "timestamp": "2026-09-04T19:05:57.403Z",
  "seal": "f8907f4528d48a64df21fd83eda14b9cba76e7cfd8a4647452940e3a38aaa43b",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
