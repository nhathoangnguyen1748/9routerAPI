import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { DATA_DIR } from "../src/lib/dataDir.js";

const dbPath = path.join(DATA_DIR, "db", "data.sqlite");
console.log("Opening SQLite DB at:", dbPath);

if (!fs.existsSync(dbPath)) {
  console.error("Database file not found at:", dbPath);
  process.exit(1);
}

const db = new Database(dbPath);
const payload = JSON.parse(fs.readFileSync(path.join(process.cwd(), "backup-9router.json"), "utf8"));

const stringifyJson = (v) => (v === undefined ? null : JSON.stringify(v));

const tx = db.transaction(() => {
  // Wipe tables
  db.prepare(`DELETE FROM settings`).run();
  db.prepare(`DELETE FROM providerConnections`).run();
  db.prepare(`DELETE FROM providerNodes`).run();
  db.prepare(`DELETE FROM proxyPools`).run();
  db.prepare(`DELETE FROM apiKeys`).run();
  db.prepare(`DELETE FROM combos`).run();
  db.prepare(`DELETE FROM kv WHERE scope IN ('modelAliases', 'customModels', 'mitmAlias', 'pricing')`).run();

  // Settings
  if (payload.settings) {
    db.prepare(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`).run(stringifyJson(payload.settings));
  }

  // Provider Connections
  const insertConn = db.prepare(
    `INSERT OR REPLACE INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const c of payload.providerConnections || []) {
    const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = c;
    insertConn.run(
      id, provider, authType || "oauth", name || null, email || null, priority || null,
      isActive === false ? 0 : 1, stringifyJson(rest),
      createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()
    );
  }

  // Provider Nodes
  const insertNode = db.prepare(
    `INSERT OR REPLACE INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`
  );
  for (const n of payload.providerNodes || []) {
    const { id, type, name, createdAt, updatedAt, ...rest } = n;
    insertNode.run(id, type || null, name || null, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString());
  }

  // Proxy Pools
  const insertPool = db.prepare(
    `INSERT OR REPLACE INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`
  );
  for (const p of payload.proxyPools || []) {
    const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
    insertPool.run(id, isActive === false ? 0 : 1, testStatus || "unknown", stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString());
  }

  // API Keys
  const insertKey = db.prepare(
    `INSERT OR REPLACE INTO apiKeys(id, key, name, machineId, isActive, createdAt, accessRestricted, accessAllow) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const k of payload.apiKeys || []) {
    const accessRestricted = k.access ? 1 : 0;
    const accessAllow = k.access ? JSON.stringify(k.access) : null;
    insertKey.run(k.id, k.key, k.name || null, k.machineId || null, k.isActive === false ? 0 : 1, k.createdAt || new Date().toISOString(), accessRestricted, accessAllow);
  }

  // Combos
  const insertCombo = db.prepare(
    `INSERT OR REPLACE INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`
  );
  for (const c of payload.combos || []) {
    insertCombo.run(c.id, c.name, c.kind || null, stringifyJson(c.models || []), c.createdAt || new Date().toISOString(), c.updatedAt || new Date().toISOString());
  }

  // KV (modelAliases, customModels, mitmAlias, pricing)
  const insertKv = db.prepare(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES(?, ?, ?)`);
  for (const [a, m] of Object.entries(payload.modelAliases || {})) {
    insertKv.run("modelAliases", a, stringifyJson(m));
  }
  for (const m of payload.customModels || []) {
    const k = `${m.providerAlias}|${m.id}|${m.type || "llm"}`;
    insertKv.run("customModels", k, stringifyJson(m));
  }
  for (const [tool, mappings] of Object.entries(payload.mitmAlias || {})) {
    insertKv.run("mitmAlias", tool, stringifyJson(mappings || {}));
  }
  for (const [provider, models] of Object.entries(payload.pricing || {})) {
    insertKv.run("pricing", provider, stringifyJson(models || {}));
  }
});

tx();
console.log("Successfully imported backup into SQLite!");

const conns = db.prepare("SELECT COUNT(*) as count FROM providerConnections").get();
const keys = db.prepare("SELECT COUNT(*) as count FROM apiKeys").get();
const pools = db.prepare("SELECT COUNT(*) as count FROM proxyPools").get();
console.log(`Verified DB: ${conns.count} connections, ${keys.count} API keys, ${pools.count} proxy pools.`);
db.close();
