{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "179d2ad9a1b77f9e3b776d32ca91cf777d39fa77e2822d26c64baaf92502ed29",
  "chainRoot": "179d2ad9a1b77f9e3b776d32ca91cf777d39fa77e2822d26c64baaf92502ed29",
  "gitCommit": "189e74ed8deccd07d59adbda220e8ad2f37b4b20",
  "timestamp": "2026-09-29T08:23:52.208Z",
  "seal": "88c275df881f5159cc14a315d928c2b9ded7a52d5ff35af429adde19fb9b4d92",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
