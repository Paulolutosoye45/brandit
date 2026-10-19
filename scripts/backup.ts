/**
 * Take a backup right now, from your own computer or the Render shell. The site also does this every night by itself.
 *   npm run backup
 * Needs DATABASE_URL (the External URL) and the S3_ values in your environment. Use it before a risky change.
 */
import { runBackup } from '../lib/backup';

runBackup().then((r) => {
  if (r.ok) console.log(`\nBacked up ${r.rows.toLocaleString('en-NG')} rows from ${r.tables} tables (${(r.bytes / 1_048_576).toFixed(2)} MB) to ${r.name}. The stored copy was read back and matches.\n`);
  else console.error(`\nThe backup failed: ${r.error}\n`);
  process.exit(r.ok ? 0 : 1);
});
