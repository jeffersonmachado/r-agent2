{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "080915a9d07492eceec4c46a9b1c7a0f4013f304dbf8febec93e57fe5828750b",
  "chainRoot": "080915a9d07492eceec4c46a9b1c7a0f4013f304dbf8febec93e57fe5828750b",
  "gitCommit": "3ae333f5cc231a4e83cc10b81c0febb1b301805e",
  "timestamp": "2026-09-13T22:03:23.635Z",
  "seal": "6c9d7dc2c3387ce30c1a365b333ad5b7348f992363b7c7b812cf42fe3c804cbe",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
