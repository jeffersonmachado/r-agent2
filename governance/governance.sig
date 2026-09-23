{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "b8761bd3ffeb9a5fda01b35a4a2fbce6d3d42d38d463474c3af852e190481b8c",
  "chainRoot": "b8761bd3ffeb9a5fda01b35a4a2fbce6d3d42d38d463474c3af852e190481b8c",
  "gitCommit": "0e42bfb8ba540ac7054936180a8931381f9dbed4",
  "timestamp": "2026-09-23T23:36:27.075Z",
  "seal": "d984c7cb4c3c5304efe16ec6a8ebe91babf906ad427da6a241f2a006d4f2544a",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
