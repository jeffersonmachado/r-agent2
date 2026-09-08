{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "47b4fe98b72330126dd99e5415a6cf148bb2429bf72b995bc414d7464fc0d5a6",
  "chainRoot": "47b4fe98b72330126dd99e5415a6cf148bb2429bf72b995bc414d7464fc0d5a6",
  "gitCommit": "6f4371f83ef74d69afe2116a68525a6778a2a5c6",
  "timestamp": "2026-09-08T13:32:51.809Z",
  "seal": "3176d4de308b937e93519c590fdab041f690efff440fc5081c958746dbfadc23",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
