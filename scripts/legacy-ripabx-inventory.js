#!/usr/bin/env node
/**
 * Constrói inventário do Ripabx-Web (legado) a partir dos dumps extraídos.
 *
 * Saídas:
 * - Markdown: docs/RIPABX_WEB_MENU_MAP.md
 * - JSON: docs/RIPABX_WEB_MENU_MAP.json
 *
 * Observação: este script é baseado em parsing de HTML/JS simples (regex) e
 * cobre o essencial (menu → páginas → endpoints → storage).
 */
const fs = require('fs');
const path = require('path');

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function exists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function parseArgs(argv) {
  const args = {
    menuPhp: path.resolve(process.cwd(), 'remote-dumps/ripabx-web-all-php/html/menu.php'),
    appDir: path.resolve(process.cwd(), 'remote-dumps2/extracted/ripabx-web-html-app/app'),
    outMd: path.resolve(process.cwd(), 'docs/RIPABX_WEB_MENU_MAP.md'),
    outJson: path.resolve(process.cwd(), 'docs/RIPABX_WEB_MENU_MAP.json'),
    write: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--menu-php') args.menuPhp = path.resolve(process.cwd(), argv[++i]);
    else if (a === '--app-dir') args.appDir = path.resolve(process.cwd(), argv[++i]);
    else if (a === '--out-md') args.outMd = path.resolve(process.cwd(), argv[++i]);
    else if (a === '--out-json') args.outJson = path.resolve(process.cwd(), argv[++i]);
    else if (a === '--write') args.write = true;
    else if (a === '--help') args.help = true;
  }
  return args;
}

function listFilesRecursive(rootDir) {
  const out = [];
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(p);
    }
  }
  walk(rootDir);
  return out;
}

function parseMenuPhp(menuPhpText) {
  // Captura links do menu no formato: <li><a href=<?php echo permissao("C","app/ramais.html");?> >Ramais</a></li>
  // Também captura alguns links diretos: <a href="app/rchatbot_man.html">R-ChatBot</a>
  const items = [];
  const permissaoRe = /<a\s+href=<\?php\s+echo\s+permissao\("([^"]+)"\s*,\s*"([^"]+)"\);\?>[^>]*>([^<]+)<\/a>/gi;
  let m;
  while ((m = permissaoRe.exec(menuPhpText))) {
    const [, perm, href, label] = m;
    items.push({ label: label.trim(), href: href.trim(), perm: perm.trim(), source: 'menu.php' });
  }

  const directRe = /<a\s+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
  while ((m = directRe.exec(menuPhpText))) {
    const [, href, label] = m;
    // filtra alguns links genéricos (logout etc.)
    if (!href.startsWith('app/')) continue;
    if (label.trim().length < 2) continue;
    items.push({ label: label.trim(), href: href.trim(), perm: null, source: 'menu.php' });
  }

  // Dedup por href+label
  const seen = new Set();
  const dedup = [];
  for (const it of items) {
    const k = `${it.href}||${it.label}`;
    if (seen.has(k)) continue;
    seen.add(k);
    dedup.push(it);
  }
  return dedup;
}

