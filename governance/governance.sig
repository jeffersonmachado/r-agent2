{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "0499e536ad57b5acf4b63b4fc0d00474b30885fb1c86b2b445b06100ea85af5a",
  "chainRoot": "0499e536ad57b5acf4b63b4fc0d00474b30885fb1c86b2b445b06100ea85af5a",
  "gitCommit": "e7b76880495cdf367f1137316616d45a0672ffad",
  "timestamp": "2026-09-15T11:48:26.070Z",
  "seal": "b74e56fac60608fd5802cf8e35029c98fc7fbec3a48955b8e72f9a9587bfae27",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
