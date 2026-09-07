{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "e27ca87e5bb9dca8fc9dd4249c96da16914b11c881f56aa95257a35e21d7848d",
  "chainRoot": "e27ca87e5bb9dca8fc9dd4249c96da16914b11c881f56aa95257a35e21d7848d",
  "gitCommit": "0dc90213dbebb79a4c72af7aada641ce2270644f",
  "timestamp": "2026-09-07T04:35:30.808Z",
  "seal": "eae12b1a73a13903cb7dcdb8917a4e38a1ce1d98247ba09a08e17d8d3f7b4aed",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