function extractEndpointsFromText(text) {
  const endpoints = {
    xmlViews: [], // { xml, xsl, raw }
    serverProgs: [], // { prog, raw }
    server2Progs: [], // { prog, raw }
    mysqlProgs: [], // { file, prog, raw }
    ura: { load: false, save: false },
  };

  const xmlRe = /xml\.php\?xml=([^&"']+)\&xsl=([^&"']+)/g;
  let m;
  while ((m = xmlRe.exec(text))) {
    endpoints.xmlViews.push({ xml: m[1], xsl: m[2], raw: m[0] });
  }

  const serverProgRe = /server\.php\?prog=([a-z0-9_]+)/gi;
  while ((m = serverProgRe.exec(text))) {
    endpoints.serverProgs.push({ prog: m[1], raw: m[0] });
  }

  const server2ProgRe = /server2\.php\?prog=([a-z0-9_]+)/gi;
  while ((m = server2ProgRe.exec(text))) {
    endpoints.server2Progs.push({ prog: m[1], raw: m[0] });
  }

  const mysqlProgRe = /(mysql[0-9]+\.php)\?prog=([a-z0-9_]+)/gi;
  while ((m = mysqlProgRe.exec(text))) {
    endpoints.mysqlProgs.push({ file: m[1], prog: m[2], raw: m[0] });
  }

  if (text.includes('ura_load.php')) endpoints.ura.load = true;
  if (text.includes('ura_save.php')) endpoints.ura.save = true;

  function uniqBy(arr, keyFn) {
    const s = new Set();
    const out = [];
    for (const x of arr) {
      const k = keyFn(x);
      if (s.has(k)) continue;
      s.add(k);
      out.push(x);
    }
    return out;
  }

  endpoints.xmlViews = uniqBy(endpoints.xmlViews, x => `${x.xml}||${x.xsl}`);
  endpoints.serverProgs = uniqBy(endpoints.serverProgs, x => x.prog);
  endpoints.server2Progs = uniqBy(endpoints.server2Progs, x => x.prog);
  endpoints.mysqlProgs = uniqBy(endpoints.mysqlProgs, x => `${x.file}||${x.prog}`);

  return endpoints;
}

function buildInventory({ menuItems, appDir }) {
  const appFiles = listFilesRecursive(appDir);
  const byBasename = new Map();
  for (const f of appFiles) {
    byBasename.set(path.basename(f), f);
  }

  const inventory = [];
  for (const mi of menuItems) {
    const href = mi.href;
    // Normaliza: se for app/foo.html
    const rel = href.startsWith('app/') ? href.slice('app/'.length) : href;
    const fileName = path.basename(rel);
    const filePath = byBasename.get(fileName) || null;

    let html = null;
    if (filePath && filePath.endsWith('.html') && exists(filePath)) {
      html = readText(filePath);
    }

    // Heurística: se o HTML referencia app/<name>.js, usa ele; senão tenta <name>.js
    const jsFiles = [];
    if (html) {
      const scriptRe = /<script[^>]+src="app\/([^"]+\.js)[^"]*"[^>]*><\/script>/gi;
      let m;
      while ((m = scriptRe.exec(html))) {
        jsFiles.push(m[1]);
      }
      // ura usa type=module também
      const scriptModuleRe = /<script[^>]+src="app\/([^"]+\.js)"[^>]*><\/script>/gi;
      while ((m = scriptModuleRe.exec(html))) {
        jsFiles.push(m[1]);
      }
    }
    if (!jsFiles.length && fileName.endsWith('.html')) {
      const guessed = fileName.replace(/\.html$/i, '.js');
      if (byBasename.has(guessed)) jsFiles.push(guessed);
    }

    const endpointSources = [];
    if (filePath && exists(filePath)) endpointSources.push({ type: 'html', file: path.relative(appDir, filePath), text: html || '' });

    for (const jsName of jsFiles) {
      const jsPath = byBasename.get(path.basename(jsName));
      if (jsPath && exists(jsPath)) {
        endpointSources.push({ type: 'js', file: path.relative(appDir, jsPath), text: readText(jsPath) });
      }
    }

    const combinedText = endpointSources.map(s => s.text).join('\n\n');
    const endpoints = extractEndpointsFromText(combinedText);

    inventory.push({
      label: mi.label,
      href: mi.href,
      permission: mi.perm,
      resolvedFile: filePath ? path.relative(appDir, filePath) : null,
      jsFiles: jsFiles.map(x => path.basename(x)),
      endpoints,
    });
  }

  return inventory;
}

