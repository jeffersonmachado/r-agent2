{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "259bea62d3685506291925d3b986cf2c1f7c954b0e64dd9e7825a78b4e062d68",
  "chainRoot": "259bea62d3685506291925d3b986cf2c1f7c954b0e64dd9e7825a78b4e062d68",
  "gitCommit": "0d05b139ae9de20c86b1723c3c878cf30674ea60",
  "timestamp": "2026-09-13T12:42:05.695Z",
  "seal": "33494dd313b04906fdbcdbc19d9226be0cc9e80aab5b78907d1f6727a277e879",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
