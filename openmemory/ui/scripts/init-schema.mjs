import neo4j from 'neo4j-driver';

const driver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('', ''),
  { encrypted: false, disableLosslessIntegers: true }
);
const s = driver.session({ defaultAccessMode: 'WRITE' });

const stmts = [
  'CREATE CONSTRAINT ON (u:User) ASSERT u.userId IS UNIQUE',
  'CREATE CONSTRAINT ON (m:Memory) ASSERT m.id IS UNIQUE',
  'CREATE CONSTRAINT ON (e:Entity) ASSERT e.id IS UNIQUE',
  'CREATE VECTOR INDEX memory_vectors ON :Memory(embedding) WITH CONFIG {"dimension": 1536, "capacity": 100000, "metric": "cos"}',
  'CREATE TEXT INDEX memory_text ON :Memory',
  'CREATE INDEX ON :Memory(validAt)',
  'CREATE INDEX ON :Memory(invalidAt)',
  'CREATE INDEX ON :Entity(name)',
];

for (const stmt of stmts) {
  try {
    await s.run(stmt);
    console.log('OK :', stmt.slice(0, 60));
  } catch (e) {
    console.log('SKIP:', e.message.slice(0, 100));
  }
}

await s.close();
await driver.close();
console.log('Schema init complete.');
