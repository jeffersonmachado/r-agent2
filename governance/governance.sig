{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "88855a3c11f765b5f0b8b0b24405d3889dc11c5661723745a9197ca2df708683",
  "chainRoot": "88855a3c11f765b5f0b8b0b24405d3889dc11c5661723745a9197ca2df708683",
  "gitCommit": "2b86b14d6ab0eb32b9e06c448563e81d49af70fd",
  "timestamp": "2026-10-11T05:05:11.863Z",
  "seal": "c42ca82c7f65f6209b37362b131dda64bb92d118572713824c11433b33001067",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
