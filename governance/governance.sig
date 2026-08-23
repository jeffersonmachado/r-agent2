{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "d031322f5d35208fa8f3b4a8e22dcd20ed69035c29abef41342782dafaa70558",
  "chainRoot": "d031322f5d35208fa8f3b4a8e22dcd20ed69035c29abef41342782dafaa70558",
  "gitCommit": "ba4583db",
  "timestamp": "2026-08-23T20:34:06.611Z",
  "seal": "9bb93296a41cfcf176e88c10a3489778e46672bb746f8285335b34772ab2d8a8",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
