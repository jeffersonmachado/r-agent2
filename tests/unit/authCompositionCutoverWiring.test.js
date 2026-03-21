'use strict';

const fs = require('fs');
const path = require('path');

describe('auth composition cutover wiring', () => {
  test('registerRoutes delega auth para composition root', () => {
    const registerRoutesPath = path.join(process.cwd(), 'api', 'app', 'registerRoutes.js');
    const source = fs.readFileSync(registerRoutesPath, 'utf8');

    expect(source).toMatch(/createAuthExpressRouter/);
    expect(source).toMatch(/const authRouter = createAuthExpressRouter\(\)/);
    expect(source).not.toMatch(/buildAuthRouteDeps/);
  });

  test('composition auth injeta dependencias e usa modulo auth', () => {
    const compositionPath = path.join(process.cwd(), 'api', 'composition', 'auth', 'index.js');
    const source = fs.readFileSync(compositionPath, 'utf8');

    expect(source).toMatch(/createAuthRoutes/);
    expect(source).toMatch(/authLogin/);
    expect(source).toMatch(/loginWithRpaToken/);
    expect(source).toMatch(/validateToken/);
    expect(source).toMatch(/authLogout/);
    expect(source).toMatch(/logoutAllSessions/);
  });
});