function renderMarkdown({ inventory, menuItems, args }) {
  const lines = [];
  lines.push('# Mapa do menu legado (Ripabx-Web) → endpoints → storage');
  lines.push('');
  lines.push('Este documento foi gerado por parsing de `menu.php` + UI (`html/app/*.html` + `html/app/*.js`).');
  lines.push('');
  lines.push('- **Fonte do menu**: `remote-dumps/ripabx-web-all-php/html/menu.php`');
  lines.push(`- **Fonte da UI**: \`${path.relative(process.cwd(), args.appDir)}\``);
  lines.push('');
  lines.push('## Endpoints/Storages principais do legado');
  lines.push('');
  lines.push('- **PBX via XML/CGI**: `app/xml.php` (read) + `app/server.php` (write) → `/cgi/ripabx/*_xml.cgi` → `dados/xml/*.xml` + `dados/xsl/*.xsl`');
  lines.push('- **Contact Center/Relatórios via MariaDB**: `app/server2.php` (write) + `app/mysql*.php` (read)');
  lines.push('- **URA builder**: `app/ura_load.php` + `app/ura_save.php` (grava `conf/ura.conf` e `dados/json/ura.json`)');
  lines.push('');
  lines.push('## Itens encontrados no menu');
  lines.push('');
  lines.push(`Total de links no menu: **${menuItems.length}** (deduplicado por href+label).`);
  lines.push('');

  function fmtList(arr) {
    if (!arr || !arr.length) return '—';
    return arr.map(x => `\`${x}\``).join(', ');
  }

  for (const it of inventory) {
    lines.push(`### ${it.label}`);
    lines.push('');
    lines.push(`- **href**: \`${it.href}\``);
    lines.push(`- **permissão (legado)**: ${it.permission ? `\`${it.permission}\`` : '—'}`);
    lines.push(`- **arquivo resolvido**: ${it.resolvedFile ? `\`${it.resolvedFile}\`` : '—'}`);
    lines.push(`- **JS**: ${it.jsFiles.length ? it.jsFiles.map(f => `\`${f}\``).join(', ') : '—'}`);
    lines.push(`- **xml.php (views)**: ${it.endpoints.xmlViews.length ? it.endpoints.xmlViews.map(v => `\`${v.xml}\`+\`${v.xsl}\``).join(', ') : '—'}`);
    lines.push(`- **server.php (writes)**: ${fmtList(it.endpoints.serverProgs.map(p => p.prog))}`);
    lines.push(`- **server2.php (writes)**: ${fmtList(it.endpoints.server2Progs.map(p => p.prog))}`);
    lines.push(`- **mysql*.php (reads)**: ${it.endpoints.mysqlProgs.length ? it.endpoints.mysqlProgs.map(p => `\`${p.file}?prog=${p.prog}\``).join(', ') : '—'}`);
    lines.push(`- **URA**: ${it.endpoints.ura.load || it.endpoints.ura.save ? `load=${it.endpoints.ura.load} save=${it.endpoints.ura.save}` : '—'}`);
    lines.push('');
  }

  lines.push('## Observações importantes (para migração)');
  lines.push('');
  lines.push('- Muitos módulos PBX do legado são **CRUD sobre XML** (não “regra de dialplan” em si). No novo, isso vira **tabelas Postgres** + materialização para Asterisk Realtime.');
  lines.push('- Relatórios (`cdr`, `queue_log`, etc.) no legado são SQL direto (alta superfície de SQLi). No novo, precisa virar query parametrizada + RBAC/tenant isolation.');
  lines.push('- Alguns endpoints legados executam comandos no SO (ex.: conversão de áudio). No novo, substituir por serviço controlado (ffmpeg) e fila/worker.');
  lines.push('');
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    // eslint-disable-next-line no-console
    console.log('Uso: node scripts/legacy-ripabx-inventory.js [--menu-php PATH] [--app-dir PATH] [--out-md PATH] [--out-json PATH] [--write]');
    process.exit(0);
  }

  if (!exists(args.menuPhp)) {
    // eslint-disable-next-line no-console
    console.error(`menu.php não encontrado em: ${args.menuPhp}`);
    process.exit(2);
  }
  if (!exists(args.appDir)) {
    // eslint-disable-next-line no-console
    console.error(`app-dir não encontrado em: ${args.appDir}`);
    process.exit(2);
  }

  const menuPhpText = readText(args.menuPhp);
  const menuItems = parseMenuPhp(menuPhpText);
  const inventory = buildInventory({ menuItems, appDir: args.appDir });

  const md = renderMarkdown({ inventory, menuItems, args });
  const json = JSON.stringify({ generatedAt: new Date().toISOString(), menuItems, inventory }, null, 2);

  if (args.write) {
    fs.mkdirSync(path.dirname(args.outMd), { recursive: true });
    fs.writeFileSync(args.outMd, md, 'utf8');
    fs.writeFileSync(args.outJson, json, 'utf8');
  } else {
    // eslint-disable-next-line no-console
    console.log(md);
  }
}

main();

