import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const CLIENTS_DIR = path.join(DATA_DIR, 'clients');

if (!fs.existsSync(CLIENTS_DIR)) {
  console.log('No clients directory found. Nothing to migrate.');
  process.exit(0);
}

const files = fs.readdirSync(CLIENTS_DIR).filter((f) => f.endsWith('.json'));
let migrated = 0;
let skipped = 0;

for (const file of files) {
  const filePath = path.join(CLIENTS_DIR, file);
  const raw = fs.readFileSync(filePath, 'utf-8');
  const client = JSON.parse(raw);

  if (client._v >= 2) {
    skipped++;
    continue;
  }

  client.billingAddress = client.billingAddress || {
    address: client.address || '',
    city: client.city || '',
    pin: client.pin || '',
    state: client.state || '',
    country: client.country || 'India',
  };
  client.shippingAddresses = Array.isArray(client.shippingAddresses) ? client.shippingAddresses : [];
  client._v = 2;

  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(client, null, 2));
  fs.renameSync(tmpPath, filePath);

  migrated++;
}

console.log(`Migration complete: ${migrated} migrated, ${skipped} already up to date.`);
