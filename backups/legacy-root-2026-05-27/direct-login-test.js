#!/usr/bin/env node

const fetch = require('node-fetch');

(async () => {
  console.log('\n🔐 DIRECT LOGIN TEST\n');
  console.log('='.repeat(70));

  console.log('\n1️⃣ Making POST /auth/login from Node.js directly...');

  try {
    const response = await fetch('http://127.0.0.1:3000/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        username: 'systemadmin',
        password: 'Admin123!'
      })
    });

    const status = response.status;
    const data = await response.json();

    console.log(`   Status: ${status}`);
    console.log(`   Response:`);
    console.log(JSON.stringify(data, null, 2));

    if (data.token) {
      console.log(`\n   ✅ Token received: ${data.token.substring(0, 50)}...`);
    } else {
      console.log(`\n   ❌ No token in response`);
    }

  } catch (err) {
    console.log(`   ❌ Error: ${err.message}`);
  }

  console.log('\n' + '='.repeat(70));
})();
