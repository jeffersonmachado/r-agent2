{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "161676b67068e55114fabd674b9ce4748d5a0e6bb6ba87ea726f673936ed8aac",
  "chainRoot": "161676b67068e55114fabd674b9ce4748d5a0e6bb6ba87ea726f673936ed8aac",
  "gitCommit": "609347cc9b1ea045d2db85ec1fd8bcd5dc5d1319",
  "timestamp": "2026-09-07T12:51:24.381Z",
  "seal": "40898d4ca419699943b1160c2f4486646cf5ae15965daede6dcc6b644533742e",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
