{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "20f9de882b207845cafd15504dcc78d732d3419661917d5371e00289caca5aab",
  "chainRoot": "20f9de882b207845cafd15504dcc78d732d3419661917d5371e00289caca5aab",
  "gitCommit": "0e7f3b86f8c88201243528c9363330d3d78434ba",
  "timestamp": "2026-10-02T05:39:36.964Z",
  "seal": "74ff09a8e80b2615fc3f4987e716baf81daab938afa0d3746c783e759fa02914",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
