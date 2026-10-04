{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "ec3244a8a299d08d8bfae1badf01d111064b481ac1307d6d3ac57b176ef98a74",
  "chainRoot": "ec3244a8a299d08d8bfae1badf01d111064b481ac1307d6d3ac57b176ef98a74",
  "gitCommit": "517ad2549e1e18018a169916f8290130079eb47e",
  "timestamp": "2026-10-04T08:11:04.486Z",
  "seal": "8e229d3ec2fbc227a61a24ef382f8f41fbe47a5427e241bceb29b4a5cc512565",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
