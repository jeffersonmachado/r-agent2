{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "104f9d7927514cf2d621b1237ab47c8b58e09b2dbcc1fc56da76e207ba377daf",
  "chainRoot": "104f9d7927514cf2d621b1237ab47c8b58e09b2dbcc1fc56da76e207ba377daf",
  "gitCommit": "5b926b2e",
  "timestamp": "2026-08-23T21:22:56.712Z",
  "seal": "336f31695e965aa87da1b4a4f3ca63caad5e4dab4513ead2105b2ba27111c858",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
